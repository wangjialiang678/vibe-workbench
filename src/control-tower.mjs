// 控制塔的纯数据处理与页面片段：不持有口令，也不写入任何业务状态。
import { disk } from './storage/index.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  EXECUTORS,
  executorById,
  readProjectRegistry,
  readSessionMetadata,
} from './projects.mjs';
import {
  latestRound,
  listSessions,
  paths,
  readJSON,
  workspaceDir,
} from './workspace.mjs';
import { listInboxTasksReadOnly } from './executor-inbox.mjs';
import { readStreamEntries } from './stream.mjs';

export { controlProjectCardHtml } from './control/view.mjs';

const STATUS_LABELS = Object.freeze({
  pending: '待处理',
  claimed: '已认领',
  awaiting_human: '等你拍板',
  fix_failed: '修复失败',
  merged: '已合入主线',
  done: '已完成',
  failed: '失败',
  rendered: '已呈现',
  responded: '已回应',
  processing: '处理中',
  online: '在线',
  offline: '离线',
  unknown: '未知',
});

const TIME_WINDOWS = Object.freeze({
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
});

function cleanText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || '未知';
}

/**
 * 统一审计事件。无论数据来自 loop、会话流还是收件箱，都必须写齐五要素。
 * 不完整的外部事件不进入控制塔，以免制造“可审计”的错觉。
 */
export function normalizeControlTowerEvent(input, {
  projectId,
  projectName,
  fallbackActor,
  source = 'unknown',
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !validTimestamp(input.at)) return null;
  const actor = input.actor && typeof input.actor === 'object' ? input.actor : fallbackActor;
  const action = input.action;
  const result = input.result;
  const location = input.location && typeof input.location === 'object' ? input.location : {};
  if (!actor || typeof action !== 'object' || typeof result !== 'object') return null;

  const actorName = cleanText(actor.name);
  const actionType = cleanText(action.type);
  const actionLabel = cleanText(action.label);
  const resultStatus = cleanText(result.status);
  const resultSummary = cleanText(result.summary, statusLabel(resultStatus));
  const resolvedProjectId = cleanText(location.projectId, projectId);
  const resolvedProjectName = cleanText(location.projectName, projectName || resolvedProjectId);
  if (!actorName || !actionType || !actionLabel || !resultStatus || !resultSummary || !resolvedProjectId || !resolvedProjectName) {
    return null;
  }

  return {
    id: cleanText(input.id, `${source}:${input.at}:${actionType}:${resolvedProjectId}`),
    at: new Date(input.at).toISOString(),
    actor: {
      id: cleanText(actor.id, actorName),
      name: actorName,
      kind: cleanText(actor.kind, 'unknown'),
    },
    location: {
      projectId: resolvedProjectId,
      projectName: resolvedProjectName,
      ...(cleanText(location.session) ? { session: cleanText(location.session) } : {}),
      ...(cleanText(location.ticketId) ? { ticketId: cleanText(location.ticketId) } : {}),
      ...(cleanText(location.url) ? { url: cleanText(location.url) } : {}),
    },
    action: { type: actionType, label: actionLabel },
    result: {
      status: resultStatus,
      summary: resultSummary,
      ...(cleanText(result.url) ? { url: cleanText(result.url) } : {}),
    },
    source,
    raw: input.raw && typeof input.raw === 'object' ? input.raw : input,
  };
}

function clockTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '刚才';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export function humanTimelineSentence(event) {
  const actor = cleanText(event?.actor?.name, '系统');
  const project = cleanText(event?.location?.projectName, '未标明项目');
  const action = cleanText(event?.action?.label, '完成了一项工作');
  const result = cleanText(event?.result?.summary, statusLabel(event?.result?.status));
  return `${clockTime(event?.at)} ${actor} 在 ${project} ${action}，${result}`;
}

