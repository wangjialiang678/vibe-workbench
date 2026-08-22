export function worker(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
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

}
