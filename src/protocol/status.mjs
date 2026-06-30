// 状态判定（DESIGN §6 + §13 P0-2）。浏览器安全。前端与服务端共用，杜绝心跳误报。
import { ERROR_KINDS, HEARTBEAT_STALE_MS } from './constants.mjs';

export { ERROR_KINDS, HEARTBEAT_STALE_MS };

// 把原始 status.json 折算成"展示态"——核心：claimed+心跳新鲜=processing(再久也不误判离线)
// 入参 now 为毫秒时间戳（注入便于测试）。
export function displayState(status, now) {
  if (!status || typeof status !== 'object') return 'unknown';
  if (status.supervisorState === 'dead') return 'dead'; // 自愈耗尽终态
  if (status.state === 'error') return 'error';
  if (status.state === 'responded') return 'responded';

  const hb = status.heartbeatAt ? Date.parse(status.heartbeatAt) : NaN;
  const fresh = Number.isFinite(hb) && (now - hb) <= HEARTBEAT_STALE_MS;

  if (status.state === 'claimed') return fresh ? 'processing' : 'offline'; // claimed 但心跳断 = listener 半途死
  if (status.state === 'submitted') return fresh ? 'submitted' : 'offline'; // 已提交待认领；心跳断=离线
  return status.state || 'rendered';
}

// 展示态 → 徽章文案/可操作性（前端用）
export function badgeFor(displ, opts = {}) {
  const elapsed = opts.elapsedSec != null ? `（已 ${opts.elapsedSec}s）` : '';
  switch (displ) {
    case 'rendered': return { icon: '⚪', text: '待你查看', retry: false };
    case 'submitted': return { icon: '🟢', text: '已提交·待处理', retry: false };
    case 'processing': return { icon: '🟡', text: `AI 处理中${elapsed}·可关闭页面，回复后会变蓝`, retry: 'force' };
    case 'responded': return { icon: '🔵', text: '已回复·点击查看新一轮', retry: false };
    case 'offline': return { icon: '🔴', text: 'AI 离线（提交已保存，恢复后自动处理）', retry: true };
    case 'error': return { icon: '⚠️', text: '出错', retry: 'maybe' }; // 由 error.kind 决定是否可重试
    case 'dead': return { icon: '⛔', text: '服务未恢复（已尝试自愈多次），提交已安全保存，请联系维护者', retry: false };
    default: return { icon: '…', text: '未知', retry: false };
  }
}

// error.kind → 是否提供「重试」（driver 配置类错误重试无用，不误导）
export function errorRetryable(kind) {
  return kind === 'timeout' || kind === 'api' || kind === 'unknown';
}
