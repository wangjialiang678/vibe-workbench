// 零依赖 HTTP server（DESIGN §8 + §13）。ESM，node:http only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { computeDiff, removedBlocks, diffSanity } from '../protocol/diff.mjs';
import { validateContent, validateFeedback } from '../protocol/schema.mjs';
import {
  lintContent,
  formatLint,
  findIncompleteDecisions,
  formatIncompleteDecisions,
} from '../protocol/lint.mjs';
import { displayState } from '../protocol/status.mjs';
import { HEARTBEAT_STALE_MS } from '../protocol/constants.mjs';
import {
  DEFAULT_PARTICIPANTS_FILE,
  addParticipant,
  findParticipantByToken,
  listParticipants,
  revokeParticipant,
} from '../participants.mjs';
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
  listRounds,
  isValidSessionName,
  prepareRound,
  writeRound,
} from '../workspace.mjs';
import {
  appendAnswerEntry,
  appendAskEntry,
  appendStreamEntry,
  readStreamEntries,
} from '../stream.mjs';
import {
  DOCUMENT_BODY_LIMIT,
  listDocuments,
  publishDocument,
  readDocument,
} from '../documents.mjs';
import {
  executionContextForSession,
  projectCatalog,
  registeredProjectForSession,
  sessionExists,
  updateSessionMetadata,
} from '../projects.mjs';
import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  INBOX_PAYLOAD_LIMIT,
  claimInboxTask,
  completeInboxTask,
  enqueueInboxTask,
  listInboxTasks,
  renewInboxTask,
  resetExpiredInboxClaims,
} from '../executor-inbox.mjs';
import { createControlTowerService } from '../control-tower.mjs';
import { dispatchExecutorEvent, postWebhookEvent } from './notify.mjs';
import { matchRoute } from './routes/index.mjs';

export { postWebhookEvent };

// 静态页路由已迁至 routes/pages.mjs；保留下列实现锚点供历史源码回归测试定位：
// assetsVersion: assetsVersion()
// .replaceAll('__WB_ASSETS_V__', v)
// Clear-Site-Data
// process.env.WORKBENCH_TITLE

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 静态根 = src/ 目录 (即 __dirname 的父目录)
const SRC_ROOT = path.resolve(__dirname, '..');

// 前端资产版本（长寿命页自愈，DESIGN §6.6）：关键渲染资产的最新 mtime。
// 渲染页只就地换内容、从不重载 JS——老标签页会永远跑老代码（已修故障会"复发"）。
// 页面每 3s 轮询 /api/status 比对此版本，变了就整页自刷新（草稿在 localStorage，无损）。
const ASSET_VERSION_FILES = [
  'render/index.html', 'render/app.mjs', 'render/app.css', 'render/theme.css',
  'render/blocks.mjs', 'render/vendor/mermaid.min.js',
];
export function assetsVersion() {
  let latest = 0;
  for (const rel of ASSET_VERSION_FILES) {
    try {
      const t = fs.statSync(path.join(SRC_ROOT, rel)).mtimeMs;
      if (t > latest) latest = t;
    } catch { /* 允许个别文件缺省 */ }
  }
  return String(Math.round(latest));
}
const ROUND_BODY_LIMIT = 2 * 1024 * 1024;
const MESSAGE_BODY_LIMIT = 32 * 1024;
const ATTACHMENT_BODY_LIMIT = 5 * 1024 * 1024;
// JSON 控制字符最坏会膨胀为 \uXXXX（6 倍）；业务限额仍按解析后的正文 UTF-8 字节判断。
const DOCUMENT_REQUEST_LIMIT = (DOCUMENT_BODY_LIMIT * 6) + (64 * 1024);
const WORKER_HEARTBEAT_BODY_LIMIT = 8 * 1024;
const INBOX_REQUEST_LIMIT = (INBOX_PAYLOAD_LIMIT * 6) + (64 * 1024);
const UNCLASSIFIED_SESSION_WARNING = '未归属项目的新会话，建议先在项目下创建或使用规范命名';
export const WORKER_HEARTBEAT_STALE_MS = 90 * 1000;
const AI_IDENTITY = Object.freeze({ id: 'ai', name: 'AI', role: 'ai' });
const ATTACHMENT_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['application/pdf', '.pdf'],
  // 办公文档：客户评审场景常需回传 Excel/Word 原件（2026-08-20 思锐门户实际反馈）
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['text/csv', '.csv'],
]);

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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

