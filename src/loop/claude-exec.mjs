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
 * 脱敏 claude CLI 错误文本中的 Anthropic 密钥，保留其余诊断上下文。
 * @param {unknown} value
 * @returns {string}
 */
export function redactSecrets(value) {
  return String(value ?? '')
    .replace(
      /\b(ANTHROPIC_API_KEY\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/g,
      '$1***',
    )
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, '***');
}

/**
 * 执行单次 claude CLI。fallbackEligible 仅用于上层判断 SDK 托底，不对外暴露。
 */
function runClaudeOnce({ argv, cwd, timeoutMs, spawnImpl, env }) {
  return new Promise((resolve, reject) => {
    let child;
    let timer;
    let settled = false;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    };

    const resolveOnce = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    try {
      child = spawnImpl('claude', argv, {
        cwd: cwd || process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // 同步 spawn 失败（ENOENT 等）
      rejectOnce({
        kind: 'driver',
        message: err.message || String(err),
        fallbackEligible: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    // 软超时
    timer = setTimeout(() => {
      if (settled) return;
      // 先锁定 Promise 终态，避免 kill 同步触发 close 二次 settle。
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
      reject({
        kind: 'timeout',
        message: `claude process timed out after ${timeoutMs}ms`,
        fallbackEligible: true,
      });
    }, timeoutMs);

    child.on('error', (err) => {
      rejectOnce({
        kind: 'driver',
        message: err.message || String(err),
        fallbackEligible: false,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const safeStderr = redactSecrets(stderr).slice(0, 500);
        rejectOnce({
          kind: code == null ? 'unknown' : 'driver',
          message: `claude exited with code ${code}. stderr: ${safeStderr}`,
          fallbackEligible: code != null,
        });
        return;
      }
      try {
        const result = parseStreamJson(stdout);
        resolveOnce(result);
      } catch (err) {
        rejectOnce({
          kind: 'unknown',
          message: `parseStreamJson failed: ${err.message}`,
          fallbackEligible: false,
        });
      }
    });
  });
}

/**
 * 运行 claude CLI，首跑不注入 API key。
 * 首跑非零退出或超时且调用环境有 API key 时，恰好用 key 托底一次。
 * driverSource=subscription 是产品路径名；CLI 外部无法审计其最终认证与计费方式。
 *
 * @param {{
 *   prompt: string,
 *   sessionId?: string|null,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   spawnImpl?: typeof import('node:child_process').spawn
 * }} options
 * @returns {Promise<{ sessionId: string|null, text: string, driverSource: 'subscription'|'sdk-fallback' }>}
 */
export async function runClaude({ prompt, sessionId, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = nodeSpawn }) {
  const argv = buildArgv(prompt, sessionId);
  const inheritedEnv = { ...process.env };
  const apiKey = inheritedEnv.ANTHROPIC_API_KEY;
  const hasApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0;

  // 首跑仅确保不注入 API key，具体默认凭据由 claude CLI 自行决定。
  const subscriptionEnv = { ...inheritedEnv };
  delete subscriptionEnv.ANTHROPIC_API_KEY;

  try {
    const result = await runClaudeOnce({ argv, cwd, timeoutMs, spawnImpl, env: subscriptionEnv });
    return { ...result, driverSource: 'subscription' };
  } catch (err) {
    const { fallbackEligible = false, ...subscriptionError } = err;
    if (!fallbackEligible || !hasApiKey) {
      throw { ...subscriptionError, driverSource: 'subscription' };
    }

    try {
      const result = await runClaudeOnce({
        argv,
        cwd,
        timeoutMs,
        spawnImpl,
        env: { ...inheritedEnv, ANTHROPIC_API_KEY: apiKey },
      });
      return { ...result, driverSource: 'sdk-fallback' };
    } catch (fallbackErr) {
      const { fallbackEligible: _ignored, ...publicError } = fallbackErr;
      throw { ...publicError, driverSource: 'sdk-fallback' };
    }
  }
}
