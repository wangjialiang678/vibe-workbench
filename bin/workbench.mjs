#!/usr/bin/env node
// bin/workbench.mjs — CLI 编排入口（DESIGN §7）
// 零外部依赖，ESM

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 导入工作区契约 ──────────────────────────────────────────────────────────
const {
  paths,
  readJSON,
  writeStatus,
  exists,
  writeRound,
} = await import(`${ROOT}/src/workspace.mjs`);

const {
  lintContent,
  formatLint,
  findIncompleteDecisions,
  formatIncompleteDecisions,
} = await import(`${ROOT}/src/protocol/lint.mjs`);

// ─── cmdRender ───────────────────────────────────────────────────────────────
/**
 * 渲染一轮内容到 workspace 文件。
 * @param {string} session  会话 id
 * @param {object} contentObj  符合 DESIGN §2 的 content 对象
 * @returns {{ session: string, round: number }}
 */
export async function cmdRender(session, contentObj) {
  const result = writeRound(session, contentObj);

  // 作者侧 lint（iteration-brief P1）：warn 不阻断，打 stderr（保持 stdout 的 JSON 干净）
  const warnings = lintContent(result.content);
  if (warnings.length) console.error(formatLint(warnings));

  return { session: result.session, round: result.round };
}

// ─── present / wait（供 skill 一键调用）─────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function remoteBaseUrl() {
  const raw = process.env.WORKBENCH_REMOTE_URL?.trim();
  if (!raw) return null;
  try {
    const base = new URL(raw);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('仅支持 HTTP/HTTPS');
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    return base;
  } catch (error) {
    throw new Error(`WORKBENCH_REMOTE_URL 无效：${error.message}`);
  }
}

function remoteUrl(base, relativePath, query = {}) {
  const target = new URL(relativePath.replace(/^\//, ''), base);
  for (const [key, value] of Object.entries(query)) {
    if (value != null) target.searchParams.set(key, String(value));
  }
  return target;
}

async function requestRemoteJson(base, relativePath, {
  method = 'GET',
  query,
  body,
  timeoutMs = 30000,
} = {}) {
  const target = remoteUrl(base, relativePath, query);
  const headers = {};
  const token = process.env.WORKBENCH_TOKEN || '';
  if (token) headers['x-workbench-token'] = token;
  if (body != null) headers['content-type'] = 'application/json';

  let response;
  let raw;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  timer.unref?.();
  try {
    response = await fetch(target, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // 共享口令绝不跟随 30x 发往另一个 origin；重定向由调用者改正 REMOTE_URL 后重试。
      redirect: 'manual',
    });
    raw = await response.text();
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const detail = timedOut
      ? `请求超过 ${Math.max(1, timeoutMs)}ms 未完成`
      : (/ByteString|character.*255/i.test(error?.message || '')
          ? 'WORKBENCH_TOKEN 用作请求头时必须只包含 ASCII 字符'
          : (error?.message || String(error)));
    const wrapped = new Error(`远程工作台请求失败：${detail}`);
    if (timedOut) wrapped.code = 'REMOTE_TIMEOUT';
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`远程工作台返回格式无效（HTTP ${response.status}）`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`远程工作台返回格式无效（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(`远程工作台返回 ${response.status}：${payload?.error || '请求失败'}`);
  }
  return payload;
}

async function readSource(src) {
  if (!src || src === '-' || src.startsWith('--')) return await readStdin();
  return readFileSync(src, 'utf8');
}

// 确保 server 在运行（不在则 detached 拉起，保活于本命令退出后）
async function ensureServer(port) {
  const token = process.env.WORKBENCH_TOKEN || '';
  // header 受 ByteString 限制，中文 token 无法发送；query 由 URL 自动百分号编码。
  const healthUrl = new URL(`http://127.0.0.1:${port}/api/health`);
  if (token) healthUrl.searchParams.set('token', token);
  try { const r = await fetch(healthUrl); if (r.ok) return 'already'; } catch {}
  const { spawn } = await import('node:child_process');
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [self, 'serve', '--port', String(port)], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(healthUrl); if (r.ok) return 'started'; } catch {}
    await sleep(100);
  }
  return 'starting';
}

