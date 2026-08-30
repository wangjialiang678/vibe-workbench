import { WORKER_HEARTBEAT_BODY_LIMIT } from '../limits.mjs';

export function worker(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/worker-heartbeat' && method === 'POST') {
    // 该端点只服务于持有管理员口令的常驻 worker；本地兼容 owner 身份不能写入。
    if (!expectedToken || identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员 worker 可上报心跳' });
      return;
    }
    readBody(req, WORKER_HEARTBEAT_BODY_LIMIT).then((body) => {
      const at = typeof body?.at === 'string' ? Date.parse(body.at) : NaN;
      const label = body?.label;
      if (!Number.isFinite(at)) {
        json(res, 400, { ok: false, error: 'at 必须是有效时间' });
        return;
      }
      if (label != null && (typeof label !== 'string' || !label.trim() || label.trim().length > 100)) {
        json(res, 400, { ok: false, error: 'label 必须是 1—100 字符的字符串' });
        return;
      }
      runtimeState.workerHeartbeat = {
        at: new Date(at).toISOString(),
        ...(label == null ? {} : { label: label.trim() }),
      };
      json(res, 200, { ok: true, ...runtimeState.workerHeartbeat });
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '心跳请求体过大' });
        return;
      }
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

  return false;
}
