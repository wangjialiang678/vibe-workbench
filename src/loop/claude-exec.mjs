// claude-exec.mjs — 封装 `claude -p --resume`（DESIGN §7）
// 零依赖，driver 可通过 spawnImpl 注入（便于测试）。
import { spawn as nodeSpawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟软超时

/**
 * 组装 claude CLI 参数列表。
 * @param {string} prompt
 * @param {string|null|undefined} sessionId  — 有则追加 --resume
 * @returns {string[]}
 */
export function buildArgv(prompt, sessionId) {
  const base = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (sessionId) base.push('--resume', sessionId);
  return base;
}

/**
 * 从 stream-json 输出（逐行 JSON）提取 { sessionId, text }。
 * - 找含 session_id 字段的事件取 session_id
 * - 拼接 assistant 消息文本 / result 文本
 * 容错非 JSON 行（忽略）。
 * @param {string} text  — stdout 全文
 * @returns {{ sessionId: string|null, text: string }}
 */
export function parseStreamJson(text) {
  let sessionId = null;
  const parts = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }

    // 捕获 session_id（任意事件都可能携带）
    if (obj.session_id && !sessionId) sessionId = obj.session_id;

    // 拼接 assistant 消息块（type=content_block_delta / message）
    if (obj.type === 'content_block_delta' && obj.delta?.text) {
      parts.push(obj.delta.text);
    } else if (obj.type === 'message' && obj.role === 'assistant') {
      // 有些格式把完整消息放在 content 数组
      const content = obj.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === 'text' && c.text) parts.push(c.text);
        }
      }
    } else if (obj.type === 'result' && obj.result) {
      // stream-json verbose 模式会有 result 事件
      parts.push(obj.result);
    }
  }

  return { sessionId, text: parts.join('') };
}

/**
 * 运行 claude CLI，收集 stdout，解析 stream-json。
 * 非零退出或进程异常 → throw { kind, message }。
 *
 * @param {{
 *   prompt: string,
 *   sessionId?: string|null,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   spawnImpl?: typeof import('node:child_process').spawn
 * }} options
 * @returns {Promise<{ sessionId: string|null, text: string }>}
 */
export async function runClaude({ prompt, sessionId, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = nodeSpawn }) {
  return new Promise((resolve, reject) => {
    const argv = buildArgv(prompt, sessionId);
    let child;

    try {
      child = spawnImpl('claude', argv, {
        cwd: cwd || process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // 同步 spawn 失败（ENOENT 等）
      return reject({
        kind: 'driver',
        message: err.message || String(err),
      });
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    // 软超时
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
      reject({ kind: 'timeout', message: `claude process timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const kind = err.code === 'ENOENT' ? 'driver' : 'driver';
      reject({ kind, message: err.message || String(err) });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject({
          kind: code == null ? 'unknown' : 'driver',
          message: `claude exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
        });
        return;
      }
      try {
        const result = parseStreamJson(stdout);
        resolve(result);
      } catch (err) {
        reject({ kind: 'unknown', message: `parseStreamJson failed: ${err.message}` });
      }
    });
  });
}
