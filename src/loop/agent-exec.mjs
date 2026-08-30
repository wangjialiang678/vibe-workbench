// agent-exec.mjs — Claude Code / WorkBuddy / Codex 本地订阅统一 driver
// 零依赖，子进程实现可注入，便于离线测试。
import { spawn as nodeSpawn } from 'node:child_process';
import { disk } from '../storage/index.mjs';
import path from 'node:path';
import { cloudAiAuthMode } from '../cloud-ai.mjs';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const AGENTS = new Set(['claude', 'workbuddy', 'codex']);
const WORKBUDDY_APP_BIN = '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';

/**
 * 组装 Claude Code / WorkBuddy 兼容的 CLI 参数。
 * @param {string} prompt
 * @param {string|null|undefined} sessionId
 * @returns {string[]}
 */
export function buildArgv(prompt, sessionId) {
  const argv = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (sessionId) argv.push('--resume', sessionId);
  return argv;
}

/**
 * 从 Claude Code / WorkBuddy 的逐行 stream-json 中提取会话 ID 与回复文本。
 * @param {string} text
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

    if (obj.session_id && !sessionId) sessionId = obj.session_id;

    if (obj.type === 'content_block_delta' && obj.delta?.text) {
      parts.push(obj.delta.text);
    } else if (obj.type === 'message' && obj.role === 'assistant') {
      if (Array.isArray(obj.content)) {
        for (const content of obj.content) {
          if (content.type === 'text' && content.text) parts.push(content.text);
        }
      }
    } else if (obj.type === 'result' && obj.result) {
      parts.push(obj.result);
    }
  }

  return { sessionId, text: parts.join('') };
}

/**
 * 脱敏常见密钥赋值、当前进程环境里的敏感值与 sk-* token。
 * 第二个参数仅供共享执行内核传入本次子进程环境；旧 API 的单参数行为保持兼容。
 * @param {unknown} value
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function redactSecrets(value, env = process.env) {
  let redacted = String(value ?? '');
  const environmentSecrets = Object.entries(env || {})
    .filter(([key, item]) => (
      /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(key)
      && typeof item === 'string'
      && item.length >= 8
    ))
    .map(([, item]) => item)
    .sort((left, right) => right.length - left.length);

  for (const secret of new Set(environmentSecrets)) {
    redacted = redacted.split(secret).join('***');
  }

  return redacted
    .replace(
      /\b((?:[A-Za-z][A-Za-z0-9_]*)?(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi,
      '$1***',
    )
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***');
}

/**
 * 判断绝对/相对文件路径是否可执行。
 * @param {string} candidate
 * @returns {boolean}
 */
function isExecutable(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  try {
    disk.accessSync(candidate, process.platform === 'win32' ? disk.constants.F_OK : disk.constants.X_OK);
    return disk.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function environmentValue(env, key) {
  const direct = env[key];
  if (typeof direct === 'string') return direct;
  const entry = Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return typeof entry?.[1] === 'string' ? entry[1] : '';
}

/**
 * process.env 在 Windows 上按大小写无关方式读取，但展开成普通对象后会丢失该语义。
 * 子进程环境统一用 PATH，避免宿主的 Path 键在展开后不可见。
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} env
 * @returns {Record<string, string|undefined>}
 */
function copyEnvironment(env) {
  const copiedEnv = { ...env };
  const hasPath = Object.keys(copiedEnv).some((key) => key.toLowerCase() === 'path');
  if (!hasPath) return copiedEnv;

  const pathValue = environmentValue(env, 'PATH');
  for (const key of Object.keys(copiedEnv)) {
    if (key.toLowerCase() === 'path') delete copiedEnv[key];
  }
  copiedEnv.PATH = pathValue;
  return copiedEnv;
}

/**
 * 判断命令是否存在于 PATH。Windows 同时检查 PATHEXT。
 * @param {string} command
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env]
 * @param {(candidate: string) => boolean} [isExecutableImpl]
 * @returns {boolean}
 */
function commandAvailableOnPath(command, env = process.env, isExecutableImpl = isExecutable) {
  const pathValue = environmentValue(env, 'PATH');
  if (!pathValue) return false;

  // Windows 也要探测无扩展名候选：npm/跨平台 CLI 常同时落 codebuddy 与 codebuddy.cmd
  const extensions = process.platform === 'win32'
    ? ['', ...String(environmentValue(env, 'PATHEXT') || '.EXE;.CMD;.BAT;.COM').split(';')]
    : [''];

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      if (isExecutableImpl(path.join(directory, `${command}${extension}`))) return true;
    }
  }
  return false;
}

