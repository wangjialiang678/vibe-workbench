export function proxy(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
  if (urlPath === '/api/proxy') {
    const { url: targetUrl } = parseQuery(rawUrl);
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      cors(res);
      noReferrer(res);
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>无效的代理目标 URL</p>');
      return;
    }
    const selfOrigin = req.headers.host ? `http://${req.headers.host}` : '';
    (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const init = { method, signal: controller.signal, redirect: 'follow', headers: {} };
        if (method !== 'GET' && method !== 'HEAD') {
          init.body = await readRawBody(req);                       // 完整透传请求体
          const ct = req.headers['content-type'];
          if (ct) init.headers['content-type'] = ct;                // form-urlencoded / json 均可
        }
        const fr = await fetch(targetUrl, init);
        clearTimeout(timer);
        const ct = fr.headers.get('content-type') || 'text/html; charset=utf-8';
        cors(res);
        if (/text\/html/i.test(ct)) {
          const html = rewriteEmbedHtml(await fr.text(), fr.url || targetUrl, selfOrigin, requestToken);
          noReferrer(res);
          res.writeHead(fr.status, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } else {
          // 非 HTML（JSON/CSS/图片…）原样回传，状态码与 content-type 保真
          res.writeHead(fr.status, { 'Content-Type': ct });
          res.end(Buffer.from(await fr.arrayBuffer()));
        }
      } catch (err) {
        cors(res);
        noReferrer(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<p>无法加载该页面：${String(err.message ?? err)}</p>`);
      }
    })();
    return;
  }

}
