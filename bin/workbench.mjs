#!/usr/bin/env node
// bin/workbench.mjs — CLI 编排入口（DESIGN §7）
// 零外部依赖，ESM

import { createReadStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 导入工作区契约 ──────────────────────────────────────────────────────────
const {
  paths,
  readJSON,
  writeJSON,
  writeText,
  writeStatus,
  exists,
  latestRound,
} = await import(`${ROOT}/src/workspace.mjs`);

const { validateContent } = await import(`${ROOT}/src/protocol/schema.mjs`);

// ─── blocks → markdown 线性序列化 ────────────────────────────────────────────
function blocksToMarkdown(content) {
  const lines = [];
  const { title, session, round, blocks = [] } = content;

  if (title) lines.push(`# ${title}`, '');
  else lines.push(`# Round ${round} — ${session}`, '');

  for (const block of blocks) {
    // 标题
    if (block.title) lines.push(`## ${block.title}`, '');

    // 正文（按 type）
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
        const opts = block.options || [];
        for (const opt of opts) {
          const rec = block.recommendation === opt.id ? ' *(推荐)*' : '';
          lines.push(`- **${opt.label || opt.id}**${rec}${opt.desc ? ': ' + opt.desc : ''}`);
        }
        lines.push('');
        break;
      }
      case 'table': {
        const cols = block.columns || [];
        const rows = block.rows || [];
        if (cols.length) {
          lines.push('| ' + cols.join(' | ') + ' |');
          lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');
          for (const row of rows) lines.push('| ' + row.join(' | ') + ' |');
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

// ─── cmdRender ───────────────────────────────────────────────────────────────
/**
 * 渲染一轮内容到 workspace 文件。
 * @param {string} session  会话 id
 * @param {object} contentObj  符合 DESIGN §2 的 content 对象
 * @returns {{ session: string, round: number }}
 */
export async function cmdRender(session, contentObj) {
  // 若 contentObj 没有 round，先赋值再校验（以便 validateContent 通过 round>=1）
  const round = contentObj.round != null
    ? contentObj.round
    : latestRound(session) + 1;

  const toValidate = { ...contentObj, session, round };

  const result = validateContent(toValidate);
  if (!result.ok) {
    const err = new Error(`validateContent failed: ${result.errors.join('; ')}`);
    err.errors = result.errors;
    throw err;
  }

  // 写 content.json
  writeJSON(paths.content(session, round), toValidate);

  // 写 content.md（blocks 线性序列化）
  const md = blocksToMarkdown(toValidate);
  writeText(paths.contentMd(session, round), md);

  // 更新 status
  writeStatus(session, { state: 'rendered', round });

  return { session, round };
}

// ─── present / wait（供 skill 一键调用）─────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readSource(src) {
  if (!src || src === '-' || src.startsWith('--')) return await readStdin();
  return readFileSync(src, 'utf8');
}

// 确保 server 在运行（不在则 detached 拉起，保活于本命令退出后）
async function ensureServer(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return 'already'; } catch {}
  const { spawn } = await import('node:child_process');
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [self, 'serve', '--port', String(port)], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return 'started'; } catch {}
    await sleep(100);
  }
  return 'starting';
}

/** 一键：确保 server + 渲染一轮 + 返回可打开的 URL。 */
export async function cmdPresent(session, contentObj, { port = 8099 } = {}) {
  const server = await ensureServer(port);
  const { round } = await cmdRender(session, contentObj);
  const base = `http://127.0.0.1:${port}/render/?session=${encodeURIComponent(session)}`;
  // 默认给"不带 round"的链接 → 跟随最新轮（AI 出新一轮时页面自动推进，用户无需换链接）
  const url = base;
  // 需要固定看这一轮（回顾旧版）时才用带 round 的
  const urlPinned = `${base}&round=${round}`;
  return { ok: true, session, round, url, urlPinned, server, next: `node bin/workbench.mjs wait ${session} ${round}` };
}

/** 阻塞轮询该轮 feedback，出现即返回其内容；超时返回 timeout。供 Agent 后台运行→提交即被唤醒。 */
export async function cmdWait(session, round, { timeoutMs = 3600000, intervalMs = 2000, nowFn = Date.now } = {}) {
  const fbPath = paths.feedback(session, round);
  const deadline = nowFn() + timeoutMs;
  while (nowFn() < deadline) {
    if (exists(fbPath)) {
      return { ok: true, event: 'feedback', session, round, feedback: readJSON(fbPath) };
    }
    await sleep(intervalMs);
  }
  return { ok: false, event: 'timeout', session, round };
}

// ─── --port 解析助手 ──────────────────────────────────────────────────────────
function parsePort(args, defaultPort = 8099) {
  const idx = args.indexOf('--port');
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return defaultPort;
}

// ─── 用法 ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
vibecoding workbench — CLI 编排

用法：
  workbench present <session> [content.json|-]  一键：确保 server + 渲染一轮 + 返回 URL（推荐给 skill 用）
  workbench wait <session> <round> [--timeout 秒]  监听该轮提交，出现反馈即返回其内容（后台运行）
  workbench render <session> <content.json|->   仅渲染一轮内容（- 表示从 stdin 读取）
  workbench serve [--port N]                    启动 HTTP server（默认 8099）
  workbench watch                               启动 listener，监管自愈（最多重启 5 次）
  workbench up [--port N]                       同时启动 serve + watch
  workbench --help                              显示此帮助

选项：
  --port N    指定端口号（用于 serve / up）

示例：
  workbench render ses_001 content.json
  workbench render ses_001 -              # 从 stdin 读取 JSON
  workbench serve --port 8080
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
      if (!session) { console.error('用法: workbench present <session> [content.json|-] [--port N]'); process.exit(1); }
      const port = parsePort(rest);
      const contentObj = JSON.parse(await readSource(rest[1]));
      const r = await cmdPresent(session, contentObj, { port });
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
      const { startServer } = await import(`${ROOT}/src/server/server.mjs`);
      startServer(port); // startServer(portNumber) -> server（同步返回，server 保活进程）
      console.log(`workbench serve → http://127.0.0.1:${port}/render/  (Ctrl+C 退出)`);
      break;
    }

    case 'watch': {
      await cmdWatch();
      break;
    }

    case 'up': {
      const port = parsePort(rest);
      // 并行启动 server + listener（watch 模式）
      const [{ startServer }, { startListener }] = await Promise.all([
        import(`${ROOT}/src/server/server.mjs`),
        import(`${ROOT}/src/loop/listener.mjs`),
      ]);
      // server 在同进程启动（同步返回，非阻塞），listener 监管自愈
      startServer(port);
      console.log(`workbench up → http://127.0.0.1:${port}/render/  (serve + watch)`);
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