/** 一键：校验决策完整性 + 确保 server + 渲染一轮 + 返回可打开的 URL。 */
export async function cmdPresent(session, contentObj, { port = 8099, allowIncompleteDecisions = false } = {}) {
  if (!allowIncompleteDecisions) {
    const issues = findIncompleteDecisions(contentObj);
    if (issues.length) {
      const err = new Error(formatIncompleteDecisions(issues));
      err.errors = issues.map((issue) => `[${issue.blockId}] 缺少：${issue.missingFields.join('、')}`);
      err.incompleteDecisions = issues;
      throw err;
    }
  }

  const remote = remoteBaseUrl();
  if (remote) {
    // 远程也在 CLI 侧输出 warn，保持 present 的 stderr 体验；服务端仍独立执行硬校验。
    const warnings = lintContent({ ...contentObj, session });
    if (warnings.length) console.error(formatLint(warnings));

    const response = await requestRemoteJson(remote, '/api/rounds', {
      method: 'POST',
      query: allowIncompleteDecisions ? { allowIncomplete: 1 } : undefined,
      body: { ...contentObj, session },
    });
    const { round } = response;
    if (response.ok !== true || response.session !== session || !Number.isSafeInteger(round) || round < 1) {
      throw new Error('远程工作台返回格式无效：缺少有效的 session/round');
    }
    const pageUrl = remoteUrl(remote, '/render/', { session });
    const token = process.env.WORKBENCH_TOKEN || '';
    if (token) pageUrl.searchParams.set('token', token);
    const url = pageUrl.href;
    pageUrl.searchParams.set('round', String(round));
    const result = {
      ok: true,
      session,
      round,
      url,
      urlPinned: pageUrl.href,
      server: 'remote',
      next: `node bin/workbench.mjs wait ${session} ${round}`,
    };
    if (allowIncompleteDecisions || response.lintBypassed) result.lintBypassed = true;
    return result;
  }

  const server = await ensureServer(port);
  const { round } = await cmdRender(session, contentObj);
  const pageUrl = new URL(`http://127.0.0.1:${port}/render/`);
  pageUrl.searchParams.set('session', session);
  const token = process.env.WORKBENCH_TOKEN || '';
  if (token) pageUrl.searchParams.set('token', token);
  // 默认给"不带 round"的链接 → 跟随最新轮（AI 出新一轮时页面自动推进，用户无需换链接）
  const url = pageUrl.href;
  // 需要固定看这一轮（回顾旧版）时才用带 round 的
  pageUrl.searchParams.set('round', String(round));
  const urlPinned = pageUrl.href;
  const result = { ok: true, session, round, url, urlPinned, server, next: `node bin/workbench.mjs wait ${session} ${round}` };
  if (allowIncompleteDecisions) result.lintBypassed = true;
  return result;
}

/** 阻塞轮询该轮 feedback，出现即返回其内容；超时返回 timeout。供 Agent 后台运行→提交即被唤醒。 */
export async function cmdWait(session, round, {
  timeoutMs = 3600000,
  intervalMs,
  nowFn = Date.now,
  sleepFn = sleep,
} = {}) {
  const remote = remoteBaseUrl();
  const pollInterval = intervalMs ?? (remote ? 3000 : 2000);
  const fbPath = remote ? null : paths.feedback(session, round);
  const deadline = nowFn() + timeoutMs;
  while (nowFn() < deadline) {
    if (remote) {
      let response;
      try {
        response = await requestRemoteJson(remote, '/api/feedback', {
          query: { session, round },
          timeoutMs: Math.max(1, deadline - nowFn()),
        });
      } catch (error) {
        if (error?.code === 'REMOTE_TIMEOUT' && nowFn() >= deadline) {
          return { ok: false, event: 'timeout', session, round };
        }
        throw error;
      }
      if (response.ok && response.feedback) {
        if (typeof response.feedback !== 'object'
          || response.feedback.session !== session
          || response.feedback.round !== round) {
          throw new Error('远程工作台返回格式无效：feedback 与请求的 session/round 不一致');
        }
        return { ok: true, event: 'feedback', session, round, feedback: response.feedback };
      }
      if (!response.pending) throw new Error('远程工作台返回了无法识别的反馈状态');
    } else if (exists(fbPath)) {
      return { ok: true, event: 'feedback', session, round, feedback: readJSON(fbPath) };
    }
    const remaining = deadline - nowFn();
    if (remaining <= 0) break;
    await sleepFn(Math.min(pollInterval, remaining));
  }
  return { ok: false, event: 'timeout', session, round };
}

// ─── --port 解析助手 ──────────────────────────────────────────────────────────
function parsePort(args, defaultPort = 8099) {
  const idx = args.indexOf('--port');
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return defaultPort;
}

function parseHost(args, defaultHost = '127.0.0.1') {
  const idx = args.indexOf('--host');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultHost;
}

// ─── 用法 ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
vibecoding workbench — CLI 编排

用法：
  workbench present <session> [content.json|-] [--allow-incomplete-decisions]  校验并渲染一轮（推荐给 skill 用）
  workbench wait <session> <round> [--timeout 秒]  监听该轮提交，出现反馈即返回其内容（后台运行）
  workbench render <session> <content.json|->   仅渲染一轮内容（- 表示从 stdin 读取）
  workbench serve [--port N] [--host HOST]      启动 HTTP server（默认 127.0.0.1:8099）
  workbench watch                               启动 listener，监管自愈（最多重启 5 次）
  workbench up [--port N] [--host HOST]         同时启动 serve + watch
  workbench --help                              显示此帮助

选项：
  --port N                         指定端口号
  --host HOST                      指定监听地址（默认 127.0.0.1；非本机地址须设置 WORKBENCH_TOKEN）
  --allow-incomplete-decisions     present 临时跳过决策完整性硬校验（仍输出 lint）

