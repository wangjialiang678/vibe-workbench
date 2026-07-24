// session-store.mjs — 读写 session.json（DESIGN §6.2）
// { claudeSessionId, agent?, cwd, createdAt }；字段名保留用于兼容存量数据。
import { paths, readJSON, writeJSON } from '../workspace.mjs';

/**
 * 读取会话元数据。无文件时返回 null。
 * @param {string} session
 * @returns {{ claudeSessionId: string|null, agent?: string, cwd: string, createdAt: string }|null}
 */
export function getSession(session) {
  return readJSON(paths.session(session), null);
}

/**
 * 读取属于指定 agent 的续接 ID。存量无 agent 字段的数据按 Claude 会话处理。
 * @param {string} session
 * @param {'claude'|'workbuddy'|'codex'} agent
 * @returns {string|null}
 */
export function getSessionId(session, agent) {
  const current = getSession(session);
  if (!current?.claudeSessionId) return null;
  const owner = current.agent || 'claude';
  return owner === agent ? current.claudeSessionId : null;
}

/**
 * 合并写入续接 ID（保留 cwd/createdAt 等已有字段）。
 * @param {string} session
 * @param {string} id
 * @param {'claude'|'workbuddy'|'codex'|null} [agent] — 省略时保持旧 API 行为
 */
export function setSessionId(session, id, agent = null) {
  const cur = getSession(session) || { createdAt: new Date().toISOString() };
  writeJSON(paths.session(session), {
    ...cur,
    claudeSessionId: id,
    ...(agent ? { agent } : {}),
  });
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
