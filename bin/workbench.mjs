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

const {
  DEFAULT_PARTICIPANTS_FILE,
  addParticipant,
  listParticipants,
  revokeParticipant,
} = await import(`${ROOT}/src/participants.mjs`);

const {
  appendStreamEntry,
  migrateSessionComments,
  readStreamEntries,
} = await import(`${ROOT}/src/stream.mjs`);

const {
  parseMarkdownSource,
  publishDocument,
} = await import(`${ROOT}/src/documents.mjs`);

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
  signal: externalSignal,
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
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;
  try {
    response = await fetch(target, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal,
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

function remoteFeedbackEvent(response, session, round) {
  if (response.ok && response.feedback) {
    if (typeof response.feedback !== 'object'
      || response.feedback.session !== session
      || response.feedback.round !== round) {
      throw new Error('远程工作台返回格式无效：feedback 与请求的 session/round 不一致');
    }
    return { ok: true, event: 'feedback', session, round, feedback: response.feedback };
  }
  if (!response.pending) throw new Error('远程工作台返回了无法识别的反馈状态');
  return null;
}

function remoteMessageEntries(response) {
  if (!response || response.ok !== true || !Array.isArray(response.entries)) {
    throw new Error('远程工作台返回格式无效：messages 缺少 entries');
  }
  for (const entry of response.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) {
      throw new Error('远程工作台返回格式无效：message 条目无效');
    }
  }
  return response.entries;
}

function localInviteBase(baseUrl) {
  const raw = baseUrl || process.env.WORKBENCH_BASE_URL || `http://127.0.0.1:${parseInt(process.env.PORT, 10) || 8099}`;
  try {
    const base = new URL(raw);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('仅支持 HTTP/HTTPS');
    return base;
  } catch (error) {
    throw new Error(`WORKBENCH_BASE_URL 无效：${error.message}`);
  }
}

function localInviteUrl(token, baseUrl) {
  const target = new URL('/render/', localInviteBase(baseUrl));
  target.searchParams.set('token', token);
  return target.href;
}

/** 管理参与者：设置远程地址时调用管理 API，否则直接维护本地 config/participants.json。 */
export async function cmdParticipantAdd(id, name, {
  participantsFile = DEFAULT_PARTICIPANTS_FILE,
  baseUrl,
} = {}) {
  const remote = remoteBaseUrl();
  if (remote) {
    return requestRemoteJson(remote, '/api/participants', {
      method: 'POST',
      body: { id, name },
    });
  }
  const participant = addParticipant({ id, name }, { filePath: participantsFile });
  const { token, ...safeParticipant } = participant;
  return { ok: true, participant: safeParticipant, url: localInviteUrl(token, baseUrl) };
}

export async function cmdParticipantList({ participantsFile = DEFAULT_PARTICIPANTS_FILE } = {}) {
  const remote = remoteBaseUrl();
  if (remote) return requestRemoteJson(remote, '/api/participants');
  return { ok: true, participants: listParticipants(participantsFile) };
}

export async function cmdParticipantRevoke(id, { participantsFile = DEFAULT_PARTICIPANTS_FILE } = {}) {
  const remote = remoteBaseUrl();
  if (remote) {
    return requestRemoteJson(remote, `/api/participants/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  if (!revokeParticipant(id, { filePath: participantsFile })) throw new Error(`参与者 ${id} 不存在`);
  return { ok: true, id };
}

/** 发布 Markdown 文档；远程模式走 API，本地模式直接写当前 workspace。 */
export async function cmdDocPublish(session, category, slug, sourcePath, { title } = {}) {
  const source = readFileSync(sourcePath, 'utf8');
  const parsed = parseMarkdownSource(source);
  const defaultTitle = path.basename(sourcePath, path.extname(sourcePath));
  const document = {
    session,
    category,
    slug,
    title: title ?? parsed.title ?? defaultTitle,
    body: parsed.body,
  };

  const remote = remoteBaseUrl();
  if (remote) {
    const response = await requestRemoteJson(remote, '/api/documents', {
      method: 'POST',
      body: document,
    });
    if (response.ok !== true || !response.document
      || response.document.category !== category
      || response.document.slug !== slug) {
      throw new Error('远程工作台返回格式无效：缺少匹配的 document');
    }
    return response;
  }

  const saved = publishDocument(document, { exactSession: true });
  appendStreamEntry(session, {
    author: { id: 'ai', name: 'AI', role: 'ai' },
    kind: 'receipt',
    text: `文档已更新：${saved.document.title}`,
  }, { exactSession: true });
  return { ok: true, ...saved };
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
    if (typeof response.warning === 'string' && response.warning.trim()) {
      result.warning = response.warning.trim();
      console.error(`警告：${result.warning}`);
    }
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
  events = false,
} = {}) {
  const remote = remoteBaseUrl();
  const pollInterval = intervalMs ?? (remote ? 3000 : 2000);
  const fbPath = remote ? null : paths.feedback(session, round);
  const deadline = nowFn() + timeoutMs;

  // 默认分支保持旧行为；只有 --events 才读取会话流。
  if (!events) {
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
        const event = remoteFeedbackEvent(response, session, round);
        if (event) return event;
      } else if (exists(fbPath)) {
        return { ok: true, event: 'feedback', session, round, feedback: readJSON(fbPath) };
      }
      const remaining = deadline - nowFn();
      if (remaining <= 0) break;
      await sleepFn(Math.min(pollInterval, remaining));
    }
    return { ok: false, event: 'timeout', session, round };
  }

  let streamCursor = null;
  if (remote) {
    try {
      const baseline = remoteMessageEntries(await requestRemoteJson(remote, '/api/messages', {
        query: { session },
        timeoutMs: Math.max(1, deadline - nowFn()),
      }));
      streamCursor = baseline.at(-1)?.id || null;
    } catch (error) {
      if (error?.code === 'REMOTE_TIMEOUT' && nowFn() >= deadline) {
        return { ok: false, event: 'timeout', session, round };
      }
      throw error;
    }
  } else {
    streamCursor = readStreamEntries(session, { limit: 1, exactSession: true }).at(-1)?.id || null;
  }

  while (nowFn() < deadline) {
    if (remote) {
      const controller = new AbortController();
      const requestTimeout = Math.max(1, deadline - nowFn());
      const feedbackCheck = requestRemoteJson(remote, '/api/feedback', {
        query: { session, round },
        timeoutMs: requestTimeout,
        signal: controller.signal,
      }).then((response) => ({ source: 'feedback', event: remoteFeedbackEvent(response, session, round) }))
        .catch((error) => ({ source: 'feedback', error }));
      const messageCheck = requestRemoteJson(remote, '/api/messages', {
        query: { session, ...(streamCursor ? { since: streamCursor } : {}) },
        timeoutMs: requestTimeout,
        signal: controller.signal,
      }).then((response) => {
        const entries = remoteMessageEntries(response);
        if (entries.length) streamCursor = entries.at(-1).id;
        return {
          source: 'message',
          event: entries.length
            ? { ok: true, event: 'message', session, round, message: entries[0] }
            : null,
        };
      }).catch((error) => ({ source: 'message', error }));

      const pending = new Map([
        ['feedback', feedbackCheck],
        ['message', messageCheck],
      ]);
      const first = await Promise.race(pending.values());
      pending.delete(first.source);
      if (first.event) {
        controller.abort();
        await Promise.allSettled(pending.values());
        return first.event;
      }
      const second = await pending.values().next().value;
      if (second.event) {
        controller.abort();
        return second.event;
      }
      const error = first.error || second.error;
      if (error) {
        if (error?.code === 'REMOTE_TIMEOUT' && nowFn() >= deadline) {
          return { ok: false, event: 'timeout', session, round };
        }
        throw error;
      }
    } else {
      if (exists(fbPath)) {
        return { ok: true, event: 'feedback', session, round, feedback: readJSON(fbPath) };
      }
      const entries = readStreamEntries(session, {
        ...(streamCursor ? { since: streamCursor } : {}),
        exactSession: true,
      });
      if (entries.length) {
        streamCursor = entries.at(-1).id;
        return { ok: true, event: 'message', session, round, message: entries[0] };
      }
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
  workbench wait <session> <round> [--timeout 秒] [--events]  监听反馈；events 模式也监听新消息
  workbench doc-publish <session> <category> <slug> <md文件路径> [--title 标题]  发布或更新文档
  workbench stream-migrate <session>            把历史 feedback.sessionComment 幂等迁入会话流
  workbench render <session> <content.json|->   仅渲染一轮内容（- 表示从 stdin 读取）
  workbench participant add <id> <name>         新增参与者并输出个人邀请链接
  workbench participant list                    列出参与者（不显示 token）
  workbench participant revoke <id>             吊销参与者链接
  workbench serve [--port N] [--host HOST]      启动 HTTP server（默认 127.0.0.1:8099）
  workbench watch                               启动 listener，监管自愈（最多重启 5 次）
  workbench up [--port N] [--host HOST]         同时启动 serve + watch
  workbench --help                              显示此帮助

选项：
  --port N                         指定端口号
  --host HOST                      指定监听地址（默认 127.0.0.1；非本机地址须设置 WORKBENCH_TOKEN）
  --allow-incomplete-decisions     present 临时跳过决策完整性硬校验（仍输出 lint）
  --events                         wait 同时监听 feedback 与会话流新事件
  --title 标题                     doc-publish 显式标题（默认取 frontmatter title 或文件名）

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
      if (!session || !Number.isInteger(round)) { console.error('用法: workbench wait <session> <round> [--timeout 秒] [--events]'); process.exit(1); }
      const tIdx = rest.indexOf('--timeout');
      const timeoutMs = tIdx >= 0 ? parseInt(rest[tIdx + 1], 10) * 1000 : 3600000;
      const events = rest.includes('--events');
      const r = await cmdWait(session, round, { timeoutMs, events });
      console.log(JSON.stringify(r));
      if (!r.ok) process.exit(2);
      break;
    }

    case 'doc-publish': {
      const [session, category, slug, sourcePath] = rest;
      const titleIndex = rest.indexOf('--title');
      if (!session || !category || !slug || !sourcePath
        || (titleIndex >= 0 && !rest[titleIndex + 1])) {
        console.error('用法: workbench doc-publish <session> <category> <slug> <md文件路径> [--title 标题]');
        process.exit(1);
      }
      const title = titleIndex >= 0 ? rest[titleIndex + 1] : undefined;
      console.log(JSON.stringify(
        await cmdDocPublish(session, category, slug, sourcePath, { title }),
      ));
      break;
    }

    case 'stream-migrate': {
      const session = rest[0];
      if (!session) { console.error('用法: workbench stream-migrate <session>'); process.exit(1); }
      console.log(JSON.stringify(migrateSessionComments(session)));
      break;
    }

    case 'participant': {
      const action = rest[0];
      if (action === 'add') {
        const id = rest[1];
        const name = rest.slice(2).join(' ').trim();
        if (!id || !name) { console.error('用法: workbench participant add <id> <name>'); process.exit(1); }
        console.log(JSON.stringify(await cmdParticipantAdd(id, name)));
      } else if (action === 'list') {
        console.log(JSON.stringify(await cmdParticipantList()));
      } else if (action === 'revoke') {
        const id = rest[1];
        if (!id) { console.error('用法: workbench participant revoke <id>'); process.exit(1); }
        console.log(JSON.stringify(await cmdParticipantRevoke(id)));
      } else {
        console.error('用法: workbench participant <add|list|revoke>');
        process.exit(1);
      }
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