/**
 * 按配置 → PATH → WorkBuddy App 固定路径解析 CodeBuddy CLI。
 * 显式配置视为权威；路径错误会在 spawn 时给出 driver 错误，不静默换程序。
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv|Record<string, string|undefined>,
 *   commandAvailable?: typeof commandAvailableOnPath,
 *   isExecutable?: (candidate: string) => boolean
 * }} [options]
 * @returns {string|null}
 */
export function resolveWorkBuddyBinary({
  env = process.env,
  commandAvailable = commandAvailableOnPath,
  isExecutable: isExecutableImpl = isExecutable,
} = {}) {
  const configured = typeof env.WORKBENCH_WORKBUDDY_BIN === 'string'
    ? env.WORKBENCH_WORKBUDDY_BIN.trim()
    : '';
  if (configured) return configured;
  if (commandAvailable('codebuddy', env, isExecutableImpl)) return 'codebuddy';
  if (isExecutableImpl(WORKBUDDY_APP_BIN)) return WORKBUDDY_APP_BIN;
  return null;
}

function unavailableMessage() {
  return [
    '未找到可用的本地 AI CLI。',
    '请安装并确保 `claude`、`codebuddy` 或 `codex` 在 PATH 中可用，',
    '或设置 WORKBENCH_AGENT=claude|workbuddy|codex；',
    'WorkBuddy 也可设置 WORKBENCH_WORKBUDDY_BIN=/path/to/codebuddy。',
  ].join('');
}

/**
 * 读取显式配置的 agent 名称，并维持各调用方一致的小写归一规则。
 * 未配置时返回空字符串；合法性仍由 resolveAgent 统一校验。
 *
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function configuredAgentName(env = process.env) {
  const configuredAgent = env.WORKBENCH_AGENT;
  return typeof configuredAgent === 'string' ? configuredAgent.trim().toLowerCase() : '';
}

const DRIVER_HELP = {
  claude: {
    name: 'Claude Code',
    action: '请确认 `claude` 命令在 PATH 中可用，配置问题修复后无需重试（会自动处理）。',
  },
  workbuddy: {
    name: 'WorkBuddy',
    action: '请确认 `codebuddy` 命令或 `WORKBENCH_WORKBUDDY_BIN` 配置可用，问题修复后无需重试（会自动处理）。',
  },
  codex: {
    name: 'Codex',
    action: '请确认 `codex` 命令在 PATH 中可用，配置问题修复后无需重试（会自动处理）。',
  },
};

const DEFAULT_DRIVER_HELP = {
  name: 'AI',
  action: '请确认 Claude Code、WorkBuddy 或 Codex CLI 已安装，或正确设置 `WORKBENCH_AGENT`。',
};

/**
 * 返回指定驱动的面向用户排障文案。
 *
 * @param {string|null} agent
 * @returns {{ name: string, action: string }}
 */
export function driverHelp(agent) {
  return Object.hasOwn(DRIVER_HELP, agent) ? DRIVER_HELP[agent] : DEFAULT_DRIVER_HELP;
}

/**
 * 解析本轮 agent 与二进制。显式参数优先于 WORKBENCH_AGENT。
 * 未配置时依次探测 PATH claude、WorkBuddy、PATH codex。
 *
 * 依赖注入参数用于纯函数单测，runAgent 使用默认真实文件系统实现。
 *
 * @param {{
 *   requestedAgent?: string|null,
 *   env?: NodeJS.ProcessEnv|Record<string, string|undefined>,
 *   commandAvailable?: typeof commandAvailableOnPath,
 *   isExecutable?: (candidate: string) => boolean
 * }} [options]
 * @returns {{ agent: 'claude'|'workbuddy'|'codex', binary: string }}
 */
