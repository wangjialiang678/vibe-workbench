export function sessions(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
  if (urlPath === '/api/sessions' && method === 'GET') {
    json(res, 200, { ok: true, sessions: listSessions() });
    return;
  }

}

export function projects(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
  if (urlPath === '/api/projects' && method === 'GET') {
    try {
      json(res, 200, { ok: true, ...projectCatalog() });
    } catch (error) {
      console.error('[workbench:projects] 项目目录读取失败：', error.message);
      json(res, 500, { ok: false, error: '项目目录读取失败' });
    }
    return;
  }

}

export function sessionContext(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
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

}
