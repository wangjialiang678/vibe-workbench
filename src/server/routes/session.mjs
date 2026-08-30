import { computeDiff, removedBlocks, diffSanity } from '../../protocol/diff.mjs';
import { lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions } from '../../protocol/lint.mjs';
import { displayState } from '../../protocol/status.mjs';
import { HEARTBEAT_STALE_MS } from '../../protocol/constants.mjs';
import { paths, readJSON, removeFile, readStatus, writeStatus, isValidSessionName, prepareRound } from '../../workspace.mjs';
import { appendStreamEntry } from '../../stream.mjs';
import { registeredProjectForSession, updateSessionMetadata } from '../../projects.mjs';
import { dispatchExecutorEvent } from '../notify.mjs';
import { ROUND_BODY_LIMIT, UNCLASSIFIED_SESSION_WARNING, AI_IDENTITY } from '../limits.mjs';
import { assetsVersion } from '../static.mjs';
import { validRoundQuery, workerPresence } from '../route-utils.mjs';
import { renderUrl } from '../assets.mjs';
import { visibleBlocksForIdentity, feedbackVisibilityForIdentity, filterFeedbackForIdentity } from '../visibility.mjs';
import { presentRound } from '../../core/present.mjs';

export function rounds(ctx) {
  const { req, res, requestId, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/rounds' && method === 'POST') {
    // 出题权只属于管理员（owner）：参与者的职责是判断，不是发起新一轮
    if (expectedToken && identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可创建新一轮' });
      return;
    }
    readBody(req, ROUND_BODY_LIMIT).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        json(res, 400, { ok: false, error: '请求体必须是完整的 content JSON' });
        return;
      }
      if (!isValidSessionName(body.session)) {
        json(res, 400, { ok: false, error: 'session 名称无效：限 80 字符，仅允许字母、数字、点、下划线和连字符' });
        return;
      }

      let content;
      try {
        // 轮次号由云端唯一分配：忽略客户端指定值，响应返回实际轮号。
        // 并发写仍由 writeRound 的原子 mkdir 兜底，绝不覆盖已有目录。
        const bodyWithoutRound = { ...body };
        delete bodyWithoutRound.round;
        content = prepareRound(body.session, bodyWithoutRound, { exactSession: true });
      } catch (error) {
        if (error?.code === 'INVALID_CONTENT') {
          json(res, 400, { ok: false, error: `内容校验失败：${error.errors.join('; ')}`, errors: error.errors });
          return;
        }
        throw error;
      }

      const allowIncomplete = requestUrl.searchParams.get('allowIncomplete') === '1';
      const incomplete = findIncompleteDecisions(content);
      if (incomplete.length && !allowIncomplete) {
        json(res, 400, {
          ok: false,
          error: formatIncompleteDecisions(incomplete),
          errors: incomplete.map((issue) => `[${issue.blockId}] 缺少：${issue.missingFields.join('、')}`),
        });
        return;
      }

      const warnings = lintContent(content);
      if (warnings.length) console.info('[workbench:rounds]', { requestId, session: content.session, round: content.round, actor: identity.id, op: 'round.present', outcome: 'lint-warning', warnings: formatLint(warnings) });

      try {
        const registeredProject = content.round === 1
          ? registeredProjectForSession(content.session)
          : null;
        const saved = presentRound(content.session, content, { exactSession: true, journal: { actor: identity.id, requestId } });
        if (content.round === 1) {
          updateSessionMetadata(saved.session, {
            ...(typeof content.title === 'string' && content.title.trim()
              ? { title: content.title.trim() }
              : {}),
            ...(registeredProject ? { projectId: registeredProject.id } : {}),
            kind: 'work',
            status: 'active',
          }, { exactSession: true });
        }
        appendStreamEntry(saved.session, {
          author: AI_IDENTITY,
          kind: 'receipt',
          text: `已出第 ${saved.round} 轮：${content.title || '未命名轮次'}`,
          refs: { round: saved.round },
        }, { exactSession: true });
        const response = {
          ok: true,
          session: saved.session,
          round: saved.round,
          url: renderUrl(req, saved.session),
        };
        if (allowIncomplete) response.lintBypassed = true;
        if (content.round === 1 && !registeredProject) {
          response.warning = UNCLASSIFIED_SESSION_WARNING;
        }
        console.info('[workbench:rounds]', { requestId, session: saved.session, round: saved.round, actor: identity.id, op: 'round.present', outcome: 'success' });
        json(res, 200, response);
        dispatchExecutorEvent(eventWebhook, {
          event: 'round-presented',
          session: saved.session,
          round: saved.round,
          ...(typeof content.title === 'string' && content.title ? { title: content.title } : {}),
          at: new Date().toISOString(),
        }, { requestId });
      } catch (error) {
        if (error?.code === 'ROUND_EXISTS') {
          json(res, 409, { ok: false, error: `round ${content.round} 已存在，不允许覆盖` });
          return;
        }
        if (error?.code === 'INVALID_CONTENT') {
          json(res, 400, { ok: false, error: `内容校验失败：${error.errors.join('; ')}`, errors: error.errors });
          return;
        }
        console.error('[workbench:rounds]', { requestId, session: content.session, round: content.round, actor: identity.id, op: 'round.present', outcome: 'error', error: error.message });
        json(res, 500, { ok: false, error: '轮次写入失败，请查看服务端日志' });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '请求体过大：上限为 2 MB' });
        return;
      }
      console.error('[workbench:rounds]', { requestId, op: 'round.present', outcome: 'error', error: error.message });
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

  return false;
}

