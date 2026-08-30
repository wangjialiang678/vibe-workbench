import path from 'node:path';
import { workspaceDir, isValidSessionName } from '../../workspace.mjs';
import { ATTACHMENT_BODY_LIMIT, ATTACHMENT_TYPES } from '../limits.mjs';
import { MIME } from '../static.mjs';
import { normalizeAssetSubpath, readAssetFile, visibleAssetPathsForIdentity, assetServiceOrigin, listSessionAssets, writeAttachment } from '../assets.mjs';
import { validRoundQuery } from '../route-utils.mjs';

export function attachments(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
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

  return false;
}

export function assetsApi(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
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

  return false;
}

export function sessionAssets(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
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
  return false;
}
