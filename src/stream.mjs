// 会话流数据契约：每个 session 一个 append-only JSONL 文件。
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import {
  isValidSessionName,
  listRounds,
  paths,
  sessionDir,
} from './workspace.mjs';

const AUTHOR_ROLES = new Set(['owner', 'participant', 'ai']);
const ENTRY_KINDS = new Set(['message', 'receipt', 'progress']);
const DEFAULT_LIMIT = 100;

function assertValidSession(session) {
  if (!isValidSessionName(session)) {
    throw new Error('session 名称无效：限 80 字符，仅允许字母、数字、点、下划线和连字符');
  }
}

function cleanAuthor(author) {
  if (!author || typeof author !== 'object' || Array.isArray(author)
    || typeof author.id !== 'string' || !author.id.trim()
    || typeof author.name !== 'string' || !author.name.trim()
    || !AUTHOR_ROLES.has(author.role)) {
    throw new Error('author 作者信息无效');
  }
  return { id: author.id.trim(), name: author.name.trim(), role: author.role };
}

function cleanRefs(refs) {
  if (refs == null) return undefined;
  if (typeof refs !== 'object' || Array.isArray(refs)) throw new Error('refs 引用信息无效');
  const clean = {};
  if (refs.round != null) {
    if (!Number.isSafeInteger(refs.round) || refs.round < 1) throw new Error('refs.round 必须是正整数');
    clean.round = refs.round;
  }
  if (refs.blockId != null) {
    if (typeof refs.blockId !== 'string' || !refs.blockId.trim()) throw new Error('refs.blockId 必须是非空字符串');
    clean.blockId = refs.blockId.trim();
  }
  return Object.keys(clean).length ? clean : undefined;
}

function normalizeEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('流条目必须是对象');
  const id = input.id == null ? randomUUID() : input.id;
  const at = input.at == null ? new Date().toISOString() : input.at;
  if (typeof id !== 'string' || !id.trim()) throw new Error('id 必须是非空字符串');
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw new Error('at 必须是有效时间');
  if (!ENTRY_KINDS.has(input.kind)) throw new Error('kind 类型无效');
  if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('text 文本不能为空');

  const refs = cleanRefs(input.refs);
  return {
    id: id.trim(),
    at,
    author: cleanAuthor(input.author),
    kind: input.kind,
    text: input.text,
    ...(refs ? { refs } : {}),
  };
}

export function streamPath(session, { exactSession = false } = {}) {
  assertValidSession(session);
  return path.join(sessionDir(session, { exactSession }), 'stream.jsonl');
}

export function appendStreamEntry(session, input, { exactSession = false } = {}) {
  const file = streamPath(session, { exactSession });
  const entry = normalizeEntry(input);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // O_APPEND 语义确保同一进程内并发请求不会互相覆盖已有内容。
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

function readAllEntries(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      entries.push(normalizeEntry(parsed));
    } catch {
      // 单条损坏不能让后续有效消息永久不可读；append-only 文件不会在此被修复或覆盖。
    }
  }
  return entries;
}

export function readStreamEntries(session, {
  since,
  limit = DEFAULT_LIMIT,
  exactSession = false,
} = {}) {
  const file = streamPath(session, { exactSession });
  const entries = readAllEntries(file);
  const parsedLimit = Number(limit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) throw new Error('limit 必须是正整数');

  const hasCursor = since != null && since !== '';
  let selected = entries;
  if (hasCursor) {
    const cursor = String(since);
    const idIndex = entries.findIndex((entry) => entry.id === cursor);
    if (idIndex >= 0) {
      selected = entries.slice(idIndex + 1);
    } else {
      const timestamp = Date.parse(cursor);
      selected = Number.isNaN(timestamp)
        ? []
        : entries.filter((entry) => Date.parse(entry.at) > timestamp);
    }
  }
  // 首次读取给最近窗口；增量读取必须从游标后第一条向前分页，避免积压超过 limit 时永久跳消息。
  return hasCursor ? selected.slice(0, parsedLimit) : selected.slice(-parsedLimit);
}

function migrationId(session, round, feedback) {
  const authorId = feedback.submittedBy?.id || 'owner';
  const source = `${session}\0${round}\0${authorId}\0${feedback.submittedAt || ''}\0${feedback.sessionComment}`;
  return `legacy-feedback-${createHash('sha256').update(source).digest('hex').slice(0, 32)}`;
}

function migrationAuthor(feedback) {
  const id = typeof feedback.submittedBy?.id === 'string' && feedback.submittedBy.id.trim()
    ? feedback.submittedBy.id.trim()
    : 'owner';
  const name = typeof feedback.submittedBy?.name === 'string' && feedback.submittedBy.name.trim()
    ? feedback.submittedBy.name.trim()
    : '管理员';
  return { id, name, role: id === 'owner' ? 'owner' : 'participant' };
}

export function migrateSessionComments(session, { exactSession = true } = {}) {
  assertValidSession(session);
  const existing = readStreamEntries(session, { limit: Number.MAX_SAFE_INTEGER, exactSession });
  const ids = new Set(existing.map((entry) => entry.id));
  let migrated = 0;
  let skipped = 0;

  for (const round of listRounds(session, { exactSession })) {
    const feedbackFile = paths.feedback(session, round, { exactSession });
    let feedback;
    try {
      feedback = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
    } catch {
      skipped += 1;
      continue;
    }
    if (typeof feedback.sessionComment !== 'string' || !feedback.sessionComment.trim()) {
      skipped += 1;
      continue;
    }

    const id = migrationId(session, round, feedback);
    if (ids.has(id)) {
      skipped += 1;
      continue;
    }
    let at = feedback.submittedAt;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
      at = fs.statSync(feedbackFile).mtime.toISOString();
    }
    appendStreamEntry(session, {
      id,
      at,
      author: migrationAuthor(feedback),
      kind: 'message',
      text: feedback.sessionComment.trim(),
      refs: { round },
    }, { exactSession });
    ids.add(id);
    migrated += 1;
  }

  return { ok: true, session, migrated, skipped };
}