const PUBLIC_STATIC_EXTENSIONS = new Set([
  '.mjs', '.js', '.css', '.svg', '.ico', '.png',
  '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf',
]);

// /render 下目录、无扩展路由和 HTML 都是页面入口；只豁免明确的静态资源。
export function requiresPageToken(urlPath) {
  if (urlPath === '/' || urlPath === '/render'
    || urlPath === '/control' || urlPath === '/control/' || urlPath === '/control/index.html') return true;
  if (!urlPath.startsWith('/render/')) return false;
  const ext = path.posix.extname(urlPath).toLowerCase();
  return !PUBLIC_STATIC_EXTENSIONS.has(ext);
}

function isControlPage(urlPath) {
  return urlPath === '/control' || urlPath === '/control/' || urlPath === '/control/index.html';
}

// ---- helpers ----
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workbench-Token, X-File-Name');
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

function readRawBodyLimited(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      const error = new Error('请求体超过大小上限');
      error.code = 'BODY_TOO_LARGE';
      req.resume();
      reject(error);
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        settled = true;
        const error = new Error('请求体超过大小上限');
        error.code = 'BODY_TOO_LARGE';
        req.resume();
        reject(error);
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
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

function readBody(req, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      const error = new Error('请求体超过 2 MB 上限');
      error.code = 'BODY_TOO_LARGE';
      req.resume();
      reject(error);
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        settled = true;
        const error = new Error('请求体超过 2 MB 上限');
        error.code = 'BODY_TOO_LARGE';
        req.resume();
        reject(error);
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks, size).toString('utf8');
      try { resolve(JSON.parse(raw || 'null')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function validRoundQuery(value) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) return null;
  const round = Number(value);
  return Number.isSafeInteger(round) ? round : null;
}

function validStreamText(value, maxLength = 4000) {
  return typeof value === 'string'
    && value.trim().length > 0
    && Array.from(value).length <= maxLength;
}

function safeUploadStem(value) {
  const raw = typeof value === 'string' ? value : 'file';
  const basename = path.posix.basename(raw.replaceAll('\\', '/'));
  const extension = path.posix.extname(basename);
  const stem = basename.slice(0, Math.max(0, basename.length - extension.length));
  return stem
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file';
}

function writeAttachment(session, originalName, extension, body) {
  const uploadsDir = path.resolve(workspaceDir(), session, 'assets', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const stem = safeUploadStem(originalName);
  let timestamp = Date.now();
  for (;;) {
    const filename = `${stem}-${timestamp}${extension}`;
    const target = path.join(uploadsDir, filename);
    try {
      fs.writeFileSync(target, body, { flag: 'wx' });
      return filename;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      timestamp += 1;
    }
  }
}

function assetUrl(session, relativePath) {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `/assets/${encodeURIComponent(session)}/${encodedPath}`;
}

function normalizeAssetSubpath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/')) return null;
  return normalized;
}

function readValidContentForVisibility(session, round) {
  const content = readJSON(paths.content(session, round, { exactSession: true }), null);
  return validateContent(content).ok
    && content.session === session
    && content.round === round
    ? content
    : null;
}

const ASSET_VISIBILITY_CACHE_LIMIT = 512;
const ASSET_INVENTORY_CACHE_LIMIT = 128;
const assetVisibilityCache = new Map();
const assetInventoryCache = new Map();

function fileVersion(target) {
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.mode].join(':');
  } catch (error) {
    return 'missing:' + (error?.code || 'unknown');
  }
}

function cachePut(cache, key, value, limit) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}

function assetInventoryCacheValid(cached) {
  return cached?.directories?.every(([directory, version]) => fileVersion(directory) === version)
    && cached?.fileVersions?.every(([relativePath, version]) => (
      fileVersion(path.join(cached.root, relativePath)) === version
    ));
}

function trimAssetCandidate(value) {
  let candidate = value;
  while (candidate && /[).,\]}]+$/.test(candidate)) candidate = candidate.slice(0, -1);
  return candidate;
}

