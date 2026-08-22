import {
  listSessions,
  isValidSessionName,
  executionContextForSession,
  projectCatalog,
  sessionExists,
} from '../server.mjs';

export function sessions(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/sessions' && method === 'GET') {
    json(res, 200, { ok: true, sessions: listSessions() });
    return;
  }

  return false;
}

export function projects(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/projects' && method === 'GET') {
    try {
      json(res, 200, { ok: true, ...projectCatalog() });
    } catch (error) {
      console.error('[workbench:projects] 项目目录读取失败：', error.message);
      json(res, 500, { ok: false, error: '项目目录读取失败' });
    }
    return;
  }

  return false;
}

export function sessionContext(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/session-context' && method === 'GET') {
    if (!expectedToken || identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员 worker 可读取执行上下文' });
      return;
    }
    const { session } = parseQuery(rawUrl);
    if (!isValidSessionName(session)) {
      json(res, 400, { ok: false, error: 'session 参数无效' });
      return;
    }
    if (!sessionExists(session)) {
      json(res, 404, { ok: false, error: 'session 不存在' });
      return;
    }
    try {
      json(res, 200, { ok: true, context: executionContextForSession(session) });
    } catch (error) {
      console.error('[workbench:projects] 执行上下文读取失败：', error.message);
      json(res, 500, { ok: false, error: '执行上下文读取失败' });
    }
    return;
  }

  return false;
}
