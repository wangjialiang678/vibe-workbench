// session-store.mjs — 读写 session.json（DESIGN §6.2）
// { claudeSessionId, cwd, createdAt }
import { paths, readJSON, writeJSON } from '../workspace.mjs';

/**
 * 读取会话元数据。无文件时返回 null。
 * @param {string} session
 * @returns {{ claudeSessionId: string|null, cwd: string, createdAt: string }|null}
 */
export function getSession(session) {
  return readJSON(paths.session(session), null);
}

/**
 * 合并写入 claudeSessionId（保留 cwd/createdAt 等已有字段）。
 * @param {string} session
 * @param {string} id  — 从 claude stream-json 捕获的 session_id
 */
export function setSessionId(session, id) {
  const cur = getSession(session) || { createdAt: new Date().toISOString() };
  writeJSON(paths.session(session), { ...cur, claudeSessionId: id });
}

/**
 * 返回该 session 关联的工作目录（无记录时返回 null）。
 * @param {string} session
 * @returns {string|null}
 */
export function getCwd(session) {
  const s = getSession(session);
  return s ? (s.cwd || null) : null;
}