export function resolveAgent({
  requestedAgent,
  env = process.env,
  commandAvailable = commandAvailableOnPath,
  isExecutable: isExecutableImpl = isExecutable,
} = {}) {
  const configuredAgent = requestedAgent ?? env.WORKBENCH_AGENT;
  const normalized = requestedAgent === undefined || requestedAgent === null
    ? configuredAgentName(env)
    : (typeof configuredAgent === 'string' ? configuredAgent.trim().toLowerCase() : '');

  if (normalized) {
    if (!AGENTS.has(normalized)) {
      throw {
        kind: 'driver',
        message: `不支持的 WORKBENCH_AGENT=${normalized}；可选值：claude、workbuddy、codex。`,
      };
    }
    if (normalized === 'workbuddy') {
      const binary = resolveWorkBuddyBinary({
        env,
        commandAvailable,
        isExecutable: isExecutableImpl,
      });
      if (!binary) throw { kind: 'driver', message: unavailableMessage() };
      return { agent: 'workbuddy', binary };
    }
    return { agent: normalized, binary: normalized };
  }

  if (commandAvailable('claude', env, isExecutableImpl)) {
    return { agent: 'claude', binary: 'claude' };
  }

  const workBuddyBinary = resolveWorkBuddyBinary({
    env,
    commandAvailable,
    isExecutable: isExecutableImpl,
  });
  if (workBuddyBinary) return { agent: 'workbuddy', binary: workBuddyBinary };

  if (commandAvailable('codex', env, isExecutableImpl)) {
    return { agent: 'codex', binary: 'codex' };
  }

  throw { kind: 'driver', message: unavailableMessage() };
}

/**
 * 三个适配器共享的 spawn、软超时、脱敏与非零退出处理。
 * fallbackEligible 是 Claude Code API key 托底的内部标记，不对外暴露。
 */
function runAdapterOnce({
  binary,
  label,
  argv,
  parseOutput,
  parseErrorLabel,
  cwd,
  timeoutMs,
  spawnImpl,
  env,
}) {
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
      child = spawnImpl(binary, argv, {
        cwd: cwd || process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rejectOnce({
        kind: 'driver',
        message: redactSecrets(error?.message || String(error), env),
        fallbackEligible: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* 子进程已退出 */ }
      reject({
        kind: 'timeout',
        message: `${label} process timed out after ${timeoutMs}ms`,
        fallbackEligible: true,
      });
    }, timeoutMs);

    child.on('error', (error) => {
      rejectOnce({
        kind: 'driver',
        message: redactSecrets(error?.message || String(error), env),
        fallbackEligible: false,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const safeStderr = redactSecrets(stderr, env).slice(0, 500);
        rejectOnce({
          kind: code == null ? 'unknown' : 'driver',
          message: `${label} exited with code ${code}. stderr: ${safeStderr}`,
          fallbackEligible: code != null,
        });
        return;
      }

      try {
        resolveOnce(parseOutput(stdout, stderr));
      } catch (error) {
        rejectOnce({
          kind: 'unknown',
          message: `${parseErrorLabel} failed: ${error.message}`,
          fallbackEligible: false,
        });
      }
    });
  });
}

function publicError(error, driverSource) {
  const {
    fallbackEligible: _ignored,
    kind = 'unknown',
  } = error || {};
  return {
    kind,
    message: redactSecrets(error?.message || String(error)),
    driverSource,
  };
}

