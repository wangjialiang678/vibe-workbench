import {
  DEFAULT_EXECUTOR_ID,
  executorById,
  registeredProjectForSession,
} from '../projects.mjs';
import { enqueueInboxTask } from '../executor-inbox.mjs';
import { appendStreamEntry } from '../stream.mjs';

export const WEBHOOK_TIMEOUT_MS = 5000;

const AI_IDENTITY = Object.freeze({ id: 'ai', name: 'AI', role: 'ai' });

/** 可选事件投递：任何失败都在此吞掉，调用方只需 fire-and-forget。 */
export async function postWebhookEvent(webhookUrl, payload, {
  fetchImpl = fetch,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
  logger = console,
} = {}) {
  if (!webhookUrl) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error(`HTTP ${response.status}`);
    }
    await response.body?.cancel?.();
  } catch (error) {
    logger.error('[workbench:webhook] 事件投递失败：', error?.message || String(error));
  } finally {
    clearTimeout(timer);
  }
}

export function emitWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  setImmediate(() => { void postWebhookEvent(webhookUrl, payload); });
}

export function inboxTaskTitle(payload) {
  if (payload.event === 'round-presented') {
    return payload.title
      ? `第 ${payload.round} 轮已呈现：${payload.title}`
      : `第 ${payload.round} 轮已呈现`;
  }
  if (payload.event === 'feedback-submitted') return `第 ${payload.round} 轮反馈已提交`;
  if (payload.event === 'message-posted') return '会话新消息';
  return `会话事件：${payload.event || 'unknown'}`;
}

// resident 保持既有 webhook；pull 落本地持久化收件箱。路由异常一律回退云端链路。
export function dispatchExecutorEvent(webhookUrl, payload) {
  let executor;
  try {
    const project = registeredProjectForSession(payload.session);
    executor = executorById(project?.executor || DEFAULT_EXECUTOR_ID);
  } catch (error) {
    console.error('[workbench:dispatch] 执行面解析失败，回退 resident webhook：', error.message);
    emitWebhook(webhookUrl, payload);
    return;
  }

  if (!executor || executor.kind === 'resident') {
    emitWebhook(webhookUrl, payload);
    return;
  }

  try {
    const task = enqueueInboxTask({
      executor: executor.id,
      session: payload.session,
      type: payload.event,
      title: inboxTaskTitle(payload),
      payload,
    });
    appendStreamEntry(payload.session, {
      author: AI_IDENTITY,
      kind: 'progress',
      text: `已入队待本地执行：${task.title}`,
    }, { exactSession: true });
    console.error('[workbench:dispatch] pull 任务已入队：', {
      id: task.id,
      executor: task.executor,
      session: task.session,
      type: task.type,
    });
  } catch (error) {
    console.error('[workbench:dispatch] pull 任务入队失败：', {
      session: payload.session,
      event: payload.event,
      error: error.message,
    });
  }
}
