export function attachments(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
  if (urlPath === '/api/attachments' && method === 'POST') {
    const { session } = parseQuery(rawUrl);
    if (!isValidSessionName(session)) {
      json(res, 400, { ok: false, error: 'session 参数无效' });
      req.resume();
      return;
    }
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = ATTACHMENT_TYPES.get(contentType);
    if (!extension) {
      json(res, 415, { ok: false, error: '附件类型不支持：仅允许 PNG/JPEG/WebP/GIF/PDF' });
      req.resume();
      return;
    }
    const originalName = req.headers['x-file-name'];
    if (typeof originalName !== 'string' || !originalName.trim()) {
      json(res, 400, { ok: false, error: '缺少 x-file-name 文件名' });
      req.resume();
      return;
    }
    readRawBodyLimited(req, ATTACHMENT_BODY_LIMIT).then((body) => {
      try {
        const filename = writeAttachment(session, originalName, extension, body);
        json(res, 200, { ok: true, url: `/assets/${session}/uploads/${filename}` });
      } catch (error) {
        console.error('[workbench:attachments] 写入失败：', error.message);
        json(res, 500, { ok: false, error: '附件写入失败' });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '附件过大：单文件上限为 5 MB' });
        return;
      }
      json(res, 400, { ok: false, error: `附件读取失败：${error.message}` });
    });
    return;
  }

}

export function assetsApi(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
  if (urlPath === '/api/assets' && method === 'GET') {
    const { session, round } = parseQuery(rawUrl);
    if (!isValidSessionName(session)) {
      json(res, 400, { ok: false, error: 'session 参数无效' });
      return;
    }
    const requestedRound = round == null ? null : validRoundQuery(round);
    if (round != null && requestedRound == null) {
      json(res, 400, { ok: false, error: 'round 参数无效' });
      return;
    }
    try {
      json(res, 200, {
        ok: true,
        files: listSessionAssets(
          session,
          visibleAssetPathsForIdentity(session, identity, requestedRound, assetServiceOrigin(req)),
        ),
      });
    } catch (error) {
      console.error('[workbench:assets] 索引失败：', error.message);
      json(res, 500, { ok: false, error: '会话资产读取失败' });
    }
    return;
  }

}

export function sessionAssets(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
  if (method === 'GET' && urlPath.startsWith('/assets/')) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath.slice('/assets/'.length));
    } catch {
      json(res, 400, { ok: false, error: 'asset path encoding invalid' });
      return;
    }
    const slash = rel.indexOf('/');
    const session = slash === -1 ? rel : rel.slice(0, slash);
    const sub = slash === -1 ? '' : rel.slice(slash + 1);
    // session 名白名单 + 子路径穿越防护
    if (!session || !sub || !/^[A-Za-z0-9._-]+$/.test(session)) {
      json(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const root = path.resolve(workspaceDir(), session, 'assets');
    const normalizedSub = normalizeAssetSubpath(sub);
    if (!normalizedSub) {
      json(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    const { round } = parseQuery(rawUrl);
    const requestedRound = round == null ? null : validRoundQuery(round);
    if (round != null && requestedRound == null) {
      json(res, 400, { ok: false, error: 'round 参数无效' });
      return;
    }
    const allowedAssetPaths = visibleAssetPathsForIdentity(
      session,
      identity,
      requestedRound,
      assetServiceOrigin(req),
    );
    if (allowedAssetPaths && !allowedAssetPaths.has(normalizedSub)) {
      json(res, 403, { ok: false, error: 'asset forbidden' });
      return;
    }
    const abs = path.resolve(root, normalizedSub);
    if (!abs.startsWith(root + path.sep)) {
      json(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    try {
      const buf = readAssetFile(root, normalizedSub);
      const ext = path.extname(normalizedSub).toLowerCase();
      cors(res);
      if (ext === '.html') noReferrer(res);
      // 防存储型 XSS：禁止 MIME 嗅探；PDF 等可执行脚本的文档强制下载而非内嵌打开
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        ...(ext === '.pdf' ? { 'Content-Disposition': 'attachment' } : {}),
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    } catch (error) {
      if (error?.code === 'ASSET_FORBIDDEN') {
        json(res, 403, { ok: false, error: 'forbidden' });
        return;
      }
      json(res, 404, { ok: false, error: 'asset not found' });
    }
    return;
  }

  // --- Static files (src/ as root) ---
}
