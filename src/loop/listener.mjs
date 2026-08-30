// listener.mjs — 异步唤醒回路（DESIGN §6.3 + §7 + §13 P0-2）
import {
  paths,
  readJSON, writeJSON, writeText,
  exists, claimFeedbackRound, releaseExpiredFeedbackClaim,
  readStatus, writeStatus,
  listSessions, listRounds,
} from '../workspace.mjs';
import { getSession, getSessionId, setSessionId, getCwd } from './session-store.mjs';
import { configuredAgentName, driverHelp, resolveAgent, runAgent, createWorkbenchContinueDriver } from './agent-exec.mjs';
import { cloudAiEnabled } from '../cloud-ai.mjs';
import { presentRound } from '../core/present.mjs';

export { configuredAgentName } from './agent-exec.mjs';

const SDK_FALLBACK_NOTICE = '（本次由 SDK 托底执行，走 API 计费）';

// ────────────────────────────────────────────────────────────────────────────
// 内部工具

/**
 * 拼装要发给 AI driver 的 prompt：content + feedback。
 */
function buildPrompt(session, round) {
  const feedback = readJSON(paths.feedback(session, round), null);
  const content = readJSON(paths.content(session, round), null);

  const parts = [];
  if (content) {
    parts.push(`[Round ${round} content]\n${JSON.stringify(content, null, 2)}`);
  }
  if (feedback) {
    parts.push(`[User feedback]\n${JSON.stringify(feedback, null, 2)}`);
  }
  return parts.join('\n\n');
}

// ────────────────────────────────────────────────────────────────────────────
// 核心：处理单轮

/**
 * 处理一轮反馈。
 * - ack 已存在 → 幂等跳过，return { status: 'skipped' }
 * - 否则：写 ack → 调 driver → 写 response/error
 * driver 抛错 → 写 error.json，不再抛出，return { status: 'error' }
 *
 * @param {string} session
 * @param {number} round
 * @param {{ driver?: Function }} opts
 * @returns {Promise<{ status: 'skipped'|'responded'|'error', driverSource?: 'subscription'|'sdk-fallback' }>}
 */
export async function processRound(session, round, { driver, memory = null, workerId } = {}) {
  const claim = claimFeedbackRound(session, round, { workerId });
  if (!claim) return { status: 'skipped' };
  const claimedAt = claim.claimedAt;

  // 更新状态 → claimed
  writeStatus(session, { state: 'claimed', claimedAt, round, driverSource: null });

  // 组装 prompt
  const prompt = buildPrompt(session, round);
  const feedback = claim.feedback || readJSON(paths.feedback(session, round), null);

  // 取 session 元数据。注入 driver 时维持原契约，直接传历史续接 ID。
  const sessionData = getSession(session);
  const cwd = getCwd(session) || undefined;

  try {
    let activeAgent = null;
    let activeDriver = driver;
    let agentSessionId = sessionData?.claudeSessionId || null;

    if (!activeDriver) {
      activeAgent = resolveAgent().agent;
      agentSessionId = getSessionId(session, activeAgent);
      activeDriver = createWorkbenchContinueDriver({ agent: activeAgent });
    }
    const driverArgs = { session, round, feedback, memory, prompt, sessionId: agentSessionId, cwd };
    const result = typeof activeDriver === 'function'
      ? await activeDriver(driverArgs)
      : await activeDriver.process(driverArgs);
    // 测试/自定义 driver 未声明来源时，按产品路径命名视为 subscription。
    const driverSource = ['sdk-fallback', 'apikey'].includes(result.driverSource)
      ? result.driverSource
      : 'subscription';

    // 写 response.md
    const responseText = driverSource === 'sdk-fallback'
      ? `${SDK_FALLBACK_NOTICE}\n\n${result.text || ''}`
      : (result.text || '');
    writeText(paths.response(session, round), responseText);

    // 下一轮只能由 AI 侧的 shared core 用例创建，driver 不直接写 content.json。
    if (result.content && typeof result.content === 'object') {
      presentRound(session, { ...result.content, round: undefined }, { exactSession: true });
    }

    // 更新 session（续接 id）
    if (result.sessionId) {
      setSessionId(session, result.sessionId, activeAgent);
    }

    // 更新状态 → responded
    writeStatus(session, { state: 'responded', driverSource });

    return { status: 'responded', driverSource };
  } catch (err) {
    // err 是 { kind, message } 或普通 Error
    const kind = err.kind || 'unknown';
    const message = err.message || String(err);
    const driverSource = ['sdk-fallback', 'apikey'].includes(err.driverSource)
      ? err.driverSource
      : 'subscription';

    // 按 DESIGN §13 P1：按 kind 写 userMessage/suggestedAction
    const configuredAgent = configuredAgentName();
    const activeAgent = err.agent || configuredAgent || null;
    const { userMessage, suggestedAction } = kindToUserFacing(kind, activeAgent);

    writeJSON(paths.error(session, round), {
      kind,
      message,
      userMessage,
      suggestedAction,
      driverSource,
      at: new Date().toISOString(),
    });

    writeStatus(session, { state: 'error', driverSource });

    // 不再抛出（单轮异常不拖垮进程）
    return { status: 'error', driverSource };
  }
}

