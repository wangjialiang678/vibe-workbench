import { isValidSessionName } from '../../workspace.mjs';
import { addParticipant, listParticipants, revokeParticipant } from '../../participants.mjs';
import { publicParticipant, participantInviteUrl } from '../auth.mjs';

export function participantsPublic(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/participants-public' && method === 'GET') {
    const { session } = parseQuery(rawUrl);
    if (!isValidSessionName(session)) {
      json(res, 400, { ok: false, error: 'session 参数无效' });
      return;
    }
    try {
      json(res, 200, listParticipants(participantsFile).map(({ id, name }) => ({ id, name })));
    } catch (error) {
      console.error('[workbench:participants] 公开名册读取失败：', error.message);
      json(res, 500, { ok: false, error: '参与者名册无法读取' });
    }
    return;
  }

  return false;
}

export function participants(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/participants' || urlPath.startsWith('/api/participants/')) {
    // 本地无口令时虽然旧 API 继续开放，但参与者名册管理必须显式提供管理员口令。
    if (!expectedToken || identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可管理参与者' });
      return;
    }
    if (urlPath === '/api/participants' && method === 'GET') {
      try { json(res, 200, { ok: true, participants: listParticipants(participantsFile) }); }
      catch (error) {
        console.error('[workbench:participants] 列表读取失败：', error.message);
        json(res, 500, { ok: false, error: '参与者名册无法读取' });
      }
      return;
    }
    if (urlPath === '/api/participants' && method === 'POST') {
      readBody(req).then((body) => {
        try {
          const participant = addParticipant(body || {}, { filePath: participantsFile });
          json(res, 201, {
            ok: true,
            participant: publicParticipant(participant),
            url: participantInviteUrl(req, participant.token),
          });
        } catch (error) {
          const damaged = /名册.*损坏/.test(error.message);
          json(res, damaged ? 500 : 400, { ok: false, error: error.message });
        }
      }).catch((error) => json(res, 400, { ok: false, error: `无效 JSON：${error.message}` }));
      return;
    }
    if (method === 'DELETE') {
      let id;
      try { id = decodeURIComponent(urlPath.slice('/api/participants/'.length)); }
      catch { id = ''; }
      try {
        if (!revokeParticipant(id, { filePath: participantsFile })) {
          json(res, 404, { ok: false, error: `参与者 ${id || '(空)'} 不存在` });
          return;
        }
        json(res, 200, { ok: true, id });
      } catch (error) {
        console.error('[workbench:participants] 吊销失败：', error.message);
        json(res, 500, { ok: false, error: '参与者名册无法更新' });
      }
      return;
    }
    json(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  return false;
}
