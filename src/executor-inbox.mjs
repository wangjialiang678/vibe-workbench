// 执行面收件箱：单机本地文件队列。外部 worker 只能经 HTTP API 使用，不能直读本目录。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

import { EXECUTORS, executorById } from './projects.mjs';
import { isValidSessionName, workspaceDir } from './workspace.mjs';

export const INBOX_PAYLOAD_LIMIT = 64 * 1024;
export const DEFAULT_CLAIM_TIMEOUT_MS = 30 * 60 * 1000;
export const INBOX_STATUSES = new Set(['pending', 'claimed', 'done', 'failed']);

const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_FILE_RE = /^([0-9a-f-]{36})\.claim-(\d+)-([0-9a-f]+)\.json$/i;

function inboxError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalid(message) {
  return inboxError('INVALID_INBOX_TASK', message);
}

function cleanRequiredString(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalid(`${name} 必须是非空字符串`);
  }
  const clean = value.trim();
  if (Array.from(clean).length > maxLength) {
    throw invalid(`${name} 不能超过 ${maxLength} 个字符`);
  }
  return clean;
}

function cleanTaskId(id) {
  if (typeof id !== 'string' || !TASK_ID_RE.test(id)) {
    throw invalid('task id 无效');
  }
  return id.toLowerCase();
}

function cleanClaimTimeout(value) {
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_CLAIM_TIMEOUT_MS;
}

function dateFor(value) {
  const candidate = typeof value === 'function' ? value() : value;
  const date = candidate == null
    ? new Date()
    : (candidate instanceof Date ? new Date(candidate.getTime()) : new Date(candidate));
  if (!Number.isFinite(date.getTime())) throw invalid('now 必须是有效时间');
  return date;
}

function payloadBytes(payload) {
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw invalid('payload 必须可序列化为 JSON');
  }
  if (serialized === undefined) throw invalid('payload 必须显式提供 JSON 值');
  return Buffer.byteLength(serialized, 'utf8');
}

export function inboxRoot() {
  return path.join(workspaceDir(), 'inbox');
}

function executorDirectory(executor) {
  if (!executorById(executor)) throw invalid('executor 未注册');
  return path.join(inboxRoot(), executor);
}

function canonicalTaskPath(executor, id) {
  return path.join(executorDirectory(executor), `${cleanTaskId(id)}.json`);
}

function claimTaskPath(executor, id, nowMs) {
  const token = randomBytes(8).toString('hex');
  return path.join(executorDirectory(executor), `${cleanTaskId(id)}.claim-${nowMs}-${token}.json`);
}

function recoveryTaskPath(executor, id, nowMs) {
  const token = randomBytes(8).toString('hex');
  return path.join(executorDirectory(executor), `.${cleanTaskId(id)}.recover-${nowMs}-${token}.json`);
}

function atomicWriteJson(target, value) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

function parseStoredTask(target, expected = {}) {
  let task;
  try {
    task = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw inboxError('INBOX_CORRUPT', `任务文件损坏：${error.message}`);
  }
  if (!task || typeof task !== 'object' || Array.isArray(task)
    || !TASK_ID_RE.test(task.id || '')
    || !executorById(task.executor)
    || !isValidSessionName(task.session)
    || typeof task.type !== 'string' || !task.type
    || typeof task.title !== 'string' || !task.title
    || !INBOX_STATUSES.has(task.status)
    || !Array.isArray(task.history)
    || (expected.id && task.id.toLowerCase() !== expected.id)
    || (expected.executor && task.executor !== expected.executor)) {
    throw inboxError('INBOX_CORRUPT', '任务文件结构损坏');
  }
  return task;
}

function canonicalLocations(id) {
  const cleanId = cleanTaskId(id);
  return EXECUTORS.flatMap(({ id: executor }) => {
    const target = canonicalTaskPath(executor, cleanId);
    try {
      return fs.statSync(target).isFile() ? [{ executor, target }] : [];
    } catch {
      return [];
    }
  });
}

function activeClaimArtifacts(id) {
  const cleanId = cleanTaskId(id);
  return EXECUTORS.flatMap(({ id: executor }) => {
    const directory = executorDirectory(executor);
    let names;
    try {
      names = fs.readdirSync(directory);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.startsWith(`${cleanId}.claim-`) && CLAIM_FILE_RE.test(name))
      .map((name) => path.join(directory, name));
  });
}

