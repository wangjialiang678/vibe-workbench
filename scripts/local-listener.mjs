#!/usr/bin/env node
// 本地收件箱监听器：只经 HTTP API 访问云端任务，不读取或写入服务端 workspace/inbox。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:8099';
export const DEFAULT_POLL_MS = 30 * 1000;
export const DEFAULT_RENEW_INTERVAL_MS = 10 * 60 * 1000;
export const DEFAULT_CLAUDE_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_TCD_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_TCD_POLL_MS = 5 * 1000;
export const DEFAULT_SHUTDOWN_WAIT_MS = 60 * 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
const WORKBENCH_REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class WorkbenchRequestError extends Error {
  constructor(pathname, status, payload) {
    super(`工作台返回 ${status}：${payload?.error || '请求失败'}`);
    this.name = 'WorkbenchRequestError';
    this.pathname = pathname;
    this.status = status;
    this.payload = payload;
  }
}

class AbortTaskError extends Error {
  constructor() {
    super('任务因监听器下线而中止');
    this.name = 'AbortTaskError';
  }
}

function positiveInteger(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} 必须是正整数`);
  }
  return number;
}

function normalizeUrl(value) {
  let url;
  try {
    url = new URL(value || DEFAULT_WORKBENCH_URL);
  } catch (error) {
    throw new Error(`WORKBENCH_URL 无效：${error.message}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('WORKBENCH_URL 仅支持 HTTP/HTTPS');
  }
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