/**
 * 运行 Claude Code CLI。保持原有订阅优先、Anthropic API key 单次托底行为。
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
export async function runClaude({
  prompt,
  sessionId,
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = nodeSpawn,
  auth,
  vaultResolver,
  env = process.env,
}) {
  const argv = buildArgv(prompt, sessionId);
  const inheritedEnv = copyEnvironment(env);
  const apiKey = inheritedEnv.ANTHROPIC_API_KEY;
  const hasApiKey = typeof apiKey === 'string' && apiKey.trim().length > 0;
  const subscriptionEnv = { ...inheritedEnv };
  delete subscriptionEnv.ANTHROPIC_API_KEY;

  // 新契约的两种模式由 workbench-continue 显式传入；未传 auth 保留旧的
  // "订阅优先、API key 单次托底" API，避免直接使用 runClaude 的旧调用方行为变化。
  if (auth === 'subscription') {
    try {
      const result = await runAdapterOnce({ binary: 'claude', label: 'claude', argv, parseOutput: parseStreamJson, parseErrorLabel: 'parseStreamJson', cwd, timeoutMs, spawnImpl, env: subscriptionEnv });
      return { ...result, driverSource: 'subscription' };
    } catch (error) { throw publicError(error, 'subscription'); }
  }
  if (auth === 'apikey') {
    let resolved;
    try { resolved = await vaultResolver?.(); } catch (error) {
      throw { kind: 'auth', message: redactSecrets(error?.message || '无法解析 Anthropic API 凭据', inheritedEnv), driverSource: 'apikey' };
    }
    const key = typeof resolved === 'string' ? resolved.trim() : '';
    if (!key) throw { kind: 'auth', message: 'Anthropic API 凭据缺失或无效', driverSource: 'apikey' };
    try {
      const result = await runAdapterOnce({ binary: 'claude', label: 'claude', argv, parseOutput: parseStreamJson, parseErrorLabel: 'parseStreamJson', cwd, timeoutMs, spawnImpl, env: { ...subscriptionEnv, ANTHROPIC_API_KEY: key } });
      return { ...result, driverSource: 'apikey' };
    } catch (error) { throw publicError(error, 'apikey'); }
  }

  try {
    const result = await runAdapterOnce({
      binary: 'claude',
      label: 'claude',
      argv,
      parseOutput: parseStreamJson,
      parseErrorLabel: 'parseStreamJson',
      cwd,
      timeoutMs,
      spawnImpl,
      env: subscriptionEnv,
    });
    return { ...result, driverSource: 'subscription' };
  } catch (error) {
    if (!error?.fallbackEligible || !hasApiKey) {
      throw publicError(error, 'subscription');
    }

    try {
      const result = await runAdapterOnce({
        binary: 'claude',
        label: 'claude',
        argv,
        parseOutput: parseStreamJson,
        parseErrorLabel: 'parseStreamJson',
        cwd,
        timeoutMs,
        spawnImpl,
        env: { ...inheritedEnv, ANTHROPIC_API_KEY: apiKey },
      });
      return { ...result, driverSource: 'sdk-fallback' };
    } catch (fallbackError) {
      throw publicError(fallbackError, 'sdk-fallback');
    }
  }
}

async function runWorkBuddy({ binary, prompt, sessionId, cwd, timeoutMs, spawnImpl }) {
  const env = { ...process.env };
  try {
    const result = await runAdapterOnce({
      binary,
      label: 'workbuddy',
      argv: buildArgv(prompt, sessionId),
      parseOutput: parseStreamJson,
      parseErrorLabel: 'parseStreamJson',
      cwd,
      timeoutMs,
      spawnImpl,
      env,
    });
    return { ...result, driverSource: 'subscription' };
  } catch (error) {
    throw publicError(error, 'subscription');
  }
}

const ANSI_ESCAPE_RE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const TOKEN_LOG_RE = /^(?:tokens?\s+used|token\s+usage|(?:total|input|output|cached|reasoning)\s+tokens?)\b/i;
const CODEX_METADATA_RE = /^(?:OpenAI Codex\b|-{4,}|(?:workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):)/i;

function normalizedCodexLines(stdout) {
  return String(stdout || '')
    .replace(ANSI_ESCAPE_RE, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n');
}

/** 从 codex exec 普通 stdout 提取最终回答，并从 stdout/stderr 捕获 session id。 */
function parseCodexOutput(stdout, stderr, fallbackSessionId = null) {
  const lines = normalizedCodexLines(stdout);
  // CLI 元数据在 stderr；stdout 只作为旧版本兼容，避免模型正文伪造 session id。
  const metadataLines = [...normalizedCodexLines(stderr), ...lines];
  const sessionLine = metadataLines.find((line) => /^session id:/i.test(line.trim()));
  const trimmedSessionLine = sessionLine?.trim() || '';
  const parsedSessionId = trimmedSessionLine
    ? trimmedSessionLine.slice(trimmedSessionLine.indexOf(':') + 1).trim()
    : '';

  const lastRoleMarker = lines.findLastIndex((line) => /^(?:codex|assistant)\s*$/i.test(line.trim()));
  let candidates = lastRoleMarker >= 0 ? lines.slice(lastRoleMarker + 1) : lines;
  const tokenLogIndex = candidates.findIndex((line) => TOKEN_LOG_RE.test(line.trim()));
  if (tokenLogIndex >= 0) candidates = candidates.slice(0, tokenLogIndex);
  if (lastRoleMarker < 0) {
    candidates = candidates.filter((line) => (
      !CODEX_METADATA_RE.test(line.trim())
      && !/^(?:user|codex|assistant)\s*$/i.test(line.trim())
    ));
  }

  return {
    sessionId: parsedSessionId || fallbackSessionId || null,
    text: candidates.join('\n').trim(),
  };
}

