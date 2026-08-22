export function pages(ctx) {
  const { rewriteEmbedHtml, visibleBlocksForIdentity, participantFeedbackEntries, TERMINAL_OR_PROCESSING_STATES, selfReportSlug, sharedDisplayName, json, req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, fs, path, computeDiff, removedBlocks, diffSanity, validateContent, validateFeedback, lintContent, formatLint, findIncompleteDecisions, formatIncompleteDecisions, displayState, HEARTBEAT_STALE_MS, DEFAULT_PARTICIPANTS_FILE, addParticipant, findParticipantByToken, listParticipants, revokeParticipant, paths, workspaceDir, readJSON, writeJSON, writeText, removeFile, exists, readStatus, writeStatus, listSessions, listRounds, isValidSessionName, prepareRound, writeRound, appendAnswerEntry, appendAskEntry, appendStreamEntry, readStreamEntries, DOCUMENT_BODY_LIMIT, listDocuments, publishDocument, readDocument, executionContextForSession, projectCatalog, registeredProjectForSession, sessionExists, updateSessionMetadata, DEFAULT_CLAIM_TIMEOUT_MS, INBOX_PAYLOAD_LIMIT, claimInboxTask, completeInboxTask, enqueueInboxTask, listInboxTasks, renewInboxTask, resetExpiredInboxClaims, dispatchExecutorEvent, postWebhookEvent, SRC_ROOT, ROUND_BODY_LIMIT, MESSAGE_BODY_LIMIT, ATTACHMENT_BODY_LIMIT, DOCUMENT_REQUEST_LIMIT, WORKER_HEARTBEAT_BODY_LIMIT, INBOX_REQUEST_LIMIT, UNCLASSIFIED_SESSION_WARNING, WORKER_HEARTBEAT_STALE_MS, AI_IDENTITY, ATTACHMENT_TYPES, MIME, PUBLIC_STATIC_EXTENSIONS, assetsVersion, requiresPageToken, isControlPage, cors, noReferrer, safeTokenEqual, requestTokens, resolveRequestIdentity, OWNER_IDENTITY, normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment, validRoundQuery, workerPresence, renderUrl, publicParticipant, participantInviteUrl, acceptedSelfReport, validStreamText, assertParticipantCanAnswerAsk, feedbackVisibilityForIdentity, filterFeedbackForIdentity, filterStreamEntriesForIdentity, feedbackView, feedbackToMd, respondInboxError, parseQuery, readBody, readRawBody, readRawBodyLimited } = ctx;
  if (method === 'GET') {
    // Redirect / → /render/index.html
    if (urlPath === '/') {
      cors(res);
      const tokenQuery = requestToken ? `?token=${encodeURIComponent(requestToken)}` : '';
      res.writeHead(302, { Location: `/render/index.html${tokenQuery}` });
      res.end();
      return;
    }

    // Resolve path within SRC_ROOT; prevent directory traversal
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      json(res, 400, { ok: false, error: 'path encoding invalid' });
      return;
    }
    const abs = path.resolve(SRC_ROOT, '.' + rel);
    if (!abs.startsWith(SRC_ROOT + path.sep) && abs !== SRC_ROOT) {
      json(res, 403, { ok: false, error: 'forbidden' });
      return;
    }

    let filePath = abs;
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        // 目录请求（如 /render/）→ 回退到 index.html
        filePath = path.join(filePath, 'index.html');
        fs.statSync(filePath); // 不存在则抛
      }
    } catch {
      // 非现成文件/目录：对无扩展名路径尝试 .html 回退（如 /foo → foo.html）
      if (!path.extname(abs)) {
        try { fs.statSync(abs + '.html'); filePath = abs + '.html'; }
        catch { json(res, 404, { ok: false, error: 'not found' }); return; }
      } else {
        json(res, 404, { ok: false, error: 'not found' });
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    cors(res);
    if (ext === '.html') noReferrer(res);

    // 渲染页模板化（DESIGN §6.7，2026-08-13）：注入资产版本 + import map，
    // 让所有 JS/CSS 以 ?v=版本 加载——从 URL 层面击穿 headerless 时代遗留的启发式缓存
    // （响应头无法清除浏览器已存的旧条目，改 URL 是唯一客户端无感的根治手段）。
    // 另发 Clear-Site-Data 清一次本源缓存（不支持的浏览器忽略，无害）。
    if (filePath === path.join(SRC_ROOT, 'render', 'index.html')) {
      const v = assetsVersion();
      const imports = {};
      for (const f of fs.readdirSync(path.join(SRC_ROOT, 'render'))) {
        if (f.endsWith('.mjs')) imports['./' + f] = `./${f}?v=${v}`;
      }
      // render 模块经 '../protocol/x.mjs' 引用的共享模块同样要版本化，否则仍可能命中历史缓存
      for (const f of fs.readdirSync(path.join(SRC_ROOT, 'protocol'))) {
        if (f.endsWith('.mjs')) imports['../protocol/' + f] = `../protocol/${f}?v=${v}`;
      }
      const html = fs.readFileSync(filePath, 'utf8')
        .replaceAll('__WB_ASSETS_V__', v)
        .replaceAll('__WB_TITLE__', process.env.WORKBENCH_TITLE || 'Vibe Coding工作台')
        .replace('<!--__WB_IMPORTMAP__-->', `<script type="importmap">${JSON.stringify({ imports })}</script>`);
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-store, must-revalidate',
        'Clear-Site-Data': '"cache"',
      });
      res.end(html);
      return;
    }

    // 本地开发工具：静态资源不缓存，避免改了代码浏览器仍用旧的（普通刷新即拿最新）
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store, must-revalidate' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Fallthrough: 404
  json(res, 404, { ok: false, error: 'not found' });
}
