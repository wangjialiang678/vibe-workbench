import { validateFeedback } from '../../protocol/schema.mjs';
import { appendJournal, latestRound, paths, readJSON, writeJSON, writeText, readStatus, writeStatus, isValidSessionName } from '../../workspace.mjs';
import { appendStreamEntry } from '../../stream.mjs';
import { dispatchExecutorEvent } from '../notify.mjs';
import { AI_IDENTITY } from '../limits.mjs';
import { validRoundQuery } from '../route-utils.mjs';
import { acceptedSelfReport, selfReportSlug, sharedDisplayName } from '../auth.mjs';
import { TERMINAL_OR_PROCESSING_STATES, feedbackVisibilityForIdentity, feedbackView } from '../visibility.mjs';

function feedbackToMd(fb) {
  const lines = [`# Feedback — session ${fb.session} round ${fb.round}`, `Submitted: ${fb.submittedAt}`, ''];
  if (fb.summary) lines.push(`**Summary:** ${fb.summary}`, '');
  if (fb.sessionComment) lines.push('## 💬 会话级留言（不针对具体块）', '', fb.sessionComment, '');
  if (Array.isArray(fb.unanswered) && fb.unanswered.length) lines.push(`**未表态（没看/未操作）:** ${fb.unanswered.join(', ')}`, '');
  for (const item of fb.items || []) { lines.push(`## Block: ${item.blockId}`); if (item.type) lines.push(`- type: ${item.type}`); if (item.value != null) lines.push(`- value: ${JSON.stringify(item.value)}`); if (item.comment) lines.push(`- comment: ${item.comment}`); lines.push(''); }
  return lines.join('\n');
}

export function feedbackGet(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/feedback' && method === 'GET') {
    const { session, round, history } = parseQuery(rawUrl);
    const parsedRound = validRoundQuery(round);
    if (!isValidSessionName(session) || parsedRound == null) {
      json(res, 400, { ok: false, error: 'session 或 round 参数无效' });
      return;
    }
    const includeHistory = history === '1';
    const view = feedbackView(session, parsedRound, identity, { history: includeHistory });
    if (!view.feedback && (!includeHistory || view.submissions.length === 0)) {
      json(res, 200, { ok: false, pending: true });
      return;
    }
    json(res, 200, { ok: true, ...view });
    return;
  }

  return false;
}