// 只把完整的 http(s) URL 或字面量 /assets/ 绝对路径交给 URL 解析器。
// 这样外站 URL 中的 /assets/ 不会再被截成“本地引用”；相对路径和未知形式默认拒绝。
function assetUrlCandidates(value) {
  const candidates = [];
  for (let index = 0; index < value.length;) {
    const lower = value.slice(index, index + 8).toLowerCase();
    const isHttpUrl = lower.startsWith('http://') || lower.startsWith('https://');
    const isLocalPath = value.startsWith('/assets/', index);
    if (!isHttpUrl && !isLocalPath) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < value.length && !' \t\r\n"\'<>'.includes(value[end])) end += 1;
    const candidate = trimAssetCandidate(value.slice(index, end));
    if (candidate) candidates.push(candidate);
    index = Math.max(end, index + 1);
  }
  return candidates;
}

function assetPathFromCandidate(candidate, session, serviceOrigin) {
  const lower = candidate.slice(0, 8).toLowerCase();
  if (!candidate.startsWith('/assets/')
    && !lower.startsWith('http://')
    && !lower.startsWith('https://')) return null;
  try {
    const parsed = new URL(candidate, serviceOrigin);
    if (parsed.origin !== new URL(serviceOrigin).origin) return null;
    // Encoded /%61ssets 不是本服务的 /assets 路由，保持默认拒绝。
    if (!parsed.pathname.startsWith('/assets/')) return null;
    const rel = decodeURIComponent(parsed.pathname.slice('/assets/'.length));
    const slash = rel.indexOf('/');
    if (slash <= 0) return null;
    if (rel.slice(0, slash) !== session) return null;
    return normalizeAssetSubpath(rel.slice(slash + 1));
  } catch {
    return null;
  }
}

function collectAssetPaths(value, session, target, serviceOrigin) {
  if (typeof value === 'string') {
    for (const candidate of assetUrlCandidates(value)) {
      const normalized = assetPathFromCandidate(candidate, session, serviceOrigin);
      if (normalized) target.add(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssetPaths(item, session, target, serviceOrigin));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectAssetPaths(item, session, target, serviceOrigin));
  }
}

function selectedAssetRound(session, requestedRound) {
  if (requestedRound != null) return requestedRound;
  const rounds = listRounds(session, { exactSession: true });
  return rounds.length ? rounds[rounds.length - 1] : 0;
}

function visibleAssetPathsForIdentity(session, identity, requestedRound = null, serviceOrigin = 'http://localhost') {
  if (identity?.role !== 'participant') return null;

  const round = selectedAssetRound(session, requestedRound);
  if (!round) return new Set();
  const contentPath = paths.content(session, round, { exactSession: true });
  const version = fileVersion(contentPath);
  let origin;
  try { origin = new URL(serviceOrigin).origin; }
  catch { return new Set(); }
  const cacheKey = [session, identity.id || '', round, origin].join('\0');
  const cached = assetVisibilityCache.get(cacheKey);
  if (cached?.version === version) return cached.paths;

  const allowed = new Set();
  const content = readValidContentForVisibility(session, round);
  if (Array.isArray(content?.blocks)) {
    // 资产没有 round 字段；默认只绑定最新轮，显式 round 则只绑定被请求的那一轮，
    // 不把历史轮次并集当成当前文件的永久读取权，避免路径复用后的陈旧授权。
    for (const block of visibleBlocksForIdentity(content.blocks, identity)) {
      collectAssetPaths(block, session, allowed, origin);
    }
  }
  return cachePut(
    assetVisibilityCache,
    cacheKey,
    { version, paths: allowed },
    ASSET_VISIBILITY_CACHE_LIMIT,
  ).paths;
}

