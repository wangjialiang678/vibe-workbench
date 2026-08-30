// 工作台业务数据的唯一文件系统出口。适配器与业务模块不得直接 import node:fs。
import nodeFs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContent } from '../protocol/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const SESSION_NAME_RE = /^[A-Za-z0-9._-]+$/;
export const SESSION_NAME_MAX_LENGTH = 80;
const RESERVED_WORKSPACE_DIRS = new Set(['inbox']);

// 仅供尚未拆离的业务模块调用；node:fs 本身只在本文件出现。
export const disk = nodeFs;
export function workspaceDir() { return process.env.WB_WORKSPACE || path.join(ROOT, 'workspace'); }
function legacySafe(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, SESSION_NAME_MAX_LENGTH); }
export function isValidSessionName(value) { return typeof value === 'string' && value.length <= SESSION_NAME_MAX_LENGTH && SESSION_NAME_RE.test(value) && value !== '.' && value !== '..' && !RESERVED_WORKSPACE_DIRS.has(value); }
export function sessionDir(s, { exactSession = false } = {}) { const value = String(s || ''); const legacy = path.join(workspaceDir(), legacySafe(value)); if (!isValidSessionName(value)) return legacy; const exact = path.join(workspaceDir(), value); return exactSession || (exact !== legacy && exists(exact)) ? exact : legacy; }
export function roundDir(s, r, options) { return path.join(sessionDir(s, options), `round-${r}`); }
export const paths = {
  content: (s, r, options) => path.join(roundDir(s, r, options), 'content.json'), contentMd: (s, r, options) => path.join(roundDir(s, r, options), 'content.md'), feedback: (s, r, options) => path.join(roundDir(s, r, options), 'feedback.json'), participantFeedback: (s, r, id, options) => path.join(roundDir(s, r, options), `feedback-${id}.json`), feedbackHistory: (s, r, stamp, id, options) => path.join(roundDir(s, r, options), 'feedback-history', `${stamp}-${id}${options?.selfReportSlug ? `-${options.selfReportSlug}` : ''}.json`), feedbackMd: (s, r, options) => path.join(roundDir(s, r, options), 'feedback.md'), ack: (s, r, options) => path.join(roundDir(s, r, options), 'ack.json'), response: (s, r, options) => path.join(roundDir(s, r, options), 'response.md'), error: (s, r, options) => path.join(roundDir(s, r, options), 'error.json'), status: (s, options) => path.join(sessionDir(s, options), 'status.json'), session: (s, options) => path.join(sessionDir(s, options), 'session.json'),
};
export function exists(p) { try { nodeFs.accessSync(p); return true; } catch { return false; } }
function readJson(p, def = null) { try { return JSON.parse(nodeFs.readFileSync(p, 'utf8')); } catch { return def; } }
function atomicWrite(target, data) { const dir = path.dirname(target); nodeFs.mkdirSync(dir, { recursive: true }); const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${process.hrtime.bigint().toString(36)}.tmp`); try { nodeFs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 }); nodeFs.renameSync(tmp, target); } finally { try { nodeFs.rmSync(tmp, { force: true }); } catch {} } }
function writeJson(p, obj) { atomicWrite(p, JSON.stringify(obj, null, 2)); }
function readTextFile(p, def = null) { try { return nodeFs.readFileSync(p, 'utf8'); } catch { return def; } }
function writeTextFile(p, text) { atomicWrite(p, text); }

function feedbackClaimPath(session, round, token, options) {
  return path.join(roundDir(session, round, options), `.feedback.claim-${token}.json`);
}

function archivedAckPath(session, round, token, options) {
  return path.join(roundDir(session, round, options), `ack.expired-${token}.json`);
}

/**
 * 以 feedback.json 的 rename 作为唯一竞争点认领一轮。
 * rename 成功者先写带 owner/lease 的 ack，再把 feedback 原样放回；后来者即使在
 * 恢复窗口拿到 feedback，也会二次检查 ack 并归还文件，因此不会双领。
 */
export function claimFeedbackRound(session, round, {
  workerId = `pid-${process.pid}`,
  leaseMs = 5 * 60 * 1000,
  now = new Date(),
  exactSession = false,
} = {}) {
  const options = { exactSession };
  const ackPath = paths.ack(session, round, options);
  const responsePath = paths.response(session, round, options);
  const errorPath = paths.error(session, round, options);
  const feedbackPath = paths.feedback(session, round, options);
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('claim now 必须是有效时间');
  if (exists(responsePath) || exists(errorPath)) return null;

  const existing = readJson(ackPath, null);
  if (existing) {
    const expiresAt = Date.parse(existing.leaseExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs) return null;
    // 过期 ack 保留为审计件，随后允许新 worker 接管。
    try { nodeFs.renameSync(ackPath, archivedAckPath(session, round, `${nowMs}-${process.hrtime.bigint().toString(36)}`, options)); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }

  const token = `${nowMs}-${process.pid}-${process.hrtime.bigint().toString(36)}`;
  const claimPath = feedbackClaimPath(session, round, token, options);
  try {
    nodeFs.renameSync(feedbackPath, claimPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  try {
    // 认领后的二次检查封住 "首个 worker 已恢复 feedback，第二个刚好 rename" 的窗口。
    if (exists(ackPath) || exists(responsePath) || exists(errorPath)) return null;
    const claimedAt = nowDate.toISOString();
    const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
    const ack = { owner: workerId, claimedAt, leaseExpiresAt, pid: process.pid };
    writeJson(ackPath, ack);
    return { ...ack, feedback: readJson(claimPath, null) };
  } finally {
    // 未完成前 feedback 仍是事实源；无论成功还是输掉竞争都恢复它。
    try {
      if (nodeFs.existsSync(claimPath) && !nodeFs.existsSync(feedbackPath)) nodeFs.renameSync(claimPath, feedbackPath);
    } catch { /* 下一次 reconcile 会以文件事实源继续对账 */ }
  }
}

/** 只释放租约过期的 ack，供冷启动 reconcile 调用。 */
export function releaseExpiredFeedbackClaim(session, round, { now = new Date(), exactSession = false } = {}) {
  const options = { exactSession };
  const ackPath = paths.ack(session, round, options);
  const ack = readJson(ackPath, null);
  if (!ack || exists(paths.response(session, round, options)) || exists(paths.error(session, round, options))) return false;
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const expiresAt = Date.parse(ack.leaseExpiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAt) || expiresAt > nowMs) return false;
  try {
    nodeFs.renameSync(ackPath, archivedAckPath(session, round, `${nowMs}-${process.hrtime.bigint().toString(36)}`, options));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
export function readRound(session, round, options) { return readJson(paths.content(session, round, options)); }
export function readFeedback(session, round, options) { return readJson(paths.feedback(session, round, options)); }
export function readStatus(s, options) { return readJson(paths.status(s, options)); }
export function writeStatus(s, patch, nowISO, options) { const next = { ...(readStatus(s, options) || { session: s }), ...patch, updatedAt: nowISO || new Date().toISOString() }; writeJson(paths.status(s, options), next); return next; }
export function listSessions() { try { return nodeFs.readdirSync(workspaceDir()).filter((d) => !RESERVED_WORKSPACE_DIRS.has(d) && nodeFs.statSync(path.join(workspaceDir(), d)).isDirectory()); } catch { return []; } }
export function listRounds(s, options) { try { return nodeFs.readdirSync(sessionDir(s, options)).filter((d) => /^round-\d+$/.test(d)).map((d) => Number(d.slice(6))).sort((a, b) => a - b); } catch { return []; } }
export function latestRound(s, options) { return listRounds(s, options).at(-1) || 0; }
export function blocksToMarkdown(content) { const lines = []; const { title, session, round, blocks = [] } = content; lines.push(title ? `# ${title}` : `# Round ${round} — ${session}`, ''); for (const block of blocks) { if (block.title) lines.push(`## ${block.title}`, ''); if (['markdown','verdict','freetext','editable'].includes(block.type)) { if (block.body) lines.push(block.body, ''); if (block.value) lines.push(block.value, ''); } else if (['diagram','code'].includes(block.type)) lines.push('```' + (block.lang || (block.type === 'diagram' ? 'mermaid' : '')), block.body || '', '```', ''); else if (block.type === 'choice') { if (block.body) lines.push(block.body, ''); for (const option of block.options || []) lines.push(`- **${option.label || option.id}**${block.recommendation === option.id ? ' *(推荐)*' : ''}${option.desc ? ': ' + option.desc : ''}`); lines.push(''); } else if (block.type === 'table') { const columns = block.columns || []; if (columns.length) { lines.push('| ' + columns.join(' | ') + ' |', '| ' + columns.map(() => '---').join(' | ') + ' |'); for (const row of block.rows || []) lines.push('| ' + row.join(' | ') + ' |'); lines.push(''); } } else if (block.body) lines.push(block.body, ''); } return lines.join('\n'); }
export function prepareRound(session, contentObj, { exactSession = false } = {}) { const round = contentObj?.round != null ? contentObj.round : latestRound(session, { exactSession }) + 1; const content = { ...contentObj, session, round }; const result = validateContent(content); if (!result.ok) { const error = new Error(`validateContent failed: ${result.errors.join('; ')}`); error.code = 'INVALID_CONTENT'; error.errors = result.errors; throw error; } return content; }
export function createRound(session, contentObj, { exactSession = false } = {}) { const content = prepareRound(session, contentObj, { exactSession }); const options = { exactSession }; nodeFs.mkdirSync(sessionDir(session, options), { recursive: true }); const dir = roundDir(session, content.round, options); try { nodeFs.mkdirSync(dir); } catch (error) { if (error?.code === 'EEXIST') { const conflict = new Error(`round ${content.round} 已存在，不允许覆盖`); conflict.code = 'ROUND_EXISTS'; conflict.session = session; conflict.round = content.round; throw conflict; } throw error; } try { writeJson(paths.content(session, content.round, options), content); writeTextFile(paths.contentMd(session, content.round, options), blocksToMarkdown(content)); writeStatus(session, { state: 'rendered', round: content.round }, undefined, options); return { session, round: content.round, content }; } catch (error) { try { nodeFs.rmSync(dir, { recursive: true, force: true }); } catch {} throw error; } }
export function writeRound(session, contentObj, options = {}) { if (options.allowOverwrite === false) return createRound(session, contentObj, options); const content = prepareRound(session, contentObj, options); const o = { exactSession: options.exactSession }; writeJson(paths.content(session, content.round, o), content); writeTextFile(paths.contentMd(session, content.round, o), blocksToMarkdown(content)); writeStatus(session, { state: 'rendered', round: content.round }, undefined, o); return { session, round: content.round, content }; }
export function appendFeedback(session, round, saved, { identitySlug = 'owner', selfReportSlug, exactSession = true, statusPatch = { state: 'submitted', round, error: null } } = {}) { const options = { exactSession, ...(selfReportSlug ? { selfReportSlug } : {}) }; const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.hrtime.bigint().toString(36)}`; writeJson(paths.feedbackHistory(session, round, stamp, identitySlug, options), saved); writeJson(paths.feedback(session, round, { exactSession }), saved); writeStatus(session, statusPatch, undefined, { exactSession }); return saved; }
// 旧 API 只为平稳迁移保留；实现仍为 storage 内部原子写。
export const readJSON = readJson; export const writeJSON = writeJson; export const readText = readTextFile; export const writeText = writeTextFile; export function removeFile(p) { try { nodeFs.rmSync(p); return true; } catch { return false; } }