export function feedbackPost(ctx) {
  const { req, res, requestId, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/feedback' && method === 'POST') {
    readBody(req).then((fb) => {
      if (!fb) { json(res, 400, { ok: false, error: 'body required' }); return; }
      const vr = validateFeedback(fb);
      if (!vr.ok) { json(res, 400, { ok: false, error: vr.errors.join('; ') }); return; }

      const { session } = fb;
      const round = parseInt(fb.round, 10);
      // 与 GET 侧一致的防御深度：session/round 先过白名单再进任何路径拼接
      if (!isValidSessionName(session) || !Number.isInteger(round) || round < 1) {
        json(res, 400, { ok: false, error: 'session 或 round 参数无效' });
        return;
      }
      if (round < latestRound(session, { exactSession: true })) {
        json(res, 409, { error: 'ROUND_READONLY' });
        return;
      }
      let selfReportedBy;
      try {
        selfReportedBy = acceptedSelfReport(fb.selfReport, identity, participantsFile);
      } catch (error) {
        if (error?.code === 'INVALID_SELF_REPORT') {
          json(res, 400, { ok: false, error: error.message });
          return;
        }
        console.error('[workbench:feedback]', { requestId, actor: identity.id, op: 'feedback.submit', outcome: 'error', error: error.message });
        json(res, 500, { ok: false, error: '参与者名册无法读取' });
        return;
      }
      if (identity.role === 'participant') {
        const visibility = feedbackVisibilityForIdentity(session, round, identity);
        if (!visibility.valid) {
          json(res, 403, { ok: false, error: '无法验证当前轮内容，拒绝写入反馈' });
          return;
        }
        const forbiddenBlockIds = [...new Set(
          [
            ...fb.items.map((item) => item?.blockId),
            ...(Array.isArray(fb.unanswered) ? fb.unanswered : []),
          ]
            .filter((blockId) => (
              typeof blockId !== 'string'
              || !visibility.knownBlockIds.has(blockId)
              || !visibility.visibleBlockIds.has(blockId)
            )),
        )];
        if (forbiddenBlockIds.length) {
          console.info('[workbench:feedback]', { requestId, session, round, actor: identity.id, op: 'feedback.submit', outcome: 'rejected-invisible-blocks', blockIds: forbiddenBlockIds });
          json(res, 403, {
            ok: false,
            error: `反馈包含不可见块：${forbiddenBlockIds.join('、')}`,
            blockIds: forbiddenBlockIds,
          });
          return;
        }
      }
      const pathOptions = { exactSession: true };
      const st = readStatus(session, pathOptions);
      if (identity.role === 'owner' && st && st.state === 'claimed') {
        json(res, 409, { ok: false, error: 'claimed' });
        return;
      }

      const now = new Date().toISOString();
      const submittedBy = { id: identity.id, name: identity.name };
      // submittedBy 永远由服务端覆盖，不能信任客户端自报身份。
      const {
        selfReport: _clientSelfReport,
        selfReportedBy: _clientSelfReportedBy,
        ...feedbackFields
      } = fb;
      const saved = {
        ...feedbackFields,
        submittedAt: now,
        submittedBy,
        ...(selfReportedBy ? { selfReportedBy } : {}),
      };
      // 每笔提交无条件先落历史件：共享 owner 链接多人先后提交曾互相覆盖，
      // 2026-08-19 思锐门户因此永久丢失两笔客户反馈——主文件仍保持"最新一笔"语义，历史件保证零丢失。
      writeJSON(paths.feedbackHistory(
        session,
        round,
        `${now.replace(/[:.]/g, '-')}-${process.hrtime.bigint().toString(36)}`,
        identity.id,
        { ...pathOptions, ...(selfReportedBy ? { selfReportSlug: selfReportSlug(selfReportedBy.name) } : {}) },
      ), saved);
      const primaryPath = paths.feedback(session, round, pathOptions);
      if (identity.role === 'participant') {
        writeJSON(paths.participantFeedback(session, round, identity.id, pathOptions), saved);
        const primary = readJSON(primaryPath, null);
        const mayRefreshBridge = !primary || (
          primary.submittedBy?.id === identity.id
          && !TERMINAL_OR_PROCESSING_STATES.has(st?.state)
        );
        if (mayRefreshBridge) {
          writeJSON(primaryPath, saved);
          writeText(paths.feedbackMd(session, round, pathOptions), feedbackToMd(saved));
        }
        if (!TERMINAL_OR_PROCESSING_STATES.has(st?.state)) {
          writeStatus(session, { state: 'submitted', round, error: null }, undefined, pathOptions);
        }
      } else {
        writeJSON(primaryPath, saved);
        writeText(paths.feedbackMd(session, round, pathOptions), feedbackToMd(saved));
        writeStatus(session, { state: 'submitted', round, error: null }, undefined, pathOptions);
      }
      appendStreamEntry(session, {
        author: AI_IDENTITY,
        kind: 'receipt',
        text: selfReportedBy
          ? `${sharedDisplayName(selfReportedBy)}已提交第 ${round} 轮反馈`
          : `${submittedBy.name} 已提交第 ${round} 轮反馈`,
        ...(selfReportedBy ? { selfReportedBy } : {}),
        refs: { round },
      }, pathOptions);
      try {
        appendJournal(session, {
          event: 'feedback.submitted', round, actor: identity.id, requestId, outcome: 'success',
        }, pathOptions);
      } catch (error) {
        console.error('[workbench:journal]', { requestId, session, round, actor: identity.id, op: 'feedback.submit', outcome: 'journal-failed', error: error.message });
      }
      console.info('[workbench:feedback]', { requestId, session, round, actor: identity.id, op: 'feedback.submit', outcome: 'success' });
      json(res, 200, { ok: true, count: (fb.items || []).length });
      dispatchExecutorEvent(eventWebhook, {
        event: 'feedback-submitted',
        session,
        round,
        submittedBy,
        ...(selfReportedBy ? { selfReportedBy } : {}),
        at: now,
      }, { requestId });
    }).catch((e) => {
      if (e instanceof SyntaxError) {
        json(res, 400, { ok: false, error: 'invalid JSON: ' + e.message });
      } else {
        console.error('[workbench:feedback]', { requestId, op: 'feedback.submit', outcome: 'error', error: e.message });
        json(res, 500, { ok: false, error: '反馈写入失败' });
      }
    });
    return;
  }

  // embed 代理：支持 GET/POST/PUT/DELETE（P0 · iteration-brief 2026-07-13）
  // 此前只认 GET → 被嵌页面内的表单 POST 无转发通道，字段丢失（实证 bug）。
  return false;
}
