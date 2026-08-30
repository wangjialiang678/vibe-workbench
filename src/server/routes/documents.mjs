import { isValidSessionName } from '../../workspace.mjs';
import { appendStreamEntry } from '../../stream.mjs';
import { listDocuments, publishDocument, readDocument } from '../../documents.mjs';
import { DOCUMENT_REQUEST_LIMIT, AI_IDENTITY } from '../limits.mjs';

export function documentsGet(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/documents' && method === 'GET') {
    const { session, slug, category } = parseQuery(rawUrl);
    const hasSlug = requestUrl.searchParams.has('slug');
    const hasCategory = requestUrl.searchParams.has('category');
    if (!isValidSessionName(session)) {
      json(res, 400, { ok: false, error: 'session 参数无效' });
      return;
    }
    if (hasCategory && !hasSlug) {
      json(res, 400, { ok: false, error: 'category 查询必须同时提供 slug' });
      return;
    }
    try {
      if (!hasSlug) {
        json(res, 200, { documents: listDocuments(session, { exactSession: true }) });
        return;
      }
      const document = readDocument(session, {
        slug,
        ...(hasCategory ? { category } : {}),
        exactSession: true,
      });
      if (!document) {
        json(res, 404, { ok: false, error: '文档不存在' });
        return;
      }
      json(res, 200, { document });
    } catch (error) {
      if (error?.code === 'INVALID_DOCUMENT') {
        json(res, 400, { ok: false, error: error.message });
        return;
      }
      if (error?.code === 'AMBIGUOUS_DOCUMENT') {
        json(res, 409, { ok: false, error: error.message });
        return;
      }
      console.error('[workbench:documents] 读取失败：', error.message);
      json(res, 500, { ok: false, error: '文档读取失败' });
    }
    return;
  }

  return false;
}

export function documentsPost(ctx) {
  const { req, res, requestId, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
  if (urlPath === '/api/documents' && method === 'POST') {
    if (identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可发布文档' });
      return;
    }
    readBody(req, DOCUMENT_REQUEST_LIMIT).then((body) => {
      try {
        const saved = publishDocument(body, { exactSession: true });
        appendStreamEntry(body.session, {
          author: AI_IDENTITY,
          kind: 'receipt',
          text: `文档已更新：${saved.document.title}`,
        }, { exactSession: true });
        console.info('[workbench:documents]', {
          requestId, actor: identity.id, op: 'document.publish', outcome: 'success',
          session: body.session,
          category: saved.document.category,
          slug: saved.document.slug,
          created: saved.created,
          updatedAt: saved.document.updatedAt,
        });
        json(res, saved.created ? 201 : 200, { ok: true, ...saved });
      } catch (error) {
        if (error?.code === 'INVALID_DOCUMENT') {
          json(res, 400, { ok: false, error: error.message });
          return;
        }
        console.error('[workbench:documents] 写入失败：', error.message);
        json(res, 500, { ok: false, error: '文档写入失败' });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '文档请求体过大' });
        return;
      }
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

  return false;
}