function acquireTaskFile(id, nowMs) {
  const cleanId = cleanTaskId(id);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const locations = canonicalLocations(cleanId);
    if (locations.length > 1) throw inboxError('INBOX_CORRUPT', `任务 ${cleanId} 在多个执行面重复`);
    if (locations.length === 0) {
      if (activeClaimArtifacts(cleanId).length) {
        throw inboxError('INBOX_CONFLICT', `任务 ${cleanId} 正在被其他请求处理`);
      }
      throw inboxError('INBOX_NOT_FOUND', `任务 ${cleanId} 不存在`);
    }

    const [{ executor, target }] = locations;
    const claimedPath = claimTaskPath(executor, cleanId, nowMs);
    try {
      // 核心竞态纪律：先用 rename 赢得任务文件，再读取/解析内容。
      fs.renameSync(target, claimedPath);
      return { id: cleanId, executor, target, claimedPath };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (activeClaimArtifacts(cleanId).length) {
        throw inboxError('INBOX_CONFLICT', `任务 ${cleanId} 正在被其他请求处理`);
      }
    }
  }
  throw inboxError('INBOX_CONFLICT', `任务 ${cleanId} 正在被其他请求处理`);
}

function restoreClaimedFile(lock) {
  try {
    if (fs.existsSync(lock.claimedPath) && !fs.existsSync(lock.target)) {
      fs.renameSync(lock.claimedPath, lock.target);
    }
  } catch {}
}

function withLockedTask(id, nowMs, mutate) {
  const lock = acquireTaskFile(id, nowMs);
  let task;
  try {
    task = parseStoredTask(lock.claimedPath, { id: lock.id, executor: lock.executor });
    const outcome = mutate(task);
    if (outcome.task !== task) atomicWriteJson(lock.claimedPath, outcome.task);
    fs.renameSync(lock.claimedPath, lock.target);
    return outcome;
  } catch (error) {
    restoreClaimedFile(lock);
    throw error;
  }
}

function taskIds(executor) {
  const directory = executorDirectory(executor);
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json') && TASK_ID_RE.test(name.slice(0, -5)))
    .map((name) => name.slice(0, -5).toLowerCase());
}

function resetClaimedTask(task, at) {
  return {
    ...task,
    status: 'pending',
    claimedAt: null,
    claimedBy: null,
    leaseExpiresAt: null,
    history: [
      ...task.history,
      {
        event: 'claim-expired',
        at,
        claimedAt: task.claimedAt ?? null,
        claimedBy: task.claimedBy ?? null,
      },
    ],
  };
}

function recoverExpiredClaimArtifacts(nowDate, claimTimeoutMs) {
  const nowMs = nowDate.getTime();
  const at = nowDate.toISOString();
  let recovered = 0;
  for (const { id: executor } of EXECUTORS) {
    const directory = executorDirectory(executor);
    let names;
    try {
      names = fs.readdirSync(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      const match = name.match(CLAIM_FILE_RE);
      if (!match) continue;
      const [, rawId, startedAt] = match;
      if (nowMs - Number(startedAt) < claimTimeoutMs) continue;
      const id = cleanTaskId(rawId);
      const claimedPath = path.join(directory, name);
      const recoveryPath = recoveryTaskPath(executor, id, nowMs);
      try {
        fs.renameSync(claimedPath, recoveryPath);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      try {
        const task = parseStoredTask(recoveryPath, { id, executor });
        const leaseExpiry = Date.parse(task.leaseExpiresAt)
          || (Date.parse(task.claimedAt) + claimTimeoutMs);
        const shouldReset = task.status === 'pending'
          || (task.status === 'claimed'
            && (!Number.isFinite(leaseExpiry) || leaseExpiry <= nowMs));
        const recoveredTask = shouldReset ? resetClaimedTask(task, at) : task;
        if (recoveredTask !== task) atomicWriteJson(recoveryPath, recoveredTask);
        const target = canonicalTaskPath(executor, id);
        if (fs.existsSync(target)) {
          throw inboxError('INBOX_CORRUPT', `恢复任务 ${id} 时发现重复 canonical 文件`);
        }
        fs.renameSync(recoveryPath, target);
        if (shouldReset) recovered += 1;
      } catch (error) {
        try {
          if (fs.existsSync(recoveryPath) && !fs.existsSync(claimedPath)) {
            fs.renameSync(recoveryPath, claimedPath);
          }
        } catch {}
        throw error;
      }
    }
  }
  return recovered;
}

export function enqueueInboxTask(input, { now } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('任务请求体必须是对象');
  }
  const executor = cleanRequiredString(input.executor, 'executor', 80);
  if (!executorById(executor)) throw invalid('executor 未注册');
  if (!isValidSessionName(input.session)) throw invalid('session 参数无效');
  const type = cleanRequiredString(input.type, 'type', 100);
  const title = cleanRequiredString(input.title, 'title', 300);
  if (!Object.hasOwn(input, 'payload')) throw invalid('payload 必须显式提供');
  if (payloadBytes(input.payload) > INBOX_PAYLOAD_LIMIT) {
    throw inboxError('INBOX_PAYLOAD_TOO_LARGE', 'payload 不能超过 64 KiB');
  }

  const createdAt = dateFor(now).toISOString();
  const task = {
    id: randomUUID(),
    executor,
    session: input.session,
    type,
    title,
    payload: input.payload,
    status: 'pending',
    createdAt,
    claimedAt: null,
    claimedBy: null,
    leaseExpiresAt: null,
    completedAt: null,
    result: null,
    history: [],
  };
  atomicWriteJson(canonicalTaskPath(executor, task.id), task);
  return task;
}

export function resetExpiredInboxClaims({
  now,
  claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS,
} = {}) {
  const current = dateFor(now);
  const timeout = cleanClaimTimeout(claimTimeoutMs);
  let reset = recoverExpiredClaimArtifacts(current, timeout);
  for (const { id: executor } of EXECUTORS) {
    for (const id of taskIds(executor)) {
      try {
        const outcome = withLockedTask(id, current.getTime(), (task) => {
          if (task.status !== 'claimed') return { task, reset: false };
          const expiry = Date.parse(task.leaseExpiresAt)
            || (Date.parse(task.claimedAt) + timeout);
          if (!Number.isFinite(expiry) || expiry > current.getTime()) {
            return { task, reset: false };
          }
          return { task: resetClaimedTask(task, current.toISOString()), reset: true };
        });
        if (outcome.reset) reset += 1;
      } catch (error) {
        if (!['INBOX_CONFLICT', 'INBOX_NOT_FOUND'].includes(error?.code)) throw error;
      }
    }
  }
  return reset;
}

export function listInboxTasks({
  executor,
  status,
  now,
  claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS,
} = {}) {
  if (!executorById(executor)) throw invalid('executor 未注册');
  if (status != null && !INBOX_STATUSES.has(status)) throw invalid('status 参数无效');
  resetExpiredInboxClaims({ now, claimTimeoutMs });
  return taskIds(executor)
    .map((id) => parseStoredTask(canonicalTaskPath(executor, id), { id, executor }))
    .filter((task) => status == null || task.status === status)
    .sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    ));
}

