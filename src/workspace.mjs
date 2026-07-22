// 工作区文件契约（DESIGN §6.2）。server / loop / bin 共用。可用 WB_WORKSPACE 覆盖根目录（便于测试）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateContent } from './protocol/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const SESSION_NAME_RE = /^[A-Za-z0-9._-]+$/;
export const SESSION_NAME_MAX_LENGTH = 80;

export function workspaceDir() { return process.env.WB_WORKSPACE || path.join(ROOT, 'workspace'); }
// 旧版路径规则必须保留，否则本地已有 foo.bar 会突然从 foo_bar 改读 foo.bar。
function legacySafe(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, SESSION_NAME_MAX_LENGTH); }
export function isValidSessionName(value) {
  return typeof value === 'string'
    && value.length <= SESSION_NAME_MAX_LENGTH
    && SESSION_NAME_RE.test(value)
    && value !== '.'
    && value !== '..';
}
export function sessionDir(s, { exactSession = false } = {}) {
  const value = String(s || '');
  const legacy = path.join(workspaceDir(), legacySafe(value));
  if (!isValidSessionName(value)) return legacy;
  const exact = path.join(workspaceDir(), value);
  // 服务端新写强制精确目录；普通读取优先已存在的精确目录，否则兼容旧目录。
  if (exactSession || (exact !== legacy && exists(exact))) return exact;
  return legacy;
}
export function roundDir(s, r, options) { return path.join(sessionDir(s, options), `round-${r}`); }

export const paths = {
  content: (s, r, options) => path.join(roundDir(s, r, options), 'content.json'),
  contentMd: (s, r, options) => path.join(roundDir(s, r, options), 'content.md'),
  feedback: (s, r, options) => path.join(roundDir(s, r, options), 'feedback.json'),
  feedbackMd: (s, r, options) => path.join(roundDir(s, r, options), 'feedback.md'),
  ack: (s, r, options) => path.join(roundDir(s, r, options), 'ack.json'),
  response: (s, r, options) => path.join(roundDir(s, r, options), 'response.md'),
  error: (s, r, options) => path.join(roundDir(s, r, options), 'error.json'),
  status: (s, options) => path.join(sessionDir(s, options), 'status.json'),
  session: (s, options) => path.join(sessionDir(s, options), 'session.json'),
};

export function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
export function readJSON(p, def = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
export function writeJSON(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
export function readText(p, def = null) { try { return fs.readFileSync(p, 'utf8'); } catch { return def; } }
export function writeText(p, t) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); }
export function removeFile(p) { try { fs.rmSync(p); return true; } catch { return false; } }

export function readStatus(s, options) { return readJSON(paths.status(s, options), null); }
export function writeStatus(s, patch, nowISO, options) {
  const cur = readStatus(s, options) || { session: s };
  const next = { ...cur, ...patch, updatedAt: nowISO || new Date().toISOString() };
  writeJSON(paths.status(s, options), next);
  return next;
}

export function listSessions() {
  try { return fs.readdirSync(workspaceDir()).filter((d) => { try { return fs.statSync(path.join(workspaceDir(), d)).isDirectory(); } catch { return false; } }); }
  catch { return []; }
}
export function listRounds(s, options) {
  try { return fs.readdirSync(sessionDir(s, options)).filter((d) => /^round-\d+$/.test(d)).map((d) => parseInt(d.slice(6), 10)).sort((a, b) => a - b); }
  catch { return []; }
}
export function latestRound(s, options) { const r = listRounds(s, options); return r.length ? r[r.length - 1] : 0; }

// blocks → markdown 线性序列化。与 JSON 一起落盘，供人直接阅读。
export function blocksToMarkdown(content) {
  const lines = [];
  const { title, session, round, blocks = [] } = content;

  if (title) lines.push(`# ${title}`, '');
  else lines.push(`# Round ${round} — ${session}`, '');

  for (const block of blocks) {
    if (block.title) lines.push(`## ${block.title}`, '');

    switch (block.type) {
      case 'markdown':
      case 'verdict':
      case 'freetext':
      case 'editable':
        if (block.body) lines.push(block.body, '');
        if (block.value) lines.push(block.value, '');
        break;
      case 'diagram':
        lines.push('```' + (block.lang || 'mermaid'), block.body || '', '```', '');
        break;
      case 'code':
        lines.push('```' + (block.lang || ''), block.body || '', '```', '');
        break;
      case 'choice': {
        if (block.body) lines.push(block.body, '');
        for (const option of block.options || []) {
          const recommended = block.recommendation === option.id ? ' *(推荐)*' : '';
          lines.push(`- **${option.label || option.id}**${recommended}${option.desc ? ': ' + option.desc : ''}`);
        }
        lines.push('');
        break;
      }
      case 'table': {
        const columns = block.columns || [];
        if (columns.length) {
          lines.push('| ' + columns.join(' | ') + ' |');
          lines.push('| ' + columns.map(() => '---').join(' | ') + ' |');
          for (const row of block.rows || []) lines.push('| ' + row.join(' | ') + ' |');
          lines.push('');
        }
        break;
      }
      default:
        if (block.body) lines.push(block.body, '');
    }
  }

  return lines.join('\n');
}

// 轮次分配与 schema 校验只在这里定义，CLI 与服务端不得各算一份。
export function prepareRound(session, contentObj, { exactSession = false } = {}) {
  const round = contentObj?.round != null ? contentObj.round : latestRound(session, { exactSession }) + 1;
  const content = { ...contentObj, session, round };
  const result = validateContent(content);
  if (!result.ok) {
    const error = new Error(`validateContent failed: ${result.errors.join('; ')}`);
    error.code = 'INVALID_CONTENT';
    error.errors = result.errors;
    throw error;
  }
  return content;
}

/**
 * 统一写入一轮 content、可读 Markdown 与 rendered 状态。
 * 服务端传 allowOverwrite:false，以原子 mkdir 保证并发请求不会覆盖同一轮。
 */
export function writeRound(session, contentObj, { allowOverwrite = true, exactSession = false } = {}) {
  const content = prepareRound(session, contentObj, { exactSession });
  const { round } = content;
  const pathOptions = { exactSession };
  let reservedRoundDir = null;

  if (exactSession) fs.mkdirSync(sessionDir(session, { exactSession: true }), { recursive: true });
  if (!allowOverwrite) {
    if (!exactSession) fs.mkdirSync(sessionDir(session), { recursive: true });
    try {
      reservedRoundDir = roundDir(session, round, { exactSession });
      fs.mkdirSync(reservedRoundDir);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        const conflict = new Error(`round ${round} 已存在，不允许覆盖`);
        conflict.code = 'ROUND_EXISTS';
        conflict.session = session;
        conflict.round = round;
        throw conflict;
      }
      throw error;
    }
  }

  try {
    writeJSON(paths.content(session, round, pathOptions), content);
    writeText(paths.contentMd(session, round, pathOptions), blocksToMarkdown(content));
    writeStatus(session, { state: 'rendered', round }, undefined, pathOptions);
    return { session, round, content };
  } catch (error) {
    // 仅回收本次请求刚占用的目录；已有 round 从未进入此分支，绝不误删。
    if (reservedRoundDir) {
      try { fs.rmSync(reservedRoundDir, { recursive: true, force: true }); } catch {}
    }
    throw error;
  }
}
