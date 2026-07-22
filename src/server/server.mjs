// 零依赖 HTTP server（DESIGN §8 + §13）。ESM，node:http only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { computeDiff, removedBlocks, diffSanity } from '../protocol/diff.mjs';
import { validateFeedback } from '../protocol/schema.mjs';
import { displayState } from '../protocol/status.mjs';
import { HEARTBEAT_STALE_MS } from '../protocol/constants.mjs';
import {
  paths,
  workspaceDir,
  readJSON,
  writeJSON,
  writeText,
  removeFile,
  exists,
  readStatus,
  writeStatus,
  listSessions,
} from '../workspace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 静态根 = src/ 目录 (即 __dirname 的父目录)
const SRC_ROOT = path.resolve(__dirname, '..');

// ---- MIME ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const PUBLIC_STATIC_EXTENSIONS = new Set([
  '.mjs', '.js', '.css', '.svg', '.ico', '.png',
  '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf',
]);

// /render 下目录、无扩展路由和 HTML 都是页面入口；只豁免明确的静态资源。
export function requiresPageToken(urlPath) {
  if (urlPath === '/' || urlPath === '/render') return true;
  if (!urlPath.startsWith('/render/')) return false;
  const ext = path.posix.extname(urlPath).toLowerCase();
  return !PUBLIC_STATIC_EXTENSIONS.has(ext);
}

// ---- helpers ----
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workbench-Token');
}