function parseRepoMap(value) {
  if (value == null || value.trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`LISTENER_REPO_MAP 不是有效 JSON：${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LISTENER_REPO_MAP 必须是 projectId 到绝对路径的 JSON 对象');
  }
  const repoMap = {};
  for (const [projectId, repoPath] of Object.entries(parsed)) {
    if (!projectId.trim() || typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) {
      throw new Error(`LISTENER_REPO_MAP.${projectId} 必须是绝对路径`);
    }
    repoMap[projectId] = path.normalize(repoPath);
  }
  return repoMap;
}

/** 读取环境变量并生成不含凭证以外运行态配置的纯对象。 */
export function loadConfig(env = process.env, {
  hostname = os.hostname,
  pid = process.pid,
} = {}) {
  const token = typeof env.WORKBENCH_TOKEN === 'string' ? env.WORKBENCH_TOKEN : '';
  if (!token) throw new Error('缺少必填环境变量 WORKBENCH_TOKEN');
  const executor = typeof env.LISTENER_EXECUTOR === 'string' && env.LISTENER_EXECUTOR.trim()
    ? env.LISTENER_EXECUTOR.trim()
    : 'local-mac';
  const host = typeof hostname === 'function' ? hostname() : hostname;
  if (!host || !Number.isInteger(pid) || pid < 1) {
    throw new Error('无法生成唯一 claimedBy 标识');
  }
  return {
    workbenchUrl: normalizeUrl(env.WORKBENCH_URL),
    token,
    executor,
    pollMs: positiveInteger(env.POLL_MS, DEFAULT_POLL_MS, 'POLL_MS'),
    repoMap: parseRepoMap(env.LISTENER_REPO_MAP || ''),
    claimedBy: `${host}-${pid}`,
  };
}

function apiUrl(baseUrl, pathname, query = {}) {
  const target = new URL(pathname, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') target.searchParams.set(key, String(value));
  }
  return target;
}

async function requestJson(config, pathname, {
  method = 'GET',
  query,
  body,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(apiUrl(config.workbenchUrl, pathname, query), {
      method,
      headers: {
        'X-Workbench-Token': config.token,
        ...(body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: 'manual',
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`工作台返回了无效 JSON（HTTP ${response.status}）`);
    }
    if (!response.ok) throw new WorkbenchRequestError(pathname, response.status, payload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`工作台返回结构无效（HTTP ${response.status}）`);
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`工作台请求超时（${timeoutMs}ms）：${pathname}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function truncateCharacters(value, limit) {
  const characters = Array.from(String(value ?? ''));
  return characters.length <= limit ? characters.join('') : characters.slice(0, limit).join('');
}

function tailCharacters(value, limit) {
  const characters = Array.from(String(value ?? ''));
  return characters.length <= limit ? characters.join('') : characters.slice(-limit).join('');
}

function redactSecret(value, secret) {
  const text = String(value ?? '');
  return secret ? text.replaceAll(secret, '[已隐藏口令]') : text;
}

function nonEmptySummary(value, fallback) {
  const summary = truncateCharacters(String(value ?? '').trim(), 4000);
  return summary || fallback;
}

function appendLimited(current, chunk, limit = 64 * 1024) {
  const next = current + String(chunk);
  return next.length <= limit ? next : next.slice(0, limit);
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new AbortTaskError();
}

function waitMs(milliseconds, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new AbortTaskError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, milliseconds));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function terminateChild(child, signal) {
  try { child.kill(signal); } catch {}
}

/** 启动一个不经过 shell 的子进程，统一收集有限长度输出并处理超时/下线。 */
function runCommand(command, args, {
  cwd,
  env,
  timeoutMs,
  spawnImpl = nodeSpawn,
  signal,
  killGraceMs = 5000,
  abortKillGraceMs = 0,
} = {}) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timeoutTimer;
    let forceKillTimer;
    let abortHandler;

    const finish = (exitCode, exitSignal, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      if (spawnError) stderr = appendLimited(stderr, spawnError.message);
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : (timedOut || aborted ? null : 1),
        signal: exitSignal || null,
        timedOut,
        aborted,
        stdout,
        stderr,
        error: spawnError,
      });
    };

    const terminate = (reason) => {
      if (reason === 'timeout') timedOut = true;
      if (reason === 'abort') aborted = true;
      if (child) terminateChild(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          terminateChild(child, 'SIGKILL');
          finish(null, 'SIGKILL');
        }
      }, reason === 'abort' ? abortKillGraceMs : killGraceMs);
    };

    try {
      child = spawnImpl(command, args, {
        cwd,
        ...(env ? { env } : {}),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(1, null, error);
      return;
    }

    child.stdout?.on('data', (chunk) => { stdout = appendLimited(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = appendLimited(stderr, chunk); });
    child.once?.('error', (error) => finish(1, null, error));
    child.once?.('close', (exitCode, exitSignal) => finish(exitCode, exitSignal));

    abortHandler = () => terminate('abort');
    if (signal) {
      if (signal.aborted) abortHandler();
      else signal.addEventListener('abort', abortHandler, { once: true });
    }
    if (timeoutMs != null) timeoutTimer = setTimeout(() => terminate('timeout'), timeoutMs);
  });
}

function parseJsonOutput(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  for (const line of raw.split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch {}
  }
  return null;
}

function tcdJobId(stdout) {
  const parsed = parseJsonOutput(stdout);
  if (parsed && typeof parsed === 'object') {
    for (const key of ['id', 'jobId', 'taskId', 'runId']) {
      if (typeof parsed[key] === 'string' && parsed[key].trim()) return parsed[key].trim();
    }
  }
  const lines = String(stdout || '').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) || '';
  const labeled = last.match(/(?:id|job|task|run)\s*[:=]\s*([A-Za-z0-9._:-]+)/i);
  return labeled?.[1] || last;
}

const TCD_TERMINAL_STATES = new Set([
  'done', 'completed', 'complete', 'success', 'succeeded',
  'failed', 'failure', 'error', 'cancelled', 'canceled', 'timeout', 'timed_out',
]);
const TCD_SUCCESS_STATES = new Set(['done', 'completed', 'complete', 'success', 'succeeded']);