export function claimInboxTask(id, claimedBy, {
  now,
  claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS,
} = {}) {
  const worker = cleanRequiredString(claimedBy, 'claimedBy', 200);
  const current = dateFor(now);
  const timeout = cleanClaimTimeout(claimTimeoutMs);
  resetExpiredInboxClaims({ now: current, claimTimeoutMs: timeout });
  return withLockedTask(id, current.getTime(), (task) => {
    if (task.status !== 'pending') {
      throw inboxError('INBOX_CONFLICT', `任务当前状态为 ${task.status}，不能领取`);
    }
    const claimedAt = current.toISOString();
    return {
      task: {
        ...task,
        status: 'claimed',
        claimedAt,
        claimedBy: worker,
        leaseExpiresAt: new Date(current.getTime() + timeout).toISOString(),
      },
    };
  }).task;
}

export function renewInboxTask(id, claimedBy, {
  now,
  claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS,
} = {}) {
  const worker = cleanRequiredString(claimedBy, 'claimedBy', 200);
  const current = dateFor(now);
  const timeout = cleanClaimTimeout(claimTimeoutMs);
  resetExpiredInboxClaims({ now: current, claimTimeoutMs: timeout });
  return withLockedTask(id, current.getTime(), (task) => {
    if (task.status !== 'claimed' || task.claimedBy !== worker) {
      throw inboxError('INBOX_CONFLICT', '任务租约不存在或 claimedBy 不匹配');
    }
    return {
      task: {
        ...task,
        leaseExpiresAt: new Date(current.getTime() + timeout).toISOString(),
      },
    };
  }).task;
}

export function completeInboxTask(id, result, {
  now,
  claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS,
} = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || typeof result.ok !== 'boolean') {
    throw invalid('ok 必须是布尔值');
  }
  const summary = cleanRequiredString(result.summary, 'summary', 4000);
  const current = dateFor(now);
  const timeout = cleanClaimTimeout(claimTimeoutMs);
  resetExpiredInboxClaims({ now: current, claimTimeoutMs: timeout });
  return withLockedTask(id, current.getTime(), (task) => {
    if (task.status === 'done' || task.status === 'failed') {
      return { task, idempotent: true };
    }
    if (task.status !== 'claimed') {
      throw inboxError('INBOX_CONFLICT', `任务当前状态为 ${task.status}，不能完成`);
    }
    return {
      task: {
        ...task,
        status: result.ok ? 'done' : 'failed',
        leaseExpiresAt: null,
        completedAt: current.toISOString(),
        result: { ok: result.ok, summary },
      },
      idempotent: false,
    };
  });
}