function listSessionAssets(session, allowedPaths = null) {
  const root = path.resolve(workspaceDir(), session, 'assets');
  const version = fileVersion(root);
  const cached = assetInventoryCache.get(root);
  if (cached?.version === version && assetInventoryCacheValid(cached)) {
    return allowedPaths
      ? cached.files.filter((file) => allowedPaths.has(file.path))
      : cached.files;
  }
  const files = [];
  const directories = new Map();

  function walk(directory, relativeDirectory = '') {
    directories.set(directory, fileVersion(directory));
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const entry of entries) {
      // 不跟随软链接，避免资产索引越出会话目录。
      if (entry.isSymbolicLink()) continue;
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const stat = fs.lstatSync(absolutePath);
        if (!stat.isFile()) continue;
        files.push({
          path: relativePath,
          url: assetUrl(session, relativePath),
          size: stat.size,
        });
      }
    }
  }

  try {
    const rootStat = fs.lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return [];
    walk(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const cachedFiles = cachePut(
    assetInventoryCache,
    root,
    {
      root,
      version,
      files,
      directories: [...directories.entries()],
      fileVersions: files.map((file) => [
        file.path,
        fileVersion(path.join(root, file.path)),
      ]),
    },
    ASSET_INVENTORY_CACHE_LIMIT,
  ).files;
  return allowedPaths ? cachedFiles.filter((file) => allowedPaths.has(file.path)) : cachedFiles;
}

function assertNoSymlinkComponents(root, relativePath) {
  const workspaceRoot = path.resolve(workspaceDir());
  const rootRelative = path.relative(workspaceRoot, root);
  let current = workspaceRoot;
  for (const component of rootRelative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      const error = new Error('asset path contains a symbolic link');
      error.code = 'ASSET_FORBIDDEN';
      throw error;
    }
    if (!stat.isDirectory()) {
      const error = new Error('asset path component is not a directory');
      error.code = 'ENOTDIR';
      throw error;
    }
  }
  const parts = relativePath.split('/');
  for (const [index, component] of parts.entries()) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      const error = new Error('asset path contains a symbolic link');
      error.code = 'ASSET_FORBIDDEN';
      throw error;
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      const error = new Error('asset path component is not a directory');
      error.code = 'ENOTDIR';
      throw error;
    }
  }
}

