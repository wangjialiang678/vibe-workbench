import { DEFAULT_CLAIM_TIMEOUT_MS } from '../executor-inbox.mjs';
import { json } from './http.mjs';
import { WORKER_HEARTBEAT_STALE_MS } from './limits.mjs';

export function validRoundQuery(value) { if (!/^[1-9]\d*$/.test(String(value || ''))) return null; const round = Number(value); return Number.isSafeInteger(round) ? round : null; }
export function validStreamText(value, maxLength = 4000) { return typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= maxLength; }
export function configuredClaimTimeoutMs(value) { if (!/^[1-9]\d*$/.test(String(value || ''))) return DEFAULT_CLAIM_TIMEOUT_MS; const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : DEFAULT_CLAIM_TIMEOUT_MS; }
export function inboxSweepIntervalMs(claimTimeoutMs) { return Math.max(10, Math.min(60 * 1000, Math.floor(claimTimeoutMs / 2))); }
export function workerPresence(runtimeState, now = Date.now()) { const heartbeat = runtimeState.workerHeartbeat; const at = heartbeat?.at ? Date.parse(heartbeat.at) : NaN; const age = now - at; return { workerOnline: Number.isFinite(at) && age >= 0 && age < WORKER_HEARTBEAT_STALE_MS, workerLabel: heartbeat?.label || null }; }
export function respondInboxError(res, error, action) { const status = error?.code === 'INBOX_PAYLOAD_TOO_LARGE' ? 413 : error?.code === 'INVALID_INBOX_TASK' ? 400 : error?.code === 'INBOX_NOT_FOUND' ? 404 : error?.code === 'INBOX_CONFLICT' ? 409 : 500; if (status === 500) console.error(`[workbench:inbox] ${action}失败：`, error); json(res, status, { ok: false, error: status === 500 ? `收件箱${action}失败` : error.message }); }