示例：
  workbench render ses_001 content.json
  workbench render ses_001 -              # 从 stdin 读取 JSON
  workbench serve --port 8080 --host 127.0.0.1
  workbench watch
  workbench up --port 8080
`.trim());
}

// ─── stdin 读取助手 ───────────────────────────────────────────────────────────
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// ─── 监管 watch（supervisor） ────────────────────────────────────────────────
async function cmdWatch({ maxRestarts = 5, session = null } = {}) {
  let restarts = 0;

  async function startListener() {
    const { startListener: start } = await import(`${ROOT}/src/loop/listener.mjs`);
    return start();
  }

  async function run() {
    try {
      await startListener();
    } catch (err) {
      console.error('[workbench:watch] listener error:', err.message);
      restarts += 1;
      if (restarts > maxRestarts) {
        console.error(`[workbench:watch] 重启次数耗尽（${maxRestarts}次），标记 supervisorState:dead`);
        // 对相关 session 写 dead 状态
        if (session) {
          writeStatus(session, { supervisorState: 'dead' });
        } else {
          // 扫描所有 session
          const { listSessions } = await import(`${ROOT}/src/workspace.mjs`);
          for (const s of listSessions()) {
            writeStatus(s, { supervisorState: 'dead' });
          }
        }
        process.exit(1);
      }
      console.error(`[workbench:watch] 第 ${restarts} 次重启…`);
      return run();
    }
  }

  // 捕获未处理异常
  process.on('uncaughtException', async (err) => {
    console.error('[workbench:watch] uncaughtException:', err.message);
    restarts += 1;
    if (restarts > maxRestarts) {
      console.error('[workbench:watch] 重启次数耗尽，退出');
      process.exit(1);
    }
    await run();
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[workbench:watch] unhandledRejection:', reason);
    restarts += 1;
    if (restarts > maxRestarts) {
      console.error('[workbench:watch] 重启次数耗尽，退出');
      process.exit(1);
    }
    await run();
  });

  await run();
}

// ─── 主 CLI 入口 ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const [cmd, ...rest] = args;

  switch (cmd) {
    case 'render': {
      // render <session> <path|->
      const session = rest[0];
      const src = rest[1];

      if (!session || !src) {
        console.error('用法: workbench render <session> <content.json|->');
        process.exit(1);
      }

      let raw;
      if (src === '-') {
        raw = await readStdin();
      } else {
        const { readFileSync } = await import('node:fs');
        raw = readFileSync(src, 'utf8');
      }

      const contentObj = JSON.parse(raw);
      const result = await cmdRender(session, contentObj);
      console.log(JSON.stringify(result));
      break;
    }

    case 'present': {
      const session = rest[0];
      if (!session) { console.error('用法: workbench present <session> [content.json|-] [--port N] [--allow-incomplete-decisions]'); process.exit(1); }
      const port = parsePort(rest);
      const allowIncompleteDecisions = rest.includes('--allow-incomplete-decisions');
      const contentObj = JSON.parse(await readSource(rest[1]));
      const r = await cmdPresent(session, contentObj, { port, allowIncompleteDecisions });
      console.log(JSON.stringify(r));
      break;
    }

    case 'wait': {
      const session = rest[0];
      const round = parseInt(rest[1], 10);
      if (!session || !Number.isInteger(round)) { console.error('用法: workbench wait <session> <round> [--timeout 秒]'); process.exit(1); }
      const tIdx = rest.indexOf('--timeout');
      const timeoutMs = tIdx >= 0 ? parseInt(rest[tIdx + 1], 10) * 1000 : 3600000;
      const r = await cmdWait(session, round, { timeoutMs });
      console.log(JSON.stringify(r));
      if (!r.ok) process.exit(2);
      break;
    }

    case 'serve': {
      const port = parsePort(rest);
      const host = parseHost(rest);
      const { startServer } = await import(`${ROOT}/src/server/server.mjs`);
      startServer(port, host); // 同步校验 host/token 后监听，server 保活进程
      console.log(`workbench serve → http://${host}:${port}/render/  (Ctrl+C 退出)`);
      break;
    }

    case 'watch': {
      await cmdWatch();
      break;
    }

    case 'up': {
      const port = parsePort(rest);
      const host = parseHost(rest);
      // 并行启动 server + listener（watch 模式）
      const [{ startServer }, { startListener }] = await Promise.all([
        import(`${ROOT}/src/server/server.mjs`),
        import(`${ROOT}/src/loop/listener.mjs`),
      ]);
      // server 在同进程启动（同步返回，非阻塞），listener 监管自愈
      startServer(port, host);
      console.log(`workbench up → http://${host}:${port}/render/  (serve + watch)`);
      await cmdWatch();
      break;
    }

    default:
      console.error(`未知命令: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

// 仅直接执行时运行 main（import 时不执行）
const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);
if (isMain) {
  main().catch((err) => {
    console.error('[workbench] fatal:', err.message);
    process.exit(1);
  });
}
