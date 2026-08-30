import { isValidSessionName } from '../../workspace.mjs';
import { appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries } from '../../stream.mjs';
import { dispatchExecutorEvent } from '../notify.mjs';
import { MESSAGE_BODY_LIMIT, AI_IDENTITY } from '../limits.mjs';
import { acceptedSelfReport } from '../auth.mjs';
import { validStreamText } from '../route-utils.mjs';
import { assertParticipantCanAnswerAsk, filterStreamEntriesForIdentity } from '../visibility.mjs';

export function messagesGet(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/messages' && method === 'GET') {
    const { session, since } = parseQuery(rawUrl);
    if (!isValidSessionName(session)) {
      json(res, 400, { ok: false, error: 'session 参数无效' });
      return;
    }
    try {
      const entries = readStreamEntries(session, {
        ...(since ? { since } : {}),
        exactSession: true,
      });
      const allEntries = identity.role === 'participant'
        ? readStreamEntries(session, { limit: Number.MAX_SAFE_INTEGER, exactSession: true })
        : entries;
      const visibleEntries = filterStreamEntriesForIdentity(session, entries, allEntries, identity);
      // 前端需要服务端确认的身份来判断消息左右分侧；只返回公开身份字段，不暴露 token。
      json(res, 200, {
        ok: true,
        identity: { id: identity.id, name: identity.name, role: identity.role },
        entries: visibleEntries,
      });
    } catch (error) {
      console.error('[workbench:messages] 读取失败：', error.message);
      json(res, 500, { ok: false, error: '会话消息读取失败' });
    }
    return;
  }

  // D8 拍板语义：参与者与管理员随时可发消息（不受轮次状态限制，'提交不再是终局'）
  return false;
}

export function messagesPost(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/messages' && method === 'POST') {
    readBody(req, MESSAGE_BODY_LIMIT).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        json(res, 400, { ok: false, error: '请求体必须是消息对象' });
        return;
      }
      if (!isValidSessionName(body.session)) {
        json(res, 400, { ok: false, error: 'session 参数无效' });
        return;
      }
      const isAnswer = body.answerTo != null || body.answerValue != null;
      if (!isAnswer && !validStreamText(body.text)) {
        json(res, 400, { ok: false, error: 'text 必须非空且不超过 4000 字' });
        return;
      }
      let selfReportedBy;
      try {
        selfReportedBy = acceptedSelfReport(body.selfReport, identity, participantsFile);
      } catch (error) {
        if (error?.code === 'INVALID_SELF_REPORT') {
          json(res, 400, { ok: false, error: error.message });
          return;
        }
        console.error('[workbench:messages] 自报身份校验失败：', error.message);
        json(res, 500, { ok: false, error: '参与者名册无法读取' });
        return;
      }
      try {
        if (isAnswer) assertParticipantCanAnswerAsk(body.session, body.answerTo, identity);
        const entry = isAnswer
          ? appendAnswerEntry(body.session, {
              author: identity,
              ...(selfReportedBy ? { selfReportedBy } : {}),
              answerTo: body.answerTo,
              answerValue: body.answerValue,
            }, { exactSession: true })
          : appendStreamEntry(body.session, {
              author: identity,
              ...(selfReportedBy ? { selfReportedBy } : {}),
              kind: 'message',
              text: body.text,
            }, { exactSession: true });
        json(res, 200, { ok: true, entry });
        dispatchExecutorEvent(eventWebhook, {
          event: 'message-posted',
          session: body.session,
          id: entry.id,
          kind: entry.kind,
          author: entry.author,
          ...(selfReportedBy ? { selfReportedBy } : {}),
          at: entry.at,
        });
      } catch (error) {
        if (isAnswer) {
          const status = error?.code === 'ASK_ALREADY_ANSWERED'
            ? 409
            : error?.code === 'ASK_NOT_VISIBLE' ? 403 : 400;
          json(res, status, { ok: false, error: error.message });
          return;
        }
        console.error('[workbench:messages] 写入失败：', error.message);
        json(res, 500, { ok: false, error: '会话消息写入失败' });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '消息请求体过大' });
        return;
      }
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

  return false;
}

export function streamEvents(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/stream-events' && method === 'POST') {
    if (identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可写入 AI 流事件' });
      return;
    }
    readBody(req, MESSAGE_BODY_LIMIT).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || !isValidSessionName(body.session)) {
        json(res, 400, { ok: false, error: 'session 或请求体无效' });
        return;
      }
      if (!['message', 'progress', 'receipt', 'ask'].includes(body.kind)) {
        json(res, 400, { ok: false, error: 'kind 只允许 message、progress、receipt 或 ask' });
        return;
      }
      if (!validStreamText(body.text)) {
        json(res, 400, { ok: false, error: 'text 必须非空且不超过 4000 字' });
        return;
      }
      try {
        const event = {
          author: AI_IDENTITY,
          kind: body.kind,
          text: body.text,
          ...(body.refs != null ? { refs: body.refs } : {}),
          ...(body.kind === 'ask' ? { ask: body.ask } : {}),
        };
        const entry = body.kind === 'ask'
          ? appendAskEntry(body.session, event, { exactSession: true })
          : appendStreamEntry(body.session, event, { exactSession: true });
        json(res, 200, { ok: true, entry });
      } catch (error) {
        const status = error?.code === 'ASK_ALREADY_EXISTS' ? 409 : 400;
        json(res, status, { ok: false, error: error.message });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '事件请求体过大' });
        return;
      }
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

  return false;
}
