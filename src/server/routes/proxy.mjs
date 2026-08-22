import {
  rewriteEmbedHtml,
} from '../server.mjs';

export function proxy(ctx) {
  const { req, res, expectedToken, eventWebhook, participantsFile, runtimeState, method, rawUrl, requestUrl, urlPath, identity, requestToken, json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer } = ctx;
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

  return false;
}
