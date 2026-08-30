// HTTP adapter composition root. Route handlers own endpoint behaviour; this file owns process lifecycle only.
import http from 'node:http';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARTICIPANTS_FILE } from '../participants.mjs';
import { createControlTowerService } from '../control-tower.mjs';
import { resetExpiredInboxClaims } from '../executor-inbox.mjs';
import { matchRoute } from './routes/index.mjs';
import { cors, json, noReferrer, parseQuery, readBody, readRawBody, readRawBodyLimited } from './http.mjs';
import { OWNER_IDENTITY, isControlPage, requestTokens, requiresPageToken, resolveRequestIdentity } from './auth.mjs';
import { configuredClaimTimeoutMs, inboxSweepIntervalMs } from './route-utils.mjs';
import { cloudAiEnabled } from '../cloud-ai.mjs';
import { readHealthVersion } from './version.mjs';

export { rewriteEmbedHtml } from './proxy-html.mjs';
export { safeTokenEqual, requiresPageToken } from './auth.mjs';
export { postWebhookEvent } from './notify.mjs';

function shortRequestId() {
  return Buffer.from(webcrypto.getRandomValues(new Uint8Array(6))).toString('hex');
}

function handleRequest(req, res, expectedToken = '', eventWebhook = '', participantsFile = DEFAULT_PARTICIPANTS_FILE, runtimeState = { workerHeartbeat: null }) {
  const requestId = shortRequestId(); const method = req.method.toUpperCase(); const rawUrl = req.url || '/'; const requestUrl = new URL(rawUrl, 'http://localhost'); const urlPath = requestUrl.pathname;
  if (method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (requiresPageToken(urlPath)) noReferrer(res);
  const isApi = urlPath.startsWith('/api/'); const protectedRequest = isApi || requiresPageToken(urlPath) || urlPath.startsWith('/assets/'); let auth;
  try { auth = resolveRequestIdentity(requestTokens(req, requestUrl, isApi), expectedToken, participantsFile); }
  catch (error) { console.error('[workbench:participants]', { requestId, op: 'auth.resolve', outcome: 'error', error: error.message }); if (isApi) json(res, 500, { ok: false, error: '参与者名册无法读取，请联系管理员' }); else { cors(res); res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('参与者名册无法读取，请联系管理员'); } return; }
  if (expectedToken && protectedRequest && !auth) { if (isApi) json(res, 403, { ok: false, error: '访问被拒绝：令牌缺失或无效' }); else { cors(res); res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('访问被拒绝：请在页面 URL 中提供有效令牌'); } return; }
  const identity = auth?.identity || OWNER_IDENTITY; const requestToken = auth?.token || ''; req.identity = identity; req.requestId = requestId;
  if (isControlPage(urlPath) && (!expectedToken || identity.role !== 'owner')) { cors(res); noReferrer(res); res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('访问被拒绝：控制塔仅限管理员'); return; }
  const ctx = { req, res, requestId, method, rawUrl, requestUrl, urlPath, identity, requestToken, expectedToken, eventWebhook, participantsFile, runtimeState, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer };
  const route = matchRoute(method, urlPath); if (route) { const handled = route.handler(ctx); if (handled === false && !res.writableEnded) json(res, 404, { ok: false, error: 'not found' }); return; } json(res, 404, { ok: false, error: 'not found' });
}

export function startServer(port, host = '127.0.0.1', { participantsFile = DEFAULT_PARTICIPANTS_FILE, env = process.env } = {}) {
  const listenHost = host || '127.0.0.1'; const token = env.WORKBENCH_TOKEN || ''; const eventWebhook = env.WORKBENCH_EVENT_WEBHOOK || ''; const inboxClaimTimeoutMs = configuredClaimTimeoutMs(env.WORKBENCH_INBOX_CLAIM_TIMEOUT_MS); const runtimeState = { workerHeartbeat: null, inboxClaimTimeoutMs, cloudAiEnabled: cloudAiEnabled(env), cloudAiExplicitlyDisabled: env.WB_CLOUD_AI === 'off', healthVersion: readHealthVersion() }; runtimeState.controlTowerService = createControlTowerService({ runtimeState });
  if (listenHost.toLowerCase() !== '127.0.0.1' && listenHost.toLowerCase() !== 'localhost' && !token) throw new Error('拒绝监听非本机地址：请先设置 WORKBENCH_TOKEN 访问令牌');
  const server = http.createServer((req, res) => handleRequest(req, res, token, eventWebhook, participantsFile, runtimeState));
  const inboxTimer = setInterval(() => { try { const reset = resetExpiredInboxClaims({ claimTimeoutMs: inboxClaimTimeoutMs }); if (reset > 0) console.info('[workbench:inbox]', { op: 'lease.sweep', outcome: 'requeued', count: reset }); } catch (error) { console.error('[workbench:inbox]', { op: 'lease.sweep', outcome: 'error', error: error.message }); } }, inboxSweepIntervalMs(inboxClaimTimeoutMs));
  inboxTimer.unref?.(); server.once('close', () => clearInterval(inboxTimer)); server.listen(port != null ? port : (parseInt(process.env.PORT, 10) || 8099), listenHost); return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) { const argPort = process.argv.includes('--port') ? parseInt(process.argv[process.argv.indexOf('--port') + 1], 10) : null; const host = process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : '127.0.0.1'; const server = startServer(argPort || parseInt(process.env.PORT, 10) || 8099, host); server.once('listening', () => console.log(`vibecoding workbench server listening on http://${host}:${server.address().port}`)); }
