// 状态徽章渲染。纯函数，返回 HTML 字符串。
// 用 displayState + badgeFor 输出图标+文案；
// 按 errorRetryable/badge.retry 决定是否渲染「重试」「强制重试」按钮（§13）。
import { displayState, badgeFor, errorRetryable } from '../protocol/status.mjs';

const SDK_FALLBACK_NOTICE = '（本次由 SDK 托底执行，走 API 计费）';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// statusResp: GET /api/status 的响应体（含 status.json 字段）
// now: 当前时间戳（毫秒），注入便于测试
export function statusBadgeHtml(statusResp, now) {
  const nowMs = now ?? Date.now();
  // /api/status 的真实结构是 { status: {...} }；同时保留对旧的裸 status 入参兼容。
  const hasNestedStatus = statusResp !== null
    && typeof statusResp === 'object'
    && Object.hasOwn(statusResp, 'status');
  const status = hasNestedStatus ? statusResp.status : statusResp;
  const error = status?.error ?? statusResp?.error;
  const workerOnline = hasNestedStatus && statusResp.workerOnline === true;
  const displ = workerOnline ? 'worker-online' : displayState(status, nowMs);
  const badge = workerOnline
    ? {
        icon: '',
        text: '● 云端 AI 在线（消息与提交自动处理）',
        retry: false,
      }
    : badgeFor(displ, {
        elapsedSec: status?.claimedAt
          ? Math.floor((nowMs - Date.parse(status.claimedAt)) / 1000)
          : undefined,
      });

  const driverSourceNote = status?.driverSource === 'sdk-fallback'
    ? `<span class="driver-source-note">${escHtml(SDK_FALLBACK_NOTICE)}</span>`
    : '';

  // 错误人话提示（P1：按 error.kind 显示 userMessage/suggestedAction）
  let errorDetail = '';
  if (displ === 'error' && error) {
    const err = error;
    const userMsg = escHtml(err.userMessage ?? err.message ?? '未知错误');
    const action = err.suggestedAction ? `<p class="error-action">${escHtml(err.suggestedAction)}</p>` : '';
    const rawDetail = err.message && err.userMessage
      ? `<details class="error-raw"><summary>技术详情</summary><pre>${escHtml(err.message)}</pre></details>`
      : '';
    errorDetail = `<div class="error-detail"><p class="error-msg">${userMsg}</p>${action}${rawDetail}</div>`;
  }

  // 重试按钮：按 badge.retry 和 error.kind 决定
  let retryBtn = '';
  if (badge.retry === 'force') {
    // 处理中：仅「强制重试」（二次确认）
    retryBtn = `<button class="retry-btn retry-force" data-action="force-retry"
      onclick="if(confirm('强制重试可能导致重复处理，确认？'))this.closest('[data-session]')?.dispatchEvent(new CustomEvent('retry',{detail:{force:true},bubbles:true}))">强制重试</button>`;
  } else if (badge.retry === true) {
    // 离线 / 可重试错误
    const canRetry = displ !== 'error' || errorRetryable(error?.kind);
    if (canRetry) {
      retryBtn = `<button class="retry-btn" data-action="retry">重试</button>`;
    }
  } else if (badge.retry === 'maybe' && displ === 'error') {
    const canRetry = errorRetryable(error?.kind);
    retryBtn = canRetry
      ? `<button class="retry-btn" data-action="retry">重试</button>`
      : '';
  }

  return `<div class="status-badge status-${escHtml(displ)}" data-state="${escHtml(displ)}">
  <span class="status-icon" aria-hidden="true">${badge.icon}</span>
  <span class="status-text">${escHtml(badge.text)}</span>
  ${driverSourceNote}
  ${retryBtn}
  ${errorDetail}
</div>`;
}