function tcdCheckResult(stdout) {
  const raw = String(stdout || '').trim();
  const parsed = parseJsonOutput(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const state = String(parsed.status ?? parsed.state ?? parsed.phase ?? '').toLowerCase();
    if (!TCD_TERMINAL_STATES.has(state) && parsed.done !== true && parsed.completed !== true) {
      return { terminal: false };
    }
    const ok = parsed.done === true || parsed.completed === true || TCD_SUCCESS_STATES.has(state);
    const value = parsed.summary ?? parsed.output ?? parsed.result ?? parsed.message ?? raw;
    return { terminal: true, ok, summary: typeof value === 'string' ? value : JSON.stringify(value) };
  }
  const firstLine = raw.split(/\r?\n/)[0].toLowerCase();
  const state = firstLine.match(/^(done|completed|complete|success|succeeded|failed|failure|error|cancelled|canceled|timeout|timed_out)\b/)?.[1];
  if (!state) return { terminal: false };
  return { terminal: true, ok: TCD_SUCCESS_STATES.has(state), summary: raw };
}

function taskRepo(task, config) {
  const projectId = task?.projectId || task?.payload?.projectId;
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('任务缺少 payload.projectId，无法选择本地仓库');
  }
  if (!Object.hasOwn(config.repoMap, projectId)) {
    throw new Error(`LISTENER_REPO_MAP 未配置项目 ${projectId}`);
  }
  return config.repoMap[projectId];
}

function taskPrompt(task) {
  const prompt = task?.payload?.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('任务缺少 payload.prompt');
  return prompt;
}

