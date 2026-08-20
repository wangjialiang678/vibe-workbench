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
const ENTRY_KINDS = new Set(['message', 'receipt', 'progress', 'ask', 'answer']);
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

function cleanSelfReportedBy(selfReportedBy) {
  if (selfReportedBy == null) return undefined;
  if (!selfReportedBy || typeof selfReportedBy !== 'object' || Array.isArray(selfReportedBy)
    || typeof selfReportedBy.name !== 'string'
    || !selfReportedBy.name.trim()
    || [...selfReportedBy.name].length > 40) {
    throw new Error('selfReportedBy 自报身份无效');
  }
  return {
    ...(typeof selfReportedBy.id === 'string' && selfReportedBy.id
      ? { id: selfReportedBy.id }
      : {}),
    name: selfReportedBy.name,
  };
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

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} 必须是非空字符串`);
  }
  return value.trim();
}

function cleanAsk(ask) {
  if (!ask || typeof ask !== 'object' || Array.isArray(ask)) {
    throw new Error('ask 决策卡必须是对象');
  }
  const id = requiredText(ask.id, 'ask.id');
  const question = requiredText(ask.question, 'ask.question');
  if (!Array.isArray(ask.options) || ask.options.length < 2 || ask.options.length > 4) {
    throw new Error('ask.options 必须包含 2—4 个选项');
  }
  const optionIds = new Set();
  const options = ask.options.map((option, index) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      throw new Error(`ask.options[${index}] 必须是对象`);
    }
    const optionId = requiredText(option.id, `ask.options[${index}].id`);
    if (optionIds.has(optionId)) throw new Error(`ask option id 重复：${optionId}`);
    optionIds.add(optionId);
    return {
      id: optionId,
      label: requiredText(option.label, `ask.options[${index}].label`),
      desc: requiredText(option.desc, `ask.options[${index}].desc 解释`),
    };
  });
  if (ask.multi !== false) throw new Error('ask.multi 当前只允许 false');

  let recommendation;
  if (ask.recommendation != null) {
    recommendation = requiredText(ask.recommendation, 'ask.recommendation');
    if (!optionIds.has(recommendation)) {
      throw new Error('ask.recommendation 必须指向合法 option id');
    }
  }
  return {
    id,
    question,
    options,
    multi: false,
    ...(recommendation ? { recommendation } : {}),
  };
}

function cleanAnswerFields(input) {
  const answerTo = requiredText(input.answerTo, 'answerTo');
  let answerValue;
  if (typeof input.answerValue === 'string') {
    answerValue = requiredText(input.answerValue, 'answerValue');
  } else if (Array.isArray(input.answerValue) && input.answerValue.length > 0) {
    answerValue = input.answerValue.map((value, index) => (
      requiredText(value, `answerValue[${index}]`)
    ));
    if (new Set(answerValue).size !== answerValue.length) {
      throw new Error('answerValue 数组不能包含重复 option id');
    }
  } else {
    throw new Error('answerValue 必须是 option id 或非空数组');
  }
  return { answerTo, answerValue };
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
  const selfReportedBy = cleanSelfReportedBy(input.selfReportedBy);
  return {
    id: id.trim(),
    at,
    author: cleanAuthor(input.author),
    kind: input.kind,
    text: input.text,
    ...(selfReportedBy ? { selfReportedBy } : {}),
    ...(refs ? { refs } : {}),
    ...(input.kind === 'ask' ? { ask: cleanAsk(input.ask) } : {}),
    ...(input.kind === 'answer' ? cleanAnswerFields(input) : {}),
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

function streamProtocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
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

/** 写入 ask 时在同一 session 内保证卡片 id 唯一。 */
export function appendAskEntry(session, input, { exactSession = false } = {}) {
  const entry = normalizeEntry(input);
  if (entry.kind !== 'ask') throw new Error('appendAskEntry 只接受 kind: ask');
  const existing = readAllEntries(streamPath(session, { exactSession }));
  if (existing.some((item) => item.kind === 'ask' && item.ask?.id === entry.ask.id)) {
    throw streamProtocolError('ASK_ALREADY_EXISTS', `ask.id 已存在：${entry.ask.id}`);
  }
  return appendStreamEntry(session, entry, { exactSession });
}

/**
 * 回答必须引用本 session 已存在且未回答的 ask。
 * 当前 ask.multi 固定为 false；数组形式仅接受单元素，作为协议的兼容表示。
 */
export function appendAnswerEntry(session, input, { exactSession = false } = {}) {
  assertValidSession(session);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('answer 回答必须是对象');
  }
  const { answerTo, answerValue } = cleanAnswerFields(input);
  const existing = readAllEntries(streamPath(session, { exactSession }));
  const askEntry = existing.find((entry) => entry.kind === 'ask' && entry.ask?.id === answerTo);
  if (!askEntry) {
    throw streamProtocolError('ASK_NOT_FOUND', `answerTo 对应的 ask 不存在：${answerTo}`);
  }
  if (existing.some((entry) => entry.kind === 'answer' && entry.answerTo === answerTo)) {
    throw streamProtocolError('ASK_ALREADY_ANSWERED', `ask 已回答：${answerTo}`);
  }

  const selectedIds = Array.isArray(answerValue) ? answerValue : [answerValue];
  if (askEntry.ask.multi === false && selectedIds.length !== 1) {
    throw streamProtocolError('INVALID_ASK_ANSWER', '该 ask 只能选择 1 项');
  }
  const labelsById = new Map(askEntry.ask.options.map((option) => [option.id, option.label]));
  if (selectedIds.some((id) => !labelsById.has(id))) {
    throw streamProtocolError('INVALID_ASK_ANSWER', 'answerValue 必须是该 ask 的合法 option id');
  }
  const text = selectedIds.map((id) => labelsById.get(id)).join('、');
  return appendStreamEntry(session, {
    ...(input.id == null ? {} : { id: input.id }),
    ...(input.at == null ? {} : { at: input.at }),
    author: input.author,
    ...(input.selfReportedBy ? { selfReportedBy: input.selfReportedBy } : {}),
    kind: 'answer',
    text,
    answerTo,
    answerValue,
  }, { exactSession });
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