function buildCodexArgv(prompt, sessionId, cwd) {
  const argv = ['exec'];
  if (cwd) argv.push('-C', cwd);
  argv.push('--skip-git-repo-check');
  if (sessionId) argv.push('resume', sessionId, prompt);
  else argv.push(prompt);
  return argv;
}

async function runCodex({ binary, prompt, sessionId, cwd, timeoutMs, spawnImpl }) {
  const env = { ...process.env };
  try {
    const result = await runAdapterOnce({
      binary,
      label: 'codex',
      argv: buildCodexArgv(prompt, sessionId, cwd),
      parseOutput: (stdout, stderr) => parseCodexOutput(stdout, stderr, sessionId),
      parseErrorLabel: 'parseCodexOutput',
      cwd,
      timeoutMs,
      spawnImpl,
      env,
    });
    return { ...result, driverSource: 'subscription' };
  } catch (error) {
    throw publicError(error, 'subscription');
  }
}

/**
 * 统一运行本地 AI CLI。
 *
 * @param {{
 *   agent?: 'claude'|'workbuddy'|'codex',
 *   prompt: string,
 *   sessionId?: string|null,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   spawnImpl?: typeof import('node:child_process').spawn
 * }} options
 * @returns {Promise<{ sessionId: string|null, text: string, driverSource: 'subscription'|'sdk-fallback' }>}
 */
export async function runAgent({
  agent,
  prompt,
  sessionId,
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = nodeSpawn,
  auth,
  vaultResolver,
  env,
}) {
  let selected;
  try {
    selected = resolveAgent({ requestedAgent: agent });
  } catch (error) {
    throw {
      ...publicError(error, 'subscription'),
      ...(AGENTS.has(agent) ? { agent } : {}),
    };
  }

  try {
    if (selected.agent === 'claude') {
      return await runClaude({ prompt, sessionId, cwd, timeoutMs, spawnImpl, auth, vaultResolver, env });
    }
    if (selected.agent === 'workbuddy') {
      return await runWorkBuddy({
        binary: selected.binary,
        prompt,
        sessionId,
        cwd,
        timeoutMs,
        spawnImpl,
      });
    }
    return await runCodex({
      binary: selected.binary,
      prompt,
      sessionId,
      cwd,
      timeoutMs,
      spawnImpl,
    });
  } catch (error) {
    throw { ...error, agent: selected.agent };
  }
}

/**
 * 机 A 的 Claude 续接适配器。只有 Claude 读取 WB_CLOUD_AI_AUTH；Codex/WorkBuddy
 * 保持各自 CLI 登录态，绝不接触 Anthropic key。
 */
export function createWorkbenchContinueDriver({
  agent = 'claude',
  env = process.env,
  vaultResolver,
  spawnImpl = nodeSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    name: 'workbench-continue',
    async process({ prompt, sessionId, cwd }) {
      const auth = agent === 'claude' ? cloudAiAuthMode(env) : undefined;
      return runAgent({ agent, prompt, sessionId, cwd, timeoutMs, spawnImpl, env, auth, vaultResolver });
    },
  };
}