async function executeCodexTask(task, config, deps, signal) {
  const repo = taskRepo(task, config);
  const prompt = taskPrompt(task);
  const minutes = Number(task.payload?.timeoutMinutes);
  const timeoutMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : DEFAULT_TCD_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const started = await runCommand('tcd', [
    'start', '-p', 'codex', '--worktree', '-d', repo, '-m', prompt,
  ], {
    cwd: repo,
    timeoutMs: Math.max(1, deadline - Date.now()),
    spawnImpl: deps.spawnImpl,
    signal,
  });
  abortIfNeeded(signal);
  if (started.aborted) throw new AbortTaskError();
  if (started.timedOut) return { ok: false, summary: `tcd 启动超过 ${Math.ceil(timeoutMs / 60000)} 分钟仍未返回` };
  if (started.exitCode !== 0) {
    return {
      ok: false,
      summary: nonEmptySummary(started.stderr, `tcd 启动失败（退出码 ${started.exitCode ?? '未知'}）`),
    };
  }
  const jobId = tcdJobId(started.stdout);
  if (!jobId) return { ok: false, summary: 'tcd 启动失败：未返回任务 ID' };

  while (Date.now() < deadline) {
    const check = await runCommand('tcd', ['check', jobId], {
      cwd: repo,
      timeoutMs: Math.min(DEFAULT_REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
      spawnImpl: deps.spawnImpl,
      signal,
    });
    abortIfNeeded(signal);
    if (check.aborted) throw new AbortTaskError();
    if (check.exitCode !== 0) {
      return {
        ok: false,
        summary: nonEmptySummary(check.stderr, `tcd check 失败（退出码 ${check.exitCode ?? '未知'}）`),
      };
    }
    const checked = tcdCheckResult(check.stdout);
    if (checked.terminal) {
      return {
        ok: checked.ok,
        summary: nonEmptySummary(
          checked.summary,
          checked.ok ? 'tcd 已完成' : 'tcd 任务失败',
        ),
      };
    }
    await waitMs(Math.min(deps.tcdPollMs, Math.max(1, deadline - Date.now())), signal);
  }
  return { ok: false, summary: `tcd 任务超过 ${Math.ceil(timeoutMs / 60000)} 分钟未完成` };
}

async function writeProgress(task, text, config, deps) {
  try {
    await requestJson(config, '/api/stream-events', {
      method: 'POST',
      body: { session: task.session, kind: 'progress', text },
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    deps.logger.log(`[local-listener] 写入 ${task.session} progress 失败：${error.message}`);
  }
}

async function executeClaudeTask(task, config, deps, signal) {
  const repo = taskRepo(task, config);
  const prompt = taskPrompt(task);
  await writeProgress(task, `『本地监听器』开始执行 Claude 任务：${task.title}`, config, deps);
  const result = await runCommand('claude', [
    '-p', prompt, '--output-format', 'text',
    // D23 全自动拍板（2026-07-24）：无人值守编排需要工具权限（写流 curl、读仓库、派 tcd）；护栏=单并发+限时+全程留痕
    '--dangerously-skip-permissions',
  ], {
    cwd: repo,
    timeoutMs: DEFAULT_CLAUDE_TIMEOUT_MS,
    spawnImpl: deps.spawnImpl,
    signal,
  });
  abortIfNeeded(signal);
  const stdoutSummary = truncateCharacters(result.stdout.trim(), 4000);
  const summary = result.timedOut
    ? `claude 执行超过 30 分钟超时${stdoutSummary ? `：${stdoutSummary}` : ''}`
    : (result.exitCode === 0
      ? nonEmptySummary(stdoutSummary, 'claude 已完成，但没有返回输出')
      : nonEmptySummary(
          result.stderr,
          `claude 执行失败（退出码 ${result.exitCode ?? '未知'}）`,
        ));
  const outcome = { ok: !result.timedOut && result.exitCode === 0, summary };
  await writeProgress(
    task,
    `『本地监听器』Claude 任务已结束：${truncateCharacters(summary, 1000)}`,
    config,
    deps,
  );
  return outcome;
}

function projectIdForSession(catalog, session) {
  const directSession = Array.isArray(catalog?.sessions)
    ? catalog.sessions.find((entry) => (
      typeof entry === 'string' ? entry === session : entry?.id === session
    ))
    : null;
  if (directSession && typeof directSession === 'object' && typeof directSession.projectId === 'string') {
    return directSession.projectId;
  }

  const project = Array.isArray(catalog?.projects)
    ? catalog.projects.find((entry) => (
      entry?.primarySession === session
      || (Array.isArray(entry?.sessions) && entry.sessions.some((item) => (
        typeof item === 'string' ? item === session : item?.id === session
      )))
    ))
    : null;
  return typeof project?.id === 'string' && project.id.trim() ? project.id.trim() : null;
}

async function sessionEventRepo(task, config, deps) {
  try {
    const catalog = await requestJson(config, '/api/projects', { fetchImpl: deps.fetchImpl });
    const projectId = projectIdForSession(catalog, task.session);
    if (projectId && Object.hasOwn(config.repoMap, projectId)) return config.repoMap[projectId];
    if (projectId) {
      deps.logger.log(`[local-listener] 会话 ${task.session} 归属项目 ${projectId} 未配置本地仓库，使用工作台仓库目录`);
    } else {
      deps.logger.log(`[local-listener] 会话 ${task.session} 未查到项目归属，使用工作台仓库目录`);
    }
  } catch (error) {
    deps.logger.log(`[local-listener] 查询会话 ${task.session} 项目归属失败，使用工作台仓库目录：${error.message}`);
  }
  return WORKBENCH_REPO_DIR;
}

function sessionEventBrief(task, config) {
  const eventJson = redactSecret(JSON.stringify(task.payload ?? null, null, 2), config.token);
  return [
    '你是本地编排者 Claude，负责处理工作台收到的会话事件。',
    `会话名：${redactSecret(task.session, config.token)}`,
    `事件类型：${redactSecret(task.type, config.token)}`,
    '事件原文 JSON：',
    eventJson,
    '',
    '工作要求：',
    '所有面向用户的回应必须经 POST $WORKBENCH_URL/api/stream-events 写回该会话对话流；header x-workbench-token 取环境变量 WORKBENCH_TOKEN，正文以『Claude：』开头；最终回答 kind=message，过程 kind=progress。',
    '需要重活时可用 tcd 派本地 Codex 处理。',
    '绝不在任何输出中打印口令。',
    '处理完直接结束。',
  ].join('\n');
}

async function executeSessionEvent(task, config, deps, signal) {
  const notificationTask = {
    ...task,
    payload: {
      ...task.payload,
      title: redactSecret(`工作台会话事件：${task.session} / ${task.type}`, config.token),
      message: redactSecret(`会话 ${task.session} 收到事件 ${task.type}`, config.token),
    },
  };
  try {
    const notification = await executeNotifyTask(notificationTask, config, deps, signal);
    if (!notification.ok) {
      deps.logger.log(`[local-listener] 会话事件 macOS 通知失败：${notification.summary}`);
    }
  } catch (error) {
    if (error instanceof AbortTaskError) throw error;
    deps.logger.log(`[local-listener] 会话事件 macOS 通知异常：${error.message}`);
  }

  const repo = await sessionEventRepo(task, config, deps);
  const result = await runCommand('claude', [
    '-p', sessionEventBrief(task, config), '--output-format', 'text',
    '--dangerously-skip-permissions',
  ], {
    cwd: repo,
    env: {
      ...process.env,
      WORKBENCH_URL: config.workbenchUrl,
      WORKBENCH_TOKEN: config.token,
    },
    timeoutMs: deps.claudeTimeoutMs,
    spawnImpl: deps.spawnImpl,
    signal,
  });
  abortIfNeeded(signal);
  if (result.aborted) throw new AbortTaskError();

  const stdoutTail = redactSecret(tailCharacters(result.stdout.trim(), 2000), config.token);
  const stderrTail = redactSecret(tailCharacters(result.stderr.trim(), 2000), config.token);
  const errorText = redactSecret(result.error?.message, config.token);
  if (result.timedOut) {
    return {
      ok: false,
      summary: nonEmptySummary(
        `claude 执行超过 30 分钟超时${stdoutTail ? `：${stdoutTail}` : ''}`,
        'claude 执行超过 30 分钟超时',
      ),
    };
  }
  if (result.error?.code === 'ENOENT' || /\bENOENT\b/.test(errorText)) {
    return { ok: false, summary: 'claude 不存在或无法启动：未找到 claude CLI' };
  }
  if (result.exitCode !== 0) {
    const detail = stderrTail || stdoutTail || errorText;
    return {
      ok: false,
      summary: nonEmptySummary(
        `claude 非零退出（退出码 ${result.exitCode ?? '未知'}）${detail ? `：${detail}` : ''}`,
        `claude 非零退出（退出码 ${result.exitCode ?? '未知'}）`,
      ),
    };
  }
  return {
    ok: true,
    summary: nonEmptySummary(stdoutTail, 'claude 已完成，但没有返回输出'),
  };
}

function appleScriptString(value) {
  return `"${String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')}"`;
}

async function executeNotifyTask(task, config, deps, signal) {
  const message = task.payload?.message || task.payload?.text || task.title;
  const title = task.payload?.title || 'Vibe Workbench';
  const result = await runCommand('osascript', [
    '-e', `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`,
  ], { spawnImpl: deps.spawnImpl, signal });
  abortIfNeeded(signal);
  if (result.aborted) throw new AbortTaskError();
  return result.exitCode === 0
    ? { ok: true, summary: `macOS 通知已发送：${truncateCharacters(message, 3800)}` }
    : { ok: false, summary: nonEmptySummary(result.stderr, `osascript 通知失败（退出码 ${result.exitCode ?? '未知'}）`) };
}

async function executeTask(task, config, deps, signal) {
  switch (task.type) {
    case 'codex-task':
      return executeCodexTask(task, config, deps, signal);
    case 'claude-task':
      return executeClaudeTask(task, config, deps, signal);
    case 'notify':
      return executeNotifyTask(task, config, deps, signal);
    case 'message':
    case 'message-posted':
    case 'feedback':
    case 'feedback-submitted':
    case 'round':
    case 'round-presented':
      return executeSessionEvent(task, config, deps, signal);
    default:
      return { ok: false, summary: `不支持的本地任务类型：${task.type}` };
  }
}

function startRenewal(task, config, deps) {
  let inFlight = Promise.resolve();
  const renew = () => {
    inFlight = inFlight.then(async () => {
      try {
        const renewed = await requestJson(
          config,
          `/api/inbox/tasks/${encodeURIComponent(task.id)}/renew`,
          {
            method: 'POST',
            body: { claimedBy: config.claimedBy },
            fetchImpl: deps.fetchImpl,
          },
        );
        deps.logger.log(`[local-listener] 任务续租成功：${task.id}，到期 ${renewed.task?.leaseExpiresAt || '未知'}`);
      } catch (error) {
        deps.logger.log(`[local-listener] 任务续租失败：${task.id}：${error.message}`);
      }
    });
    return inFlight;
  };
  const timer = setInterval(renew, deps.renewIntervalMs);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}

function defaultLogPath() {
  return path.join(os.homedir(), '.vibeloop-listener', 'listener.log');
}

/** 创建简单追加日志；启动时超过 5 MiB 就保留上一份为 .old。 */
export function createFileLogger(logFile = defaultLogPath()) {
  const directory = path.dirname(logFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    if (fs.statSync(logFile).size > LOG_MAX_BYTES) {
      const oldFile = `${logFile}.old`;
      try { fs.rmSync(oldFile, { force: true }); } catch {}
      fs.renameSync(logFile, oldFile);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return {
    log(message) {
      const line = `${new Date().toISOString()} ${String(message)}\n`;
      fs.appendFileSync(logFile, line, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

/**
 * 创建可测试的监听器。真实入口只负责 loadConfig、日志和信号绑定，业务边界均可注入。
 */
export function createListener(config, {
  fetchImpl = fetch,
  spawnImpl = nodeSpawn,
  logger = console,
  renewIntervalMs = DEFAULT_RENEW_INTERVAL_MS,
  tcdPollMs = DEFAULT_TCD_POLL_MS,
  claudeTimeoutMs = DEFAULT_CLAUDE_TIMEOUT_MS,
} = {}) {
  const deps = { fetchImpl, spawnImpl, logger, renewIntervalMs, tcdPollMs, claudeTimeoutMs };
  let started = false;
  let stopping = false;
  let loopPromise = null;
  let pollInFlight = null;
  let active = null;
  let wakePoll = null;
  let stopPromise = null;

  const pollOnce = () => {
    if (stopping) return Promise.resolve(null);
    if (pollInFlight) return pollInFlight;
    pollInFlight = (async () => {
      let listed;
      try {
        listed = await requestJson(config, '/api/inbox/tasks', {
          query: { executor: config.executor, status: 'pending' },
          fetchImpl,
        });
      } catch (error) {
        logger.log(`[local-listener] 拉取 pending 任务失败：${error.message}`);
        return null;
      }
      const candidate = Array.isArray(listed.tasks) ? listed.tasks[0] : null;
      if (!candidate || stopping) return null;

      let claimed;
      try {
        const response = await requestJson(
          config,
          `/api/inbox/tasks/${encodeURIComponent(candidate.id)}/claim`,
          {
            method: 'POST',
            body: { claimedBy: config.claimedBy },
            fetchImpl,
          },
        );
        claimed = response.task;
        logger.log(`[local-listener] 已领取任务：${claimed.id} type=${claimed.type}`);
      } catch (error) {
        if (error instanceof WorkbenchRequestError && error.status === 409) {
          logger.log(`[local-listener] 任务领取竞争失败：${candidate.id}`);
        } else {
          logger.log(`[local-listener] 领取任务失败：${candidate.id}：${error.message}`);
        }
        return null;
      }

      const controller = new AbortController();
      active = { task: claimed, controller };
      const stopRenewal = startRenewal(claimed, config, deps);
      let outcome;
      try {
        outcome = await executeTask(claimed, config, deps, controller.signal);
      } catch (error) {
        if (error instanceof AbortTaskError || controller.signal.aborted) {
          logger.log(`[local-listener] 任务因下线中止，保留租约等待云端回退：${claimed.id}`);
          outcome = { aborted: true };
        } else {
          logger.log(`[local-listener] 执行任务异常：${claimed.id}：${error.stack || error.message}`);
          outcome = { ok: false, summary: `本地监听器执行异常：${error.message}` };
        }
      } finally {
        await stopRenewal();
      }

      if (outcome?.aborted) {
        active = null;
        return outcome;
      }
      const result = {
        ok: Boolean(outcome?.ok),
        summary: nonEmptySummary(outcome?.summary, '本地监听器未提供执行摘要'),
      };
      try {
        await requestJson(
          config,
          `/api/inbox/tasks/${encodeURIComponent(claimed.id)}/complete`,
          { method: 'POST', body: result, fetchImpl },
        );
        logger.log(`[local-listener] 任务完成回执：${claimed.id} ok=${result.ok}`);
      } catch (error) {
        logger.log(`[local-listener] 写入完成回执失败，任务将靠租约回退：${claimed.id}：${error.message}`);
      } finally {
        active = null;
      }
      return result;
    })();
    pollInFlight.finally(() => { pollInFlight = null; }).catch(() => {});
    return pollInFlight;
  };

  const waitForPoll = () => new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakePoll = null;
      resolve();
    }, config.pollMs);
    // 不能 unref：这是常驻进程在两次轮询之间唯一的活跃句柄，unref 会让 Node 认为无事可做而正常退出（launchd 表现为每 pollMs 重启一次）。stop() 经 wakePoll 清理，不依赖 unref。
    wakePoll = () => {
      clearTimeout(timer);
      wakePoll = null;
      resolve();
    };
  });

  const start = () => {
    if (started) return loopPromise;
    started = true;
    logger.log(`[local-listener] 启动：url=${config.workbenchUrl} executor=${config.executor} claimedBy=${config.claimedBy}`);
    loopPromise = (async () => {
      while (!stopping) {
        try { await pollOnce(); } catch (error) {
          logger.log(`[local-listener] 轮询异常：${error.stack || error.message}`);
        }
        if (!stopping) await waitForPoll();
      }
      logger.log('[local-listener] 监听循环已停止');
    })();
    return loopPromise;
  };

  const stop = ({ shutdownWaitMs = DEFAULT_SHUTDOWN_WAIT_MS } = {}) => {
    if (stopPromise) return stopPromise;
    stopping = true;
    wakePoll?.();
    const currentWork = loopPromise || pollInFlight;
    if (!currentWork) {
      stopPromise = Promise.resolve();
      return stopPromise;
    }
    stopPromise = (async () => {
      let completed = false;
      await Promise.race([
        currentWork.then(() => { completed = true; }),
        waitMs(shutdownWaitMs).then(() => {}),
      ]);
      if (!completed) {
        logger.log(`[local-listener] 当前任务超过 ${shutdownWaitMs}ms 未收尾，发送中止信号并退出`);
        active?.controller.abort();
        await currentWork;
      }
    })();
    return stopPromise;
  };

  return {
    pollOnce,
    start,
    stop,
    requestShutdown: stop,
    get activeTask() { return active?.task || null; },
    get isStopping() { return stopping; },
  };
}

export async function main() {
  const config = loadConfig();
  const logger = createFileLogger();
  const listener = createListener(config, { logger });
  let stopping = false;
  const handleSignal = () => {
    if (stopping) return;
    stopping = true;
    logger.log('[local-listener] 收到 SIGTERM/SIGINT，开始优雅下线');
    listener.stop().then(() => {
      logger.log('[local-listener] 已退出');
    }).catch((error) => {
      logger.log(`[local-listener] 下线异常：${error.stack || error.message}`);
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
  await listener.start();
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    try {
      createFileLogger().log(`[local-listener] 启动失败：${error.stack || error.message}`);
    } catch {}
    process.exitCode = 1;
  });
}