export function status(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/status' && method === 'GET') {
    const { session } = parseQuery(rawUrl);
    const status = session ? readStatus(session) : null;
    const worker = workerPresence(runtimeState);
    if (!status) {
      json(res, 200, {
        ok: true,
        status: null,
        display: 'unknown',
        assetsVersion: assetsVersion(),
        ...worker,
      });
      return;
    }
    const roundError = status.state === 'error' && Number.isInteger(status.round)
      ? readJSON(paths.error(session, status.round), null)
      : null;
    // 只合并到 API 响应副本，兼容旧 status.json 且不改变落盘结构。
    const responseStatus = roundError ? { ...status, error: roundError } : status;
    const now = Date.now();
    const display = displayState(responseStatus, now);
    const hb = responseStatus.heartbeatAt ? Date.parse(responseStatus.heartbeatAt) : NaN;
    const stale = !Number.isFinite(hb) || (now - hb) > HEARTBEAT_STALE_MS;
    json(res, 200, {
      ok: true,
      status: responseStatus,
      display,
      stale,
      assetsVersion: assetsVersion(),
      ...worker,
    });
    return;
  }

  return false;
}

export function content(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/content' && method === 'GET') {
    const { session, round } = parseQuery(rawUrl);
    const r = parseInt(round, 10);
    if (!session || !Number.isInteger(r) || r < 1) {
      json(res, 400, { ok: false, error: 'session and round required' });
      return;
    }
    const content = readJSON(paths.content(session, r), null);
    if (!content) {
      json(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const prevRound = content.prevRound || (r > 1 ? r - 1 : 0);
    const prevContent = prevRound > 0 ? readJSON(paths.content(session, prevRound), null) : null;
    const currentContentBlocks = Array.isArray(content.blocks) ? content.blocks : null;
    const currentBlocks = visibleBlocksForIdentity(currentContentBlocks || [], identity);
    const prevBlocks = prevContent ? visibleBlocksForIdentity(prevContent.blocks || [], identity) : [];
    const diffed = computeDiff(currentBlocks, prevBlocks);
    const currentBlockIds = new Set(
      (currentContentBlocks || [])
        .map((block) => block?.id)
        .filter((id) => typeof id === 'string'),
    );
    const removed = currentContentBlocks
      ? removedBlocks(currentBlocks, prevBlocks).filter((block) => !currentBlockIds.has(block?.id))
      : [];
    const sanity = diffSanity(diffed, removed);

    // 改动 E + 改动 C（DESIGN §4）：注入 _respondedToPrev 与 _decidedInPrev
    // 读上一轮 feedback；null guard：缺失/第1轮/文件被删均安全跳过，绝不报错
    const prevFeedback = prevRound > 0
      ? filterFeedbackForIdentity(
          readJSON(paths.feedback(session, prevRound), null),
          feedbackVisibilityForIdentity(session, prevRound, identity),
        )
      : null;
    let finalBlocks = diffed;
    if (prevFeedback && Array.isArray(prevFeedback.items)) {
      const respondedIds = new Set(prevFeedback.items.map((it) => it.blockId).filter(Boolean));
      finalBlocks = diffed.map((b) => {
        if (respondedIds.has(b.id)) {
          const patch = { _respondedToPrev: true };
          // 改动 C：本轮 unchanged + 上轮已反馈 → 已决项沉降标记
          if (b._change === 'unchanged') patch._decidedInPrev = true;
          return { ...b, ...patch };
        }
        return b;
      });
    }

    json(res, 200, { ...content, blocks: finalBlocks, removed, sanity });
    return;
  }

  return false;
}

export function retry(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/retry' && method === 'POST') {
    if (identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可重试轮次' });
      return;
    }
    const { session, round } = parseQuery(rawUrl);
    const r = validRoundQuery(round);
    if (!isValidSessionName(session) || r == null) {
      json(res, 400, { ok: false, error: 'session and round required' });
      return;
    }
    const pathOptions = { exactSession: true };
    removeFile(paths.ack(session, r, pathOptions));
    removeFile(paths.error(session, r, pathOptions));
    writeStatus(session, { state: 'submitted', error: null, round: r }, undefined, pathOptions);
    json(res, 200, { ok: true });
    return;
  }

  // --- 会话资产：/assets/<session>/<path> → workspace/<session>/assets/<path> ---
  // 用途：session 自带的静态资源（如高保真 UI 设计稿 HTML），让工作台自托管，
  // 不再依赖外部服务（此前 prd-studio 的 :8088 必须开着才能看 UI 面）。
  return false;
}