function readAssetFile(root, normalizedSub) {
  const workspaceRoot = fs.realpathSync(workspaceDir());
  const realRoot = fs.realpathSync(root);
  if (!realRoot.startsWith(workspaceRoot + path.sep)) {
    const error = new Error('asset root outside workspace');
    error.code = 'ASSET_FORBIDDEN';
    throw error;
  }
  assertNoSymlinkComponents(root, normalizedSub);

  const abs = path.resolve(root, normalizedSub);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd;
  try {
    // lstat 逐个组件拒绝中间 symlink，O_NOFOLLOW 再拒绝最终组件；校验和读取都基于同一 fd。
    fd = fs.openSync(abs, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      const error = new Error('asset is not a regular file');
      error.code = 'ASSET_NOT_FILE';
      throw error;
    }
    return fs.readFileSync(fd);
  } catch (error) {
    if (error?.code === 'ELOOP') error.code = 'ASSET_FORBIDDEN';
    throw error;
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = /^https?$/i.test(forwardedProto)
    ? forwardedProto.toLowerCase()
    : (req.socket.encrypted ? 'https' : 'http');
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.headers.host || '127.0.0.1';
  return `${protocol}://${host}`;
}

function assetServiceOrigin(req) {
  const protocol = req.socket.encrypted ? 'https' : 'http';
  const address = req.socket.localAddress || '127.0.0.1';
  const host = address.includes(':') && !address.startsWith('[')
    ? '[' + address + ']'
    : address;
  return protocol + '://' + host + (req.socket.localPort ? ':' + req.socket.localPort : '');
}

function renderUrl(req, session) {
  let target;
  try {
    target = new URL('/render/', requestOrigin(req));
  } catch {
    // Host/转发头异常不能把已成功落盘的轮次变成 500。
    target = new URL('/render/', 'http://127.0.0.1');
  }
  target.searchParams.set('session', session);
  return target.href;
}

const OWNER_IDENTITY = Object.freeze({ id: 'owner', name: '管理员', role: 'owner' });
const TERMINAL_OR_PROCESSING_STATES = new Set(['claimed', 'responded', 'error']);
let feedbackHistorySeq = 0; // 同毫秒双提交的历史件文件名防碰撞

// block.assignee 是通用的责任人 ID：未设置/null/空串表示公共块。
export function isBlockVisibleTo(block, identity) {
  if (identity?.role !== 'participant') return true;
  return block?.assignee == null || block.assignee === '' || block.assignee === identity.id;
}

export function visibleBlocksForIdentity(blocks, identity) {
  return Array.isArray(blocks) ? blocks.filter((block) => isBlockVisibleTo(block, identity)) : [];
}

function feedbackVisibilityForIdentity(session, round, identity) {
  if (identity?.role !== 'participant') return { role: 'owner' };
  const content = readValidContentForVisibility(session, round);
  if (!Array.isArray(content?.blocks)) return { role: 'participant', valid: false };
  const knownBlockIds = new Set(
    content.blocks.map((block) => block?.id).filter((id) => typeof id === 'string'),
  );
  const visibleBlockIds = new Set(
    visibleBlocksForIdentity(content.blocks, identity)
      .map((block) => block?.id)
      .filter((id) => typeof id === 'string'),
  );
  return { role: 'participant', valid: true, knownBlockIds, visibleBlockIds };
}

function filterFeedbackForIdentity(feedback, visibility) {
  if (!feedback || visibility?.role !== 'participant') return feedback;
  if (!visibility.valid || !Array.isArray(feedback.items)
    || (feedback.unanswered != null && !Array.isArray(feedback.unanswered))) return null;
  return {
    ...feedback,
    items: feedback.items.filter((item) => visibility.visibleBlockIds.has(item?.blockId)),
    ...(Array.isArray(feedback.unanswered)
      ? { unanswered: feedback.unanswered.filter((blockId) => visibility.visibleBlockIds.has(blockId)) }
      : {}),
  };
}

function streamBlockRefVisible(session, refs, identity) {
  if (identity?.role !== 'participant') return true;
  if (!refs || typeof refs.blockId !== 'string') return true;
  const round = validRoundQuery(refs.round);
  if (round == null) return false;
  const content = readValidContentForVisibility(session, round);
  if (!Array.isArray(content?.blocks)) return false;
  const block = content.blocks.find((candidate) => candidate?.id === refs.blockId);
  return Boolean(block && isBlockVisibleTo(block, identity));
}

function stripHiddenStreamBlockRef(entry) {
  const safeRefs = { ...entry.refs };
  delete safeRefs.blockId;
  if (Object.keys(safeRefs).length) return { ...entry, refs: safeRefs };
  const { refs: _refs, ...withoutRefs } = entry;
  return withoutRefs;
}

function filterStreamEntriesForIdentity(session, entries, allEntries, identity) {
  if (identity?.role !== 'participant') return entries;

  const hiddenAskIds = new Set(
    allEntries
      .filter((entry) => entry.kind === 'ask'
        && entry.refs?.blockId
        && !streamBlockRefVisible(session, entry.refs, identity))
      .map((entry) => entry.ask?.id)
      .filter(Boolean),
  );
  return entries.flatMap((entry) => {
    if (entry.kind === 'ask' && hiddenAskIds.has(entry.ask?.id)) return [];
    if (entry.kind === 'answer' && hiddenAskIds.has(entry.answerTo)) return [];
    if (!entry.refs?.blockId || streamBlockRefVisible(session, entry.refs, identity)) return [entry];
    if (['message', 'progress', 'receipt'].includes(entry.kind)) return [];
    return [stripHiddenStreamBlockRef(entry)];
  });
}

function assertParticipantCanAnswerAsk(session, answerTo, identity) {
  if (identity?.role !== 'participant' || typeof answerTo !== 'string') return;
  const entries = readStreamEntries(session, {
    limit: Number.MAX_SAFE_INTEGER,
    exactSession: true,
  });
  const ask = entries.find((entry) => entry.kind === 'ask' && entry.ask?.id === answerTo);
  if (ask?.refs?.blockId && !streamBlockRefVisible(session, ask.refs, identity)) {
    const error = new Error('该 ask 关联的 block 对当前参与者不可见');
    error.code = 'ASK_NOT_VISIBLE';
    throw error;
  }
}

function requestTokens(req, requestUrl, isApi) {
  const queryToken = requestUrl.searchParams.get('token');
  const headerToken = req.headers['x-workbench-token'];
  return (isApi ? [headerToken, queryToken] : [queryToken])
    .filter((token) => typeof token === 'string' && token);
}

// 管理员口令优先；参与者 token 每次请求都重新查名册，吊销可立即生效。
function resolveRequestIdentity(tokens, expectedToken, participantsFile) {
  for (const token of tokens) {
    if (safeTokenEqual(token, expectedToken)) return { identity: OWNER_IDENTITY, token };
  }
  for (const token of tokens) {
    const participant = findParticipantByToken(token, { filePath: participantsFile });
    if (participant) return { identity: { ...participant, role: 'participant' }, token };
  }
  // 未开启口令门时保持原有本地流程：无身份请求按 owner 落兼容文件。
  return expectedToken ? null : { identity: OWNER_IDENTITY, token: '' };
}

function publicParticipant(participant) {
  const { id, name, createdAt } = participant;
  return { id, name, createdAt };
}

function acceptedSelfReport(value, identity, participantsFile) {
  // participant 的实名 token 已经给出可信身份；客户端夹带的自报字段一律忽略。
  if (identity?.role !== 'owner' || value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.name !== 'string'
    || !value.name.trim()
    || [...value.name].length > 40) {
    const error = new Error('selfReport.name 必填且须为 1~40 个字符');
    error.code = 'INVALID_SELF_REPORT';
    throw error;
  }
  const accepted = { name: value.name };
  if (typeof value.id === 'string') {
    const known = listParticipants(participantsFile).some((participant) => participant.id === value.id);
    if (known) accepted.id = value.id;
  }
  return accepted;
}

function selfReportSlug(name) {
  const slug = String(name || '')
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return slug || '-';
}

function sharedDisplayName(selfReportedBy) {
  return selfReportedBy ? `${selfReportedBy.name}（共享链接）` : '';
}

function workerPresence(runtimeState, now = Date.now()) {
  const heartbeat = runtimeState.workerHeartbeat;
  const at = heartbeat?.at ? Date.parse(heartbeat.at) : NaN;
  const age = now - at;
  return {
    workerOnline: Number.isFinite(at) && age >= 0 && age < WORKER_HEARTBEAT_STALE_MS,
    workerLabel: heartbeat?.label || null,
  };
}

function participantInviteUrl(req, token) {
  const target = new URL('/render/', requestOrigin(req));
  target.searchParams.set('token', token);
  return target.href;
}

function participantFeedbackEntries(session, round) {
  const dir = path.dirname(paths.feedback(session, round, { exactSession: true }));
  let filenames;
  try {
    filenames = fs.readdirSync(dir).filter((name) => /^feedback-[A-Za-z0-9_-]+\.json$/.test(name)).sort();
  } catch {
    return [];
  }
  return filenames.flatMap((filename) => {
    const feedback = readJSON(path.join(dir, filename), null);
    const id = feedback?.submittedBy?.id;
    const name = feedback?.submittedBy?.name;
    if (!feedback || typeof id !== 'string' || typeof name !== 'string') return [];
    return [{ id, name, submittedAt: feedback.submittedAt ?? null, feedback }];
  });
}

function conflictValue(values) {
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique.length === 1 ? unique[0] : unique;
}

function detectFeedbackConflicts(ownerFeedback, byParticipant) {
  const sources = [];
  if (ownerFeedback) sources.push({ name: ownerFeedback.submittedBy?.name || '管理员', feedback: ownerFeedback });
  for (const entry of byParticipant) sources.push({ name: entry.name, feedback: entry.feedback });

  const byBlock = new Map();
  for (const source of sources) {
    const selected = new Map();
    for (const item of source.feedback?.items || []) {
      if (item?.type !== 'select' || typeof item.blockId !== 'string') continue;
      const values = selected.get(item.blockId) || [];
      values.push(item.value);
      selected.set(item.blockId, values);
    }
    for (const [blockId, values] of selected) {
      const choices = byBlock.get(blockId) || [];
      choices.push({ participant: source.name, value: conflictValue(values) });
      byBlock.set(blockId, choices);
    }
  }

  const conflicts = [];
  for (const [blockId, choices] of byBlock) {
    const distinct = new Set(choices.map(({ value }) => JSON.stringify(value)));
    if (choices.length > 1 && distinct.size > 1) conflicts.push({ blockId, choices });
  }
  return conflicts;
}

function feedbackView(session, round, identity = OWNER_IDENTITY) {
  const visibility = feedbackVisibilityForIdentity(session, round, identity);
  const primary = filterFeedbackForIdentity(
    readJSON(paths.feedback(session, round, { exactSession: true }), null),
    visibility,
  );
  const byParticipant = participantFeedbackEntries(session, round).map((entry) => ({
    ...entry,
    feedback: filterFeedbackForIdentity(entry.feedback, visibility),
  }));
  // 无 submittedBy 的旧反馈视为 owner；参与者兼容桥不重复算作 owner。
  const ownerFeedback = primary && (!primary.submittedBy || primary.submittedBy.id === 'owner')
    ? primary
    : null;
  const primaryParticipant = primary?.submittedBy?.id
    ? byParticipant.find((entry) => entry.id === primary.submittedBy.id)?.feedback
    : null;
  const feedback = ownerFeedback || primaryParticipant || byParticipant[0]?.feedback || primary;
  return {
    feedback,
    byParticipant,
    conflicts: detectFeedbackConflicts(ownerFeedback, byParticipant),
  };
}

function configuredClaimTimeoutMs(value) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) return DEFAULT_CLAIM_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_CLAIM_TIMEOUT_MS;
}