function kindToUserFacing(kind, agent = null) {
  switch (kind) {
    case 'driver': {
      const help = driverHelp(agent);
      return {
        userMessage: `${help.name} 驱动程序未找到或启动失败，请检查本地 CLI 是否正确安装。`,
        suggestedAction: help.action,
      };
    }
    case 'timeout':
      return {
        userMessage: 'AI 处理超时，请稍后重试。',
        suggestedAction: '点击「重试」重新处理本轮。',
      };
    case 'api':
      return {
        userMessage: 'AI API 返回错误，请稍后重试。',
        suggestedAction: '点击「重试」重新处理本轮。',
      };
    default:
      return {
        userMessage: '发生未知错误，请稍后重试。',
        suggestedAction: '点击「重试」重新处理本轮。',
      };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 对账

/**
 * 扫描所有 session 的所有轮，补处理"有 feedback 且无 ack 且无 response"的轮。
 * 崩溃重启后调用可自动补上遗漏的轮。
 *
 * @param {{ driver?: Function }} opts
 * @returns {Promise<Array<{ session: string, round: number, status: string }>>}
 */
export async function reconcile({ driver, memory, workerId } = {}) {
  const processed = [];
  const sessions = listSessions();

  for (const session of sessions) {
    const rounds = listRounds(session);
    for (const round of rounds) {
      releaseExpiredFeedbackClaim(session, round);
      const hasFeedback = exists(paths.feedback(session, round));
      const hasAck = exists(paths.ack(session, round));
      const hasResponse = exists(paths.response(session, round));

      if (hasFeedback && !hasAck && !hasResponse) {
        const result = await processRound(session, round, { driver, memory, workerId });
        processed.push({ session, round, status: result.status });
      }
    }
  }

  return processed;
}

// ────────────────────────────────────────────────────────────────────────────
// 监管终态

/**
 * 将 session 标记为 dead（自愈耗尽终态）。
 * bin/workbench.mjs 在重启次数耗尽后调用。
 * @param {string} session
 */
export function markDead(session) {
  writeStatus(session, { supervisorState: 'dead' });
}

// ────────────────────────────────────────────────────────────────────────────
// 主 listener

/**
 * 启动 listener：
 * 1. 独立心跳 setInterval（绝不被 processRound 阻塞，DESIGN §13 P0-2）
 * 2. 独立对账 setInterval
 *
 * @param {{
 *   driver?: Function,
 *   intervalMs?: number,
 *   heartbeatMs?: number
 * }} opts
 * @returns {{ stop: () => void }}
 */
export function startListener({ driver, intervalMs = 2000, heartbeatMs = 10000, env = process.env } = {}) {
  if (!cloudAiEnabled(env)) return { stop() {}, enabled: false };
  // ① 心跳：独立定时，写所有活动 session 的心跳（不 await 任何 IO 密集操作）
  const heartbeatTimer = setInterval(() => {
    try {
      const sessions = listSessions();
      const now = new Date().toISOString();
      for (const session of sessions) {
        // 只写心跳，合并进现有 status
        writeStatus(session, { heartbeatAt: now });
      }
    } catch {
      // 心跳失败不能崩溃，静默忽略
    }
  }, heartbeatMs);

  // ② 对账轮询
  let reconciling = false;
  const reconcileTimer = setInterval(async () => {
    if (reconciling) return; // 防止并发
    reconciling = true;
    try {
      await reconcile({ driver });
    } catch {
      // 单次对账异常不拖垮 listener
    } finally {
      reconciling = false;
    }
  }, intervalMs);

  function stop() {
    clearInterval(heartbeatTimer);
    clearInterval(reconcileTimer);
  }

  return { stop, enabled: true };
}