function parsedPage(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isWithinWindow(entry, windowName, now) {
  const milliseconds = TIME_WINDOWS[windowName];
  if (!milliseconds) return true;
  const at = Date.parse(entry.at);
  const end = Date.parse(now);
  return Number.isFinite(at) && Number.isFinite(end) && at >= end - milliseconds && at <= end;
}

export function filterAndPaginateTimeline(entries, {
  project,
  executor,
  type,
  window = '24h',
  page = 1,
  pageSize = 25,
  now = new Date().toISOString(),
} = {}) {
  const normalizedPage = parsedPage(page, 1);
  const normalizedPageSize = Math.min(100, parsedPage(pageSize, 25));
  const withinWindow = (Array.isArray(entries) ? entries : [])
    .filter((entry) => isWithinWindow(entry, window, now));
  const selected = withinWindow
    .filter((entry) => !project || entry.location?.projectId === project)
    .filter((entry) => !executor || entry.actor?.id === executor)
    .filter((entry) => !type || entry.action?.type === type)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.id.localeCompare(left.id));
  const facetEntries = (key, label) => [...new Map(withinWindow.map((entry) => [key(entry), label(entry)])).entries()]
    .filter(([value]) => value)
    .map(([value, itemLabel]) => ({ value, label: itemLabel }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
  const facets = {
    projects: facetEntries((entry) => entry.location?.projectId, (entry) => entry.location?.projectName || entry.location?.projectId),
    executors: facetEntries((entry) => entry.actor?.id, (entry) => entry.actor?.name || entry.actor?.id),
    types: facetEntries((entry) => entry.action?.type, (entry) => entry.action?.label || entry.action?.type),
  };
  const total = selected.length;
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
  const safePage = Math.min(normalizedPage, totalPages);
  return {
    items: selected.slice((safePage - 1) * normalizedPageSize, safePage * normalizedPageSize),
    total,
    page: safePage,
    pageSize: normalizedPageSize,
    totalPages,
    filters: { project: project || null, executor: executor || null, type: type || null, window },
    facets,
  };
}

export const CONTROL_TOWER_CACHE_MS = 20 * 1000;
const LOOP_FETCH_TIMEOUT_MS = 5 * 1000;
const WORKER_HEARTBEAT_STALE_MS = 90 * 1000;

function numberOr(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function controlTokenEnv(project) {
  const configured = project.controlTower?.tokenEnv;
  if (configured) return configured;
  return `VIBELOOP_ADMIN_TOKEN_${project.id.replaceAll('-', '_').toUpperCase()}`;
}

function serviceLabelFromHttp(responseStatus) {
  if ([200, 401, 403].includes(responseStatus)) return '在线';
  return '取不到';
}

function normalizedLoopCounts(body) {
  const tickets = body?.tickets && typeof body.tickets === 'object' ? body.tickets : {};
  const decisions = body?.decisions && typeof body.decisions === 'object' ? body.decisions : {};
  return {
    workItems: {
      open: numberOr(tickets.open, numberOr(tickets.active)),
      byStatus: tickets.byStatus && typeof tickets.byStatus === 'object' ? tickets.byStatus : {},
    },
    decisions: {
      open: numberOr(decisions.open),
      overdue: numberOr(decisions.overdue, numberOr(decisions.slaOverdue)),
    },
  };
}

// 远端即使意外回显请求头，也绝不能把项目管理员口令送进控制塔页面。
function redactRemoteValue(value, secrets, depth = 0) {
  if (depth > 12) return '[已省略]';
  if (typeof value === 'string') {
    return secrets.reduce((text, secret) => (secret ? text.split(secret).join('[已隐藏]') : text), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactRemoteValue(item, secrets, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /(?:token|authorization|password|secret|credential|api[_-]?key)/i.test(key)
      ? '[已隐藏]'
      : redactRemoteValue(item, secrets, depth + 1),
  ]));
}

function remoteEventEntries(project, body) {
  const events = Array.isArray(body?.events)
    ? body.events
    : (Array.isArray(body?.timeline) ? body.timeline : []);
  return events.flatMap((event) => {
    const normalized = normalizeControlTowerEvent(event, {
      projectId: project.id,
      projectName: project.displayName,
      source: 'loop-status',
    });
    return normalized ? [normalized] : [];
  });
}

async function fetchLoopStatus(project, fetchImpl) {
  const config = project.controlTower;
  if (!config?.statusUrl) {
    return {
      loop: { availability: 'unavailable', message: '取不到' },
      service: { label: '取不到' },
      events: [],
      workItems: { open: '取不到', byStatus: {} },
      decisions: { open: 0, overdue: 0 },
      recentActivityAt: null,
    };
  }
  const token = process.env[controlTokenEnv(project)];
  if (!token) {
    return {
      loop: { availability: 'unavailable', message: '取不到' },
      service: { label: '取不到' },
      events: [],
      workItems: { open: '取不到', byStatus: {} },
      decisions: { open: 0, overdue: 0 },
      recentActivityAt: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOP_FETCH_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(config.statusUrl, {
      headers: { 'x-workbench-token': token },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      return {
        loop: { availability: 'unavailable', message: '取不到' },
        service: { label: serviceLabelFromHttp(response.status) },
        events: [],
        workItems: { open: '取不到', byStatus: {} },
        decisions: { open: 0, overdue: 0 },
        recentActivityAt: null,
      };
    }
    const body = redactRemoteValue(await response.json(), [token]);
    const counts = normalizedLoopCounts(body);
    const events = remoteEventEntries(project, body);
    const recentActivityAt = validTimestamp(body?.recentActivityAt)
      ? new Date(body.recentActivityAt).toISOString()
      : lastAt(events);
    return {
      loop: { availability: 'available', status: cleanText(body?.status, '已取到') },
      service: { label: cleanText(body?.service?.label, '在线') },
      events,
      ...counts,
      recentActivityAt,
    };
  } catch {
    return {
      loop: { availability: 'unavailable', message: '取不到' },
      service: { label: '取不到' },
      events: [],
      workItems: { open: '取不到', byStatus: {} },
      decisions: { open: 0, overdue: 0 },
      recentActivityAt: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function sessionsForProject(project) {
  const ids = new Set([project.primarySession, ...(project.aliases || [])].filter(Boolean));
  for (const session of listSessions()) {
    try {
      if (readSessionMetadata(session, { exactSession: true })?.projectId === project.id) ids.add(session);
    } catch { /* 损坏的会话元数据不影响控制塔其余项目 */ }
  }
  return [...ids];
}

function streamAction(entry) {
  const message = cleanText(entry.text, '更新了一条记录');
  if (entry.kind === 'ask') return { type: 'decision.created', label: `发起了需要拍板的决定：${cleanText(entry.ask?.question, message)}` };
  if (entry.kind === 'answer') return { type: 'decision.resolved', label: `给出了决定：${message}` };
  if (entry.kind === 'progress') return { type: 'conversation.progress', label: `更新了进度：${message}` };
  if (entry.kind === 'receipt') return { type: 'conversation.receipt', label: `发出回执：${message}` };
  return { type: 'conversation.message', label: `发来消息：${message}` };
}

function streamResult(entry) {
  if (entry.kind === 'answer') return { status: 'done', summary: '决定已记录' };
  if (entry.kind === 'progress') return { status: 'processing', summary: '进度已记录' };
  return { status: 'done', summary: '已记录' };
}

function localStreamEvents(project, sessions) {
  return sessions.flatMap((session) => {
    let entries;
    try { entries = readStreamEntries(session, { limit: 250, exactSession: true }); }
    catch { return []; }
    return entries.flatMap((entry) => {
      const normalized = normalizeControlTowerEvent({
        id: `stream:${entry.id}`,
        at: entry.at,
        actor: { id: entry.author.id, name: entry.author.name, kind: entry.author.role },
        location: { projectId: project.id, projectName: project.displayName, session },
        action: streamAction(entry),
        result: streamResult(entry),
        raw: entry,
      }, { source: 'session-stream' });
      return normalized ? [normalized] : [];
    });
  });
}

function latestContentDecisionEvents(project, sessions) {
  return sessions.flatMap((session) => {
    const round = latestRound(session, { exactSession: true });
    if (!round) return [];
    const content = readJSON(paths.content(session, round, { exactSession: true }), null);
    if (!Array.isArray(content?.blocks)) return [];
    let at;
    try { at = disk.statSync(paths.content(session, round, { exactSession: true })).mtime.toISOString(); }
    catch { return []; }
    return content.blocks.flatMap((block) => {
      if (!block?.needsDecision) return [];
      const normalized = normalizeControlTowerEvent({
        id: `decision:${session}:${round}:${block.id}`,
        at,
        actor: { id: 'workbench', name: '工作台', kind: 'system' },
        location: { projectId: project.id, projectName: project.displayName, session },
        action: {
          type: 'decision.created',
          label: `创建了需要拍板的决定：${cleanText(block.title, block.id)}`,
        },
        result: { status: 'awaiting_human', summary: '等你拍板' },
        raw: { session, round, block },
      }, { source: 'decision-card' });
      return normalized ? [normalized] : [];
    });
  });
}

function taskAction(task) {
  if (task.status === 'claimed') return { type: 'inbox.claimed', label: `已认领任务：${task.title}` };
  if (task.status === 'done') return { type: 'inbox.completed', label: `完成了任务：${task.title}` };
  if (task.status === 'failed') return { type: 'inbox.failed', label: `任务处理失败：${task.title}` };
  return { type: 'inbox.queued', label: `收到待处理任务：${task.title}` };
}

function taskTimestamp(task) {
  return task.completedAt || task.claimedAt || task.createdAt;
}

function inboxEvents(project, sessions, tasks) {
  const owned = new Set(sessions);
  return tasks.filter((task) => owned.has(task.session)).flatMap((task) => {
    const executor = executorById(task.executor);
    const normalized = normalizeControlTowerEvent({
      id: `inbox:${task.id}`,
      at: taskTimestamp(task),
      actor: {
        id: cleanText(task.claimedBy, task.executor),
        name: cleanText(task.claimedBy, executor?.displayName || task.executor),
        kind: 'worker',
      },
      location: { projectId: project.id, projectName: project.displayName, session: task.session },
      action: taskAction(task),
      result: {
        status: task.status,
        summary: cleanText(task.result?.summary, statusLabel(task.status)),
      },
      raw: task,
    }, { source: 'executor-inbox' });
    return normalized ? [normalized] : [];
  });
}

function readAllInboxTasks() {
  return EXECUTORS.flatMap((executor) => {
    try { return listInboxTasksReadOnly({ executor: executor.id }); }
    catch { return []; }
  });
}

function lastAt(events) {
  return events.map((event) => event.at).filter(validTimestamp)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function humanRelativeTime(value, now) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '暂无记录';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function collectSystemdServices(registry) {
  const configured = registry.projects.flatMap((project) => project.controlTower?.serviceUnits || []);
  const loopUnits = registry.projects
    .filter((project) => (project.controlTower?.level ?? 0) > 0)
    .map((project) => `vibeloop-${project.id}.service`);
  const units = [...new Set([
    'workbench.service', 'resident-worker.service', 'notify-relay.service', ...loopUnits, ...configured,
  ])];
  return units.map((unit) => {
    try {
      const output = execFileSync('systemctl', [
        'show', unit, '--no-page', '--property=ActiveState,SubState,ActiveEnterTimestamp',
      ], { encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1024, windowsHide: true });
      const values = Object.fromEntries(output.trim().split('\n').flatMap((line) => {
        const index = line.indexOf('=');
        return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
      }));
      const state = values.ActiveState === 'active' ? '在线'
        : values.ActiveState === 'failed' ? '异常'
          : values.ActiveState === 'inactive' ? '已停止' : '未知';
      return {
        unit, availability: 'available', state,
        lastStartedAt: cleanText(values.ActiveEnterTimestamp, '未知'),
      };
    } catch {
      return { unit, availability: 'unknown', state: '未知', lastStartedAt: '未知' };
    }
  });
}

function collectDiskHealth() {
  try {
    const stat = disk.statfsSync(workspaceDir());
    const total = Number(stat.blocks) * Number(stat.bsize);
    const available = Number(stat.bavail) * Number(stat.bsize);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(available)) throw new Error('invalid statfs');
    return {
      availability: 'available', totalBytes: total, availableBytes: available,
      usedPercent: Math.max(0, Math.min(100, Math.round((1 - (available / total)) * 100))),
    };
  } catch {
    return { availability: 'unknown', usedPercent: null };
  }
}

function collectLogHealth() {
  const root = process.env.CONTROL_TOWER_LOG_DIR;
  if (!root || !path.isAbsolute(root)) return { availability: 'unknown', usedBytes: null };
  let files = 0;
  let usedBytes = 0;
  const visit = (target) => {
    if (files > 10_000) throw new Error('too many log files');
    const stat = disk.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) { files += 1; usedBytes += stat.size; return; }
    if (!stat.isDirectory()) return;
    for (const entry of disk.readdirSync(target, { withFileTypes: true })) visit(path.join(target, entry.name));
  };
  try {
    visit(root);
    return { availability: 'available', usedBytes, files };
  } catch {
    return { availability: 'unknown', usedBytes: null };
  }
}

function collectWatchdog() {
  const target = process.env.CONTROL_TOWER_WATCHDOG_FILE;
  if (!target) return { availability: 'unknown', result: '未知', at: null };
  try {
    if (disk.statSync(target).size > 64 * 1024) throw new Error('too large');
    const value = JSON.parse(disk.readFileSync(target, 'utf8'));
    return {
      availability: 'available',
      result: value?.ok === true ? '正常' : cleanText(value?.result, '异常'),
      at: validTimestamp(value?.at) ? new Date(value.at).toISOString() : null,
    };
  } catch {
    return { availability: 'unknown', result: '未知', at: null };
  }
}

function latestObservedTask(tasks, executor) {
  return tasks.filter((task) => task.executor === executor && (task.claimedAt || task.completedAt))
    .sort((left, right) => Date.parse(taskTimestamp(right)) - Date.parse(taskTimestamp(left)))[0] || null;
}

function latestCompletedTask(tasks, executor) {
  return tasks.filter((task) => task.executor === executor && task.completedAt)
    .sort((left, right) => Date.parse(task.completedAt) - Date.parse(right.completedAt))[0] || null;
}

function collectExecutionHealth(tasks, runtimeState, now) {
  if (runtimeState?.cloudAiExplicitlyDisabled) {
    return {
      cloudWorker: { state: '未启用', at: null, label: null },
      localListener: { state: '未启用', at: null },
      githubActions: { state: '未启用', at: null },
    };
  }
  const heartbeatAt = runtimeState?.workerHeartbeat?.at;
  const heartbeatMs = Date.parse(heartbeatAt);
  const workerOnline = Number.isFinite(heartbeatMs) && now - heartbeatMs < WORKER_HEARTBEAT_STALE_MS;
  const localTask = latestObservedTask(tasks, 'local-mac');
  const actionsTask = latestCompletedTask(tasks, 'github-actions');
  return {
    cloudWorker: {
      state: workerOnline ? '在线' : (heartbeatAt ? '离线' : '未知'),
      at: validTimestamp(heartbeatAt) ? heartbeatAt : null,
      label: runtimeState?.workerHeartbeat?.label || null,
    },
    localListener: {
      state: localTask ? '有拉取记录' : '未知',
      at: localTask ? taskTimestamp(localTask) : null,
    },
    githubActions: {
      state: actionsTask?.result?.ciStatus || (actionsTask ? statusLabel(actionsTask.status) : '未知'),
      at: actionsTask ? taskTimestamp(actionsTask) : null,
    },
  };
}

function collectSystemHealth(registry, tasks, runtimeState, now) {
  return {
    services: collectSystemdServices(registry),
    execution: collectExecutionHealth(tasks, runtimeState, now),
    disk: collectDiskHealth(),
    logs: collectLogHealth(),
    watchdog: collectWatchdog(),
  };
}

/**
 * 控制塔聚合器：缓存“原始只读快照”，筛选和分页始终在快照副本上计算。
 * 环境变量只在此服务端函数读取，返回值从不包含其名称或值。
 */
export function createControlTowerService({
  runtimeState = {},
  fetchImpl = globalThis.fetch,
  cacheMs = CONTROL_TOWER_CACHE_MS,
} = {}) {
  let cached = null;

  async function buildSnapshot() {
    const now = Date.now();
    const registry = readProjectRegistry();
    const tasks = readAllInboxTasks();
    const remote = await Promise.all(registry.projects.map(async (project) => {
      if (project.controlTower?.level === 0 || !project.controlTower) {
        return {
          id: project.id,
          level: project.controlTower?.level ?? 0,
          loop: { availability: 'not-applicable' },
          service: { label: '未接入 loop' },
          workItems: null,
          decisions: { open: 0, overdue: 0 },
          events: [],
        };
      }
      const status = await fetchLoopStatus(project, fetchImpl);
      return { id: project.id, level: project.controlTower.level, ...status };
    }));
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const events = [];
    const overview = registry.projects.map((project) => {
      const details = remoteById.get(project.id);
      const sessions = sessionsForProject(project);
      const projectEvents = [
        ...(details.events || []),
        ...localStreamEvents(project, sessions),
        ...latestContentDecisionEvents(project, sessions),
        ...inboxEvents(project, sessions, tasks),
      ];
      events.push(...projectEvents);
      const recentActivityAt = details.recentActivityAt || lastAt(projectEvents);
      const attentionCount = numberOr(details.decisions?.open) + numberOr(details.decisions?.overdue);
      const links = {
        ...(project.controlTower?.links || {}),
        ...(!project.controlTower?.links?.session && project.primarySession
          ? { session: `/render/?session=${encodeURIComponent(project.primarySession)}` }
          : {}),
      };
      return {
        id: project.id,
        displayName: project.displayName,
        level: details.level,
        loop: details.loop,
        service: details.service,
        executor: {
          id: project.executor,
          label: `${executorById(project.executor)?.displayName || project.executor}（干活的机器）`,
        },
        attentionCount,
        ...(details.level === 0 ? {} : { workItems: details.workItems }),
        recentActivityAt,
        recentActivity: humanRelativeTime(recentActivityAt, now),
        links,
      };
    });
    return {
      generatedAt: new Date(now).toISOString(),
      overview,
      events,
      health: collectSystemHealth(registry, tasks, runtimeState, now),
    };
  }

  return {
    async snapshot(filters = {}) {
      const now = Date.now();
      const hit = cached && (now - cached.at) < cacheMs;
      if (!hit) cached = { at: now, data: await buildSnapshot() };
      const timeline = filterAndPaginateTimeline(cached.data.events, { ...filters, now: new Date(now).toISOString() });
      return {
        ok: true,
        generatedAt: cached.data.generatedAt,
        cache: { hit: Boolean(hit), maxAgeMs: cacheMs },
        overview: cached.data.overview,
        timeline,
        health: cached.data.health,
      };
    },
  };
}