function inboxSweepIntervalMs(claimTimeoutMs) {
  return Math.max(10, Math.min(60 * 1000, Math.floor(claimTimeoutMs / 2)));
}

function inboxErrorStatus(error) {
  if (error?.code === 'INBOX_PAYLOAD_TOO_LARGE') return 413;
  if (error?.code === 'INVALID_INBOX_TASK') return 400;
  if (error?.code === 'INBOX_NOT_FOUND') return 404;
  if (error?.code === 'INBOX_CONFLICT') return 409;
  return 500;
}

function respondInboxError(res, error, action) {
  const status = inboxErrorStatus(error);
  if (status === 500) {
    console.error(`[workbench:inbox] ${action}失败：`, error);
  }
  json(res, status, {
    ok: false,
    error: status === 500 ? `收件箱${action}失败` : error.message,
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

export {
  AI_IDENTITY,
  ATTACHMENT_BODY_LIMIT,
  ATTACHMENT_TYPES,
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_PARTICIPANTS_FILE,
  DOCUMENT_BODY_LIMIT,
  DOCUMENT_REQUEST_LIMIT,
  HEARTBEAT_STALE_MS,
  INBOX_PAYLOAD_LIMIT,
  INBOX_REQUEST_LIMIT,
  MESSAGE_BODY_LIMIT,
  MIME,
  OWNER_IDENTITY,
  PUBLIC_STATIC_EXTENSIONS,
  ROUND_BODY_LIMIT,
  SRC_ROOT,
  TERMINAL_OR_PROCESSING_STATES,
  UNCLASSIFIED_SESSION_WARNING,
  WORKER_HEARTBEAT_BODY_LIMIT,
  acceptedSelfReport,
  addParticipant,
  appendAnswerEntry,
  appendAskEntry,
  appendStreamEntry,
  assertParticipantCanAnswerAsk,
  assetServiceOrigin,
  claimInboxTask,
  completeInboxTask,
  computeDiff,
  diffSanity,
  dispatchExecutorEvent,
  displayState,
  enqueueInboxTask,
  executionContextForSession,
  exists,
  feedbackToMd,
  feedbackView,
  feedbackVisibilityForIdentity,
  filterFeedbackForIdentity,
  filterStreamEntriesForIdentity,
  findIncompleteDecisions,
  findParticipantByToken,
  formatIncompleteDecisions,
  formatLint,
  fs,
  isControlPage,
  isValidSessionName,
  lintContent,
  listDocuments,
  listInboxTasks,
  listParticipants,
  listRounds,
  listSessionAssets,
  listSessions,
  normalizeAssetSubpath,
  participantFeedbackEntries,
  participantInviteUrl,
  path,
  paths,
  prepareRound,
  projectCatalog,
  publicParticipant,
  publishDocument,
  readAssetFile,
  readDocument,
  readJSON,
  readStatus,
  readStreamEntries,
  registeredProjectForSession,
  removeFile,
  removedBlocks,
  renderUrl,
  renewInboxTask,
  requestTokens,
  resetExpiredInboxClaims,
  resolveRequestIdentity,
  respondInboxError,
  revokeParticipant,
  selfReportSlug,
  sessionExists,
  sharedDisplayName,
  updateSessionMetadata,
  validRoundQuery,
  validStreamText,
  validateContent,
  validateFeedback,
  visibleAssetPathsForIdentity,
  workerPresence,
  workspaceDir,
  writeAttachment,
  writeJSON,
  writeRound,
  writeStatus,
  writeText,
};
// ---- request handler ----
function handleRequest(
  req,
  res,
  expectedToken = '',
  eventWebhook = '',
  participantsFile = DEFAULT_PARTICIPANTS_FILE,
  runtimeState = { workerHeartbeat: null },
) {
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
  const isApi = urlPath.startsWith('/api/');
  const isPageEntry = requiresPageToken(urlPath);
  const isSessionAsset = urlPath.startsWith('/assets/');
  const protectedRequest = isApi || isPageEntry || isSessionAsset;
  let auth;
  try {
    auth = resolveRequestIdentity(requestTokens(req, requestUrl, isApi), expectedToken, participantsFile);
  } catch (error) {
    console.error('[workbench:participants] 名册读取失败：', error.message);
    if (isApi) json(res, 500, { ok: false, error: '参与者名册无法读取，请联系管理员' });
    else {
      cors(res);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('参与者名册无法读取，请联系管理员');
    }
    return;
  }
  if (expectedToken && protectedRequest && !auth) {
    if (isApi) json(res, 403, { ok: false, error: '访问被拒绝：令牌缺失或无效' });
    else {
      cors(res);
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('访问被拒绝：请在页面 URL 中提供有效令牌');
    }
    return;
  }
  const identity = auth?.identity || OWNER_IDENTITY;
  const requestToken = auth?.token || '';
  req.identity = identity;

  // 控制塔是创始人驾驶舱：即使参与者通过了工作台通用鉴权，也不能查看跨项目审计数据。
  if (isControlPage(urlPath) && (!expectedToken || identity.role !== 'owner')) {
    cors(res);
    noReferrer(res);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('访问被拒绝：控制塔仅限管理员');
    return;
  }

  const ctx = {
    req, res, method, rawUrl, requestUrl, urlPath, identity, requestToken,
    expectedToken, eventWebhook, participantsFile, runtimeState,
    json, readBody, readRawBody, readRawBodyLimited, parseQuery, cors, noReferrer,
  };
  const route = matchRoute(method, urlPath);
  if (route) {
    const handled = route.handler(ctx);
    if (handled === false && !res.writableEnded) {
      json(res, 404, { ok: false, error: 'not found' });
    }
    return;
  }
  json(res, 404, { ok: false, error: 'not found' });
}
export function startServer(port, host = '127.0.0.1', { participantsFile = DEFAULT_PARTICIPANTS_FILE } = {}) {
  const listenHost = host || '127.0.0.1';
  const token = process.env.WORKBENCH_TOKEN || '';
  const eventWebhook = process.env.WORKBENCH_EVENT_WEBHOOK || '';
  const inboxClaimTimeoutMs = configuredClaimTimeoutMs(
    process.env.WORKBENCH_INBOX_CLAIM_TIMEOUT_MS,
  );
  const runtimeState = { workerHeartbeat: null, inboxClaimTimeoutMs };
  runtimeState.controlTowerService = createControlTowerService({ runtimeState });
  if (listenHost.toLowerCase() !== '127.0.0.1' && listenHost.toLowerCase() !== 'localhost' && !token) {
    throw new Error('拒绝监听非本机地址：请先设置 WORKBENCH_TOKEN 访问令牌');
  }
  const server = http.createServer((req, res) => handleRequest(
    req,
    res,
    token,
    eventWebhook,
    participantsFile,
    runtimeState,
  ));
  const inboxTimer = setInterval(() => {
    try {
      const reset = resetExpiredInboxClaims({ claimTimeoutMs: inboxClaimTimeoutMs });
      if (reset > 0) console.error(`[workbench:inbox] 已回退 ${reset} 个超时租约`);
    } catch (error) {
      console.error('[workbench:inbox] 超时租约扫描失败：', error.message);
    }
  }, inboxSweepIntervalMs(inboxClaimTimeoutMs));
  inboxTimer.unref?.();
  server.once('close', () => clearInterval(inboxTimer));
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