function noReferrer(res) {
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// token 先归一成固定长度摘要，再做恒定时序比较，避免长度与前缀泄漏。
export function safeTokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const digest = (value) => createHash('sha256')
    .update(value)
    .digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

// 原始 body（Buffer）——代理透传用，不解析
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function parseQuery(reqUrl) {
  const u = new URL(reqUrl, 'http://localhost');
  return Object.fromEntries(u.searchParams.entries());
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(buf || 'null')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Feedback → human-readable markdown
function feedbackToMd(fb) {
  const lines = [
    `# Feedback — session ${fb.session} round ${fb.round}`,
    `Submitted: ${fb.submittedAt}`,
    '',
  ];
  if (fb.summary) lines.push(`**Summary:** ${fb.summary}`, '');
  // 会话级留言（P1）：不针对任何块的自由发言，置顶（AI 续跑时最该先看）
  if (fb.sessionComment) lines.push('## 💬 会话级留言（不针对具体块）', '', fb.sessionComment, '');
  if (Array.isArray(fb.unanswered) && fb.unanswered.length) {
    lines.push(`**未表态（没看/未操作）:** ${fb.unanswered.join(', ')}`, '');
  }
  for (const it of fb.items || []) {
    lines.push(`## Block: ${it.blockId}`);
    if (it.type) lines.push(`- type: ${it.type}`);
    if (it.value != null) lines.push(`- value: ${JSON.stringify(it.value)}`);
    if (it.comment) lines.push(`- comment: ${it.comment}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---- embed proxy helpers ----

/**
 * Rewrite fetched HTML for safe iframe embedding:
 * 1. Inject <base href="${targetUrl}"> at start of <head> (or document start if no head).
 * 2. Remove any <meta http-equiv="X-Frame-Options" ...> tags.
 * Pure function, exported for unit testing.
 */
export function rewriteEmbedHtml(html, targetUrl, selfOrigin = '', token = '') {
  // 1. 去掉阻止嵌入的 meta（X-Frame-Options / CSP）
  let result = html
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?X-Frame-Options["']?[^>]*\/?>/gi, '')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*\/?>/gi, '');

  const tokenPart = token ? `token=${encodeURIComponent(token)}&` : '';
  const proxyBase = `${selfOrigin}/api/proxy?${tokenPart}url=`;
  const toProxy = (u) => {
    try { return proxyBase + encodeURIComponent(new URL(u, targetUrl).href); }
    catch { return u; }
  };

  // 2. 表单 action 落回代理通道。
  //    关键：<base href> 会让相对 action 解析到原站 → 表单直接 POST 原站（跨源、丢 cookie/凭证字段）。
  //    改写成经 /api/proxy 转发，请求体与 Content-Type 才能完整到达目标。
  result = result.replace(/<form\b([^>]*)>/gi, (_tag, attrs) => {
    const m = attrs.match(/\saction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const action = m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
    const cleaned = m ? attrs.replace(m[0], '') : attrs;
    return `<form${cleaned} action="${toProxy(action || targetUrl)}">`;
  });

  // 3. base（静态资源仍直连原站）+ fetch/XHR 补丁（指向原站的请求改走代理）
  const patch = `<base href="${targetUrl}">
<script>(function(){
  var T=${JSON.stringify(targetUrl)}, P=${JSON.stringify(proxyBase)}, O;
  try{ O=new URL(T).origin; }catch(e){ return; }
  function px(u){ try{ var a=new URL(u,T); if(a.origin===O) return P+encodeURIComponent(a.href); }catch(e){} return u; }
  var f=window.fetch;
  if(f) window.fetch=function(i,init){
    try{ if(typeof i==='string') i=px(i); else if(i&&i.url) i=new Request(px(i.url),i); }catch(e){}
    return f.call(window,i,init);
  };
  var xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){ try{ arguments[1]=px(u); }catch(e){} return xo.apply(this,arguments); };
})();</script>`;

  const headMatch = result.match(/<head(?:\s[^>]*)?>/i);
  if (headMatch) {
    const headEnd = result.indexOf(headMatch[0]) + headMatch[0].length;
    result = result.slice(0, headEnd) + patch + result.slice(headEnd);
  } else {
    result = patch + result;
  }

  return result;
}

// ---- request handler ----
function handleRequest(req, res, expectedToken = '') {
  const method = req.method.toUpperCase();
  const rawUrl = req.url || '/';
  const requestUrl = new URL(rawUrl, 'http://localhost');
  const urlPath = requestUrl.pathname;

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // 页面入口即使最终 302/403/404，也不应把携 token 的来源 URL 发送给下一跳。
  if (requiresPageToken(urlPath)) noReferrer(res);

  // 开启 token 后，API 可用 header/query；页面入口只接受 query，便于浏览器继续透传。
  if (expectedToken) {
    const isApi = urlPath.startsWith('/api/');
    const isPageEntry = requiresPageToken(urlPath);
    const isSessionAsset = urlPath.startsWith('/assets/');
    if (isApi || isPageEntry || isSessionAsset) {
      const queryToken = requestUrl.searchParams.get('token');
      const headerToken = req.headers['x-workbench-token'];
      const candidates = isApi ? [headerToken, queryToken] : [queryToken];
      const allowed = candidates.some((candidate) => safeTokenEqual(candidate, expectedToken));
      if (!allowed) {
        if (isApi) json(res, 403, { ok: false, error: '访问被拒绝：令牌缺失或无效' });
        else {
          cors(res);
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('访问被拒绝：请在页面 URL 中提供有效令牌');
        }
        return;
      }
    }
  }

  // --- API routes ---
  if (urlPath === '/api/health') {
    json(res, 200, { ok: true, ts: Date.now() });
    return;
  }

  if (urlPath === '/api/sessions' && method === 'GET') {
    json(res, 200, { ok: true, sessions: listSessions() });
    return;
  }

  if (urlPath === '/api/status' && method === 'GET') {
    const { session } = parseQuery(rawUrl);
    const status = session ? readStatus(session) : null;
    if (!status) {
      json(res, 200, { ok: true, status: null, display: 'unknown' });
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
    json(res, 200, { ok: true, status: responseStatus, display, stale });
    return;
  }

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
    const prevBlocks = prevContent ? (prevContent.blocks || []) : [];
    const diffed = computeDiff(content.blocks || [], prevBlocks);
    const removed = removedBlocks(content.blocks || [], prevBlocks);
    const sanity = diffSanity(diffed, removed);

    // 改动 E + 改动 C（DESIGN §4）：注入 _respondedToPrev 与 _decidedInPrev
    // 读上一轮 feedback；null guard：缺失/第1轮/文件被删均安全跳过，绝不报错
    const prevFeedback = prevRound > 0 ? readJSON(paths.feedback(session, prevRound), null) : null;
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

  if (urlPath === '/api/feedback' && method === 'POST') {
    readBody(req).then((fb) => {
      if (!fb) { json(res, 400, { ok: false, error: 'body required' }); return; }
      const vr = validateFeedback(fb);
      if (!vr.ok) { json(res, 400, { ok: false, error: vr.errors.join('; ') }); return; }

      const { session, round } = fb;
      const st = readStatus(session);
      if (st && st.state === 'claimed') {
        json(res, 409, { ok: false, error: 'claimed' });
        return;
      }

      const now = new Date().toISOString();
      const saved = { ...fb, submittedAt: now };
      writeJSON(paths.feedback(session, round), saved);
      writeText(paths.feedbackMd(session, round), feedbackToMd(saved));
      writeStatus(session, { state: 'submitted', round, error: null });
      json(res, 200, { ok: true, count: (fb.items || []).length });
    }).catch((e) => {
      json(res, 400, { ok: false, error: 'invalid JSON: ' + e.message });
    });
    return;
  }

  // embed 代理：支持 GET/POST/PUT/DELETE（P0 · iteration-brief 2026-07-13）
  // 此前只认 GET → 被嵌页面内的表单 POST 无转发通道，字段丢失（实证 bug）。
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
          const html = rewriteEmbedHtml(await fr.text(), fr.url || targetUrl, selfOrigin, expectedToken);
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

  if (urlPath === '/api/retry' && method === 'POST') {
    const { session, round } = parseQuery(rawUrl);
    const r = parseInt(round, 10);
    if (!session || !Number.isInteger(r)) {
      json(res, 400, { ok: false, error: 'session and round required' });
      return;
    }
    removeFile(paths.ack(session, r));
    removeFile(paths.error(session, r));
    writeStatus(session, { state: 'submitted', error: null, round: r });
    json(res, 200, { ok: true });
    return;
  }

  // --- 会话资产：/assets/<session>/<path> → workspace/<session>/assets/<path> ---
  // 用途：session 自带的静态资源（如高保真 UI 设计稿 HTML），让工作台自托管，
  // 不再依赖外部服务（此前 prd-studio 的 :8088 必须开着才能看 UI 面）。
  if (method === 'GET' && urlPath.startsWith('/assets/')) {
    const rel = decodeURIComponent(urlPath.slice('/assets/'.length));
    const slash = rel.indexOf('/');
    const session = slash === -1 ? rel : rel.slice(0, slash);
    const sub = slash === -1 ? '' : rel.slice(slash + 1);
    // session 名白名单 + 子路径穿越防护
    if (!session || !sub || !/^[A-Za-z0-9._-]+$/.test(session)) {
      json(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const root = path.resolve(workspaceDir(), session, 'assets');
    const abs = path.resolve(root, sub);
    if (!abs.startsWith(root + path.sep)) {
      json(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    try {
      const buf = fs.readFileSync(abs);
      const ext = path.extname(abs).toLowerCase();
      cors(res);
      if (ext === '.html') noReferrer(res);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    } catch {
      json(res, 404, { ok: false, error: 'asset not found' });
    }
    return;
  }

  // --- Static files (src/ as root) ---
  if (method === 'GET') {
    // Redirect / → /render/index.html
    if (urlPath === '/') {
      cors(res);
      const tokenQuery = expectedToken ? `?token=${encodeURIComponent(expectedToken)}` : '';
      res.writeHead(302, { Location: `/render/index.html${tokenQuery}` });
      res.end();
      return;
    }

    // Resolve path within SRC_ROOT; prevent directory traversal
    const rel = decodeURIComponent(urlPath);
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
    // 本地开发工具：静态资源不缓存，避免改了代码浏览器仍用旧的（普通刷新即拿最新）
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store, must-revalidate' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Fallthrough: 404
  json(res, 404, { ok: false, error: 'not found' });
}

export function startServer(port, host = '127.0.0.1') {
  const listenHost = host || '127.0.0.1';
  const token = process.env.WORKBENCH_TOKEN || '';
  if (listenHost.toLowerCase() !== '127.0.0.1' && listenHost.toLowerCase() !== 'localhost' && !token) {
    throw new Error('拒绝监听非本机地址：请先设置 WORKBENCH_TOKEN 访问令牌');
  }
  const server = http.createServer((req, res) => handleRequest(req, res, token));
  const listenPort = port != null ? port : (parseInt(process.env.PORT, 10) || 8099);
  server.listen(listenPort, listenHost);
  return server;
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argPort = process.argv.includes('--port')
    ? parseInt(process.argv[process.argv.indexOf('--port') + 1], 10)
    : null;
  const host = process.argv.includes('--host')
    ? process.argv[process.argv.indexOf('--host') + 1]
    : '127.0.0.1';
  const port = argPort || parseInt(process.env.PORT, 10) || 8099;
  const server = startServer(port, host);
  server.once('listening', () => {
    console.log(`vibecoding workbench server listening on http://${host}:${server.address().port}`);
  });
}
