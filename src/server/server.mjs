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
  DEFAULT_EXECUTOR_ID,
  executionContextForSession,
  executorById,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 静态根 = src/ 目录 (即 __dirname 的父目录)
const SRC_ROOT = path.resolve(__dirname, '..');

// 前端资产版本（长寿命页自愈，DESIGN §6.6）：关键渲染资产的最新 mtime。
// 渲染页只就地换内容、从不重载 JS——老标签页会永远跑老代码（已修故障会"复发"）。
// 页面每 3s 轮询 /api/status 比对此版本，变了就整页自刷新（草稿在 localStorage，无损）。
const ASSET_VERSION_FILES = [
  'render/index.html', 'render/app.mjs', 'render/app.css',
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
const WEBHOOK_TIMEOUT_MS = 5000;
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
  if (urlPath === '/' || urlPath === '/render') return true;
  if (!urlPath.startsWith('/render/')) return false;
  const ext = path.posix.extname(urlPath).toLowerCase();
  return !PUBLIC_STATIC_EXTENSIONS.has(ext);
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

/** 可选事件投递：任何失败都在此吞掉，调用方只需 fire-and-forget。 */
export async function postWebhookEvent(webhookUrl, payload, {
  fetchImpl = fetch,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
  logger = console,
} = {}) {
  if (!webhookUrl) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error(`HTTP ${response.status}`);
    }
    await response.body?.cancel?.();
  } catch (error) {
    logger.error('[workbench:webhook] 事件投递失败：', error?.message || String(error));
  } finally {
    clearTimeout(timer);
  }
}

function emitWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  setImmediate(() => { void postWebhookEvent(webhookUrl, payload); });
}

function configuredClaimTimeoutMs(value) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) return DEFAULT_CLAIM_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_CLAIM_TIMEOUT_MS;
}

function inboxSweepIntervalMs(claimTimeoutMs) {
  return Math.max(10, Math.min(60 * 1000, Math.floor(claimTimeoutMs / 2)));
}

function inboxTaskTitle(payload) {
  if (payload.event === 'round-presented') {
    return payload.title
      ? `第 ${payload.round} 轮已呈现：${payload.title}`
      : `第 ${payload.round} 轮已呈现`;
  }
  if (payload.event === 'feedback-submitted') return `第 ${payload.round} 轮反馈已提交`;
  if (payload.event === 'message-posted') return '会话新消息';
  return `会话事件：${payload.event || 'unknown'}`;
}

// resident 保持既有 webhook；pull 落本地持久化收件箱。路由异常一律回退云端链路。
function dispatchExecutorEvent(webhookUrl, payload) {
  let executor;
  try {
    const project = registeredProjectForSession(payload.session);
    executor = executorById(project?.executor || DEFAULT_EXECUTOR_ID);
  } catch (error) {
    console.error('[workbench:dispatch] 执行面解析失败，回退 resident webhook：', error.message);
    emitWebhook(webhookUrl, payload);
    return;
  }

  if (!executor || executor.kind === 'resident') {
    emitWebhook(webhookUrl, payload);
    return;
  }

  try {
    const task = enqueueInboxTask({
      executor: executor.id,
      session: payload.session,
      type: payload.event,
      title: inboxTaskTitle(payload),
      payload,
    });
    appendStreamEntry(payload.session, {
      author: AI_IDENTITY,
      kind: 'progress',
      text: `已入队待本地执行：${task.title}`,
    }, { exactSession: true });
    console.error('[workbench:dispatch] pull 任务已入队：', {
      id: task.id,
      executor: task.executor,
      session: task.session,
      type: task.type,
    });
  } catch (error) {
    console.error('[workbench:dispatch] pull 任务入队失败：', {
      session: payload.session,
      event: payload.event,
      error: error.message,
    });
  }
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

  // --- API routes ---
  if (urlPath === '/api/health') {
    json(res, 200, { ok: true, ts: Date.now() });
    return;
  }

  if (urlPath.startsWith('/api/inbox/')) {
    // 拉取执行器必须显式持有管理员口令；本地无口令的兼容 owner 不获得队列权限。
    if (!expectedToken || identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员执行器可访问收件箱' });
      return;
    }
    const inboxOptions = { claimTimeoutMs: runtimeState.inboxClaimTimeoutMs };

    if (urlPath === '/api/inbox/tasks' && method === 'GET') {
      const executor = requestUrl.searchParams.get('executor');
      const status = requestUrl.searchParams.has('status')
        ? requestUrl.searchParams.get('status')
        : undefined;
      try {
        const tasks = listInboxTasks({ executor, status, ...inboxOptions });
        json(res, 200, { ok: true, tasks });
      } catch (error) {
        respondInboxError(res, error, '列表读取');
      }
      return;
    }

    if (urlPath === '/api/inbox/tasks' && method === 'POST') {
      readBody(req, INBOX_REQUEST_LIMIT).then((body) => {
        try {
          const task = enqueueInboxTask(body);
          console.error('[workbench:inbox] 任务入队：', {
            id: task.id,
            executor: task.executor,
            session: task.session,
            type: task.type,
          });
          json(res, 201, { ok: true, task });
        } catch (error) {
          respondInboxError(res, error, '入队');
        }
      }).catch((error) => {
        if (error?.code === 'BODY_TOO_LARGE') {
          json(res, 413, { ok: false, error: '收件箱请求体过大' });
          return;
        }
        json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
      });
      return;
    }

    const taskAction = urlPath.match(
      /^\/api\/inbox\/tasks\/([^/]+)\/(claim|renew|complete)$/,
    );
    if (taskAction && method === 'POST') {
      const [, id, action] = taskAction;
      readBody(req, MESSAGE_BODY_LIMIT).then((body) => {
        try {
          if (action === 'claim') {
            const task = claimInboxTask(id, body?.claimedBy, inboxOptions);
            console.error('[workbench:inbox] 租约已领取：', {
              id: task.id,
              claimedBy: task.claimedBy,
              leaseExpiresAt: task.leaseExpiresAt,
            });
            json(res, 200, { ok: true, task });
            return;
          }
          if (action === 'renew') {
            const task = renewInboxTask(id, body?.claimedBy, inboxOptions);
            console.error('[workbench:inbox] 租约已续期：', {
              id: task.id,
              claimedBy: task.claimedBy,
              leaseExpiresAt: task.leaseExpiresAt,
            });
            json(res, 200, { ok: true, task });
            return;
          }

          const completed = completeInboxTask(id, body, inboxOptions);
          if (!completed.idempotent) {
            appendStreamEntry(completed.task.session, {
              author: AI_IDENTITY,
              kind: completed.task.result.ok ? 'receipt' : 'message',
              text: completed.task.result.ok
                ? `任务执行完成：${completed.task.result.summary}`
                : `任务执行失败：${completed.task.result.summary}`,
            }, { exactSession: true });
            console.error('[workbench:inbox] 任务已完成：', {
              id: completed.task.id,
              status: completed.task.status,
              session: completed.task.session,
            });
          }
          json(res, 200, {
            ok: true,
            task: completed.task,
            idempotent: completed.idempotent,
          });
        } catch (error) {
          respondInboxError(res, error, action);
        }
      }).catch((error) => {
        if (error?.code === 'BODY_TOO_LARGE') {
          json(res, 413, { ok: false, error: '收件箱请求体过大' });
          return;
        }
        json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
      });
      return;
    }

    json(res, taskAction ? 405 : 404, {
      ok: false,
      error: taskAction ? 'method not allowed' : 'not found',
    });
    return;
  }

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
        console.error('[workbench:documents] 文档写入成功：', {
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

  if (urlPath === '/api/messages' && method === 'GET') {
    const { session, since } = parseQuery(rawUrl);
    if (!isValidSessionName(session)) {
      json(res, 400, { ok: false, error: 'session 参数无效' });
      return;
    }
    try {
      const entries = readStreamEntries(session, {
        ...(since ? { since } : {}),
        exactSession: true,
      });
      const allEntries = identity.role === 'participant'
        ? readStreamEntries(session, { limit: Number.MAX_SAFE_INTEGER, exactSession: true })
        : entries;
      const visibleEntries = filterStreamEntriesForIdentity(session, entries, allEntries, identity);
      // 前端需要服务端确认的身份来判断消息左右分侧；只返回公开身份字段，不暴露 token。
      json(res, 200, {
        ok: true,
        identity: { id: identity.id, name: identity.name, role: identity.role },
        entries: visibleEntries,
      });
    } catch (error) {
      console.error('[workbench:messages] 读取失败：', error.message);
      json(res, 500, { ok: false, error: '会话消息读取失败' });
    }
    return;
  }

  // D8 拍板语义：参与者与管理员随时可发消息（不受轮次状态限制，'提交不再是终局'）
  if (urlPath === '/api/messages' && method === 'POST') {
    readBody(req, MESSAGE_BODY_LIMIT).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        json(res, 400, { ok: false, error: '请求体必须是消息对象' });
        return;
      }
      if (!isValidSessionName(body.session)) {
        json(res, 400, { ok: false, error: 'session 参数无效' });
        return;
      }
      const isAnswer = body.answerTo != null || body.answerValue != null;
      if (!isAnswer && !validStreamText(body.text)) {
        json(res, 400, { ok: false, error: 'text 必须非空且不超过 4000 字' });
        return;
      }
      try {
        if (isAnswer) assertParticipantCanAnswerAsk(body.session, body.answerTo, identity);
        const entry = isAnswer
          ? appendAnswerEntry(body.session, {
              author: identity,
              answerTo: body.answerTo,
              answerValue: body.answerValue,
            }, { exactSession: true })
          : appendStreamEntry(body.session, {
              author: identity,
              kind: 'message',
              text: body.text,
            }, { exactSession: true });
        json(res, 200, { ok: true, entry });
        dispatchExecutorEvent(eventWebhook, {
          event: 'message-posted',
          session: body.session,
          id: entry.id,
          kind: entry.kind,
          author: entry.author,
          at: entry.at,
        });
      } catch (error) {
        if (isAnswer) {
          const status = error?.code === 'ASK_ALREADY_ANSWERED'
            ? 409
            : error?.code === 'ASK_NOT_VISIBLE' ? 403 : 400;
          json(res, status, { ok: false, error: error.message });
          return;
        }
        console.error('[workbench:messages] 写入失败：', error.message);
        json(res, 500, { ok: false, error: '会话消息写入失败' });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '消息请求体过大' });
        return;
      }
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

  if (urlPath === '/api/stream-events' && method === 'POST') {
    if (identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可写入 AI 流事件' });
      return;
    }
    readBody(req, MESSAGE_BODY_LIMIT).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || !isValidSessionName(body.session)) {
        json(res, 400, { ok: false, error: 'session 或请求体无效' });
        return;
      }
      if (!['message', 'progress', 'receipt', 'ask'].includes(body.kind)) {
        json(res, 400, { ok: false, error: 'kind 只允许 message、progress、receipt 或 ask' });
        return;
      }
      if (!validStreamText(body.text)) {
        json(res, 400, { ok: false, error: 'text 必须非空且不超过 4000 字' });
        return;
      }
      try {
        const event = {
          author: AI_IDENTITY,
          kind: body.kind,
          text: body.text,
          ...(body.refs != null ? { refs: body.refs } : {}),
          ...(body.kind === 'ask' ? { ask: body.ask } : {}),
        };
        const entry = body.kind === 'ask'
          ? appendAskEntry(body.session, event, { exactSession: true })
          : appendStreamEntry(body.session, event, { exactSession: true });
        json(res, 200, { ok: true, entry });
      } catch (error) {
        const status = error?.code === 'ASK_ALREADY_EXISTS' ? 409 : 400;
        json(res, status, { ok: false, error: error.message });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '事件请求体过大' });
        return;
      }
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

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

  if (urlPath === '/api/sessions' && method === 'GET') {
    json(res, 200, { ok: true, sessions: listSessions() });
    return;
  }

  if (urlPath === '/api/projects' && method === 'GET') {
    try {
      json(res, 200, { ok: true, ...projectCatalog() });
    } catch (error) {
      console.error('[workbench:projects] 项目目录读取失败：', error.message);
      json(res, 500, { ok: false, error: '项目目录读取失败' });
    }
    return;
  }

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

  if (urlPath === '/api/participants' || urlPath.startsWith('/api/participants/')) {
    // 本地无口令时虽然旧 API 继续开放，但参与者名册管理必须显式提供管理员口令。
    if (!expectedToken || identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可管理参与者' });
      return;
    }
    if (urlPath === '/api/participants' && method === 'GET') {
      try { json(res, 200, { ok: true, participants: listParticipants(participantsFile) }); }
      catch (error) {
        console.error('[workbench:participants] 列表读取失败：', error.message);
        json(res, 500, { ok: false, error: '参与者名册无法读取' });
      }
      return;
    }
    if (urlPath === '/api/participants' && method === 'POST') {
      readBody(req).then((body) => {
        try {
          const participant = addParticipant(body || {}, { filePath: participantsFile });
          json(res, 201, {
            ok: true,
            participant: publicParticipant(participant),
            url: participantInviteUrl(req, participant.token),
          });
        } catch (error) {
          const damaged = /名册.*损坏/.test(error.message);
          json(res, damaged ? 500 : 400, { ok: false, error: error.message });
        }
      }).catch((error) => json(res, 400, { ok: false, error: `无效 JSON：${error.message}` }));
      return;
    }
    if (method === 'DELETE') {
      let id;
      try { id = decodeURIComponent(urlPath.slice('/api/participants/'.length)); }
      catch { id = ''; }
      try {
        if (!revokeParticipant(id, { filePath: participantsFile })) {
          json(res, 404, { ok: false, error: `参与者 ${id || '(空)'} 不存在` });
          return;
        }
        json(res, 200, { ok: true, id });
      } catch (error) {
        console.error('[workbench:participants] 吊销失败：', error.message);
        json(res, 500, { ok: false, error: '参与者名册无法更新' });
      }
      return;
    }
    json(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  if (urlPath === '/api/rounds' && method === 'POST') {
    // 出题权只属于管理员（owner）：参与者的职责是判断，不是发起新一轮
    if (expectedToken && identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可创建新一轮' });
      return;
    }
    readBody(req, ROUND_BODY_LIMIT).then((body) => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        json(res, 400, { ok: false, error: '请求体必须是完整的 content JSON' });
        return;
      }
      if (!isValidSessionName(body.session)) {
        json(res, 400, { ok: false, error: 'session 名称无效：限 80 字符，仅允许字母、数字、点、下划线和连字符' });
        return;
      }

      let content;
      try {
        // 轮次号由云端唯一分配：忽略客户端指定值，响应返回实际轮号。
        // 并发写仍由 writeRound 的原子 mkdir 兜底，绝不覆盖已有目录。
        const bodyWithoutRound = { ...body };
        delete bodyWithoutRound.round;
        content = prepareRound(body.session, bodyWithoutRound, { exactSession: true });
      } catch (error) {
        if (error?.code === 'INVALID_CONTENT') {
          json(res, 400, { ok: false, error: `内容校验失败：${error.errors.join('; ')}`, errors: error.errors });
          return;
        }
        throw error;
      }

      const allowIncomplete = requestUrl.searchParams.get('allowIncomplete') === '1';
      const incomplete = findIncompleteDecisions(content);
      if (incomplete.length && !allowIncomplete) {
        json(res, 400, {
          ok: false,
          error: formatIncompleteDecisions(incomplete),
          errors: incomplete.map((issue) => `[${issue.blockId}] 缺少：${issue.missingFields.join('、')}`),
        });
        return;
      }

      const warnings = lintContent(content);
      if (warnings.length) console.error(formatLint(warnings));

      try {
        const registeredProject = content.round === 1
          ? registeredProjectForSession(content.session)
          : null;
        const saved = writeRound(content.session, content, { allowOverwrite: false, exactSession: true });
        if (content.round === 1) {
          updateSessionMetadata(saved.session, {
            ...(typeof content.title === 'string' && content.title.trim()
              ? { title: content.title.trim() }
              : {}),
            ...(registeredProject ? { projectId: registeredProject.id } : {}),
            kind: 'work',
            status: 'active',
          }, { exactSession: true });
        }
        appendStreamEntry(saved.session, {
          author: AI_IDENTITY,
          kind: 'receipt',
          text: `已出第 ${saved.round} 轮：${content.title || '未命名轮次'}`,
          refs: { round: saved.round },
        }, { exactSession: true });
        const response = {
          ok: true,
          session: saved.session,
          round: saved.round,
          url: renderUrl(req, saved.session),
        };
        if (allowIncomplete) response.lintBypassed = true;
        if (content.round === 1 && !registeredProject) {
          response.warning = UNCLASSIFIED_SESSION_WARNING;
        }
        json(res, 200, response);
        dispatchExecutorEvent(eventWebhook, {
          event: 'round-presented',
          session: saved.session,
          round: saved.round,
          ...(typeof content.title === 'string' && content.title ? { title: content.title } : {}),
          at: new Date().toISOString(),
        });
      } catch (error) {
        if (error?.code === 'ROUND_EXISTS') {
          json(res, 409, { ok: false, error: `round ${content.round} 已存在，不允许覆盖` });
          return;
        }
        if (error?.code === 'INVALID_CONTENT') {
          json(res, 400, { ok: false, error: `内容校验失败：${error.errors.join('; ')}`, errors: error.errors });
          return;
        }
        console.error('[workbench:rounds] 写入失败：', error);
        json(res, 500, { ok: false, error: '轮次写入失败，请查看服务端日志' });
      }
    }).catch((error) => {
      if (error?.code === 'BODY_TOO_LARGE') {
        json(res, 413, { ok: false, error: '请求体过大：上限为 2 MB' });
        return;
      }
      console.error('[workbench:rounds] 请求处理失败：', error);
      json(res, 400, { ok: false, error: `无效 JSON：${error.message}` });
    });
    return;
  }

  if (urlPath === '/api/feedback' && method === 'GET') {
    const { session, round } = parseQuery(rawUrl);
    const parsedRound = validRoundQuery(round);
    if (!isValidSessionName(session) || parsedRound == null) {
      json(res, 400, { ok: false, error: 'session 或 round 参数无效' });
      return;
    }
    const view = feedbackView(session, parsedRound, identity);
    if (!view.feedback) {
      json(res, 200, { ok: false, pending: true });
      return;
    }
    json(res, 200, { ok: true, ...view });
    return;
  }

  if (urlPath === '/api/status' && method === 'GET') {
    const { session } = parseQuery(rawUrl);
    const status = session ? readStatus(session) : null;
    const worker = workerPresence(runtimeState);
    if (!status) {
      json(res, 200, {
        ok: true,
        status: null,
        display: 'unknown',
        assetsVersion: assetsVersion(),
        ...worker,
      });
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
    json(res, 200, {
      ok: true,
      status: responseStatus,
      display,
      stale,
      assetsVersion: assetsVersion(),
      ...worker,
    });
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
    const currentContentBlocks = Array.isArray(content.blocks) ? content.blocks : null;
    const currentBlocks = visibleBlocksForIdentity(currentContentBlocks || [], identity);
    const prevBlocks = prevContent ? visibleBlocksForIdentity(prevContent.blocks || [], identity) : [];
    const diffed = computeDiff(currentBlocks, prevBlocks);
    const currentBlockIds = new Set(
      (currentContentBlocks || [])
        .map((block) => block?.id)
        .filter((id) => typeof id === 'string'),
    );
    const removed = currentContentBlocks
      ? removedBlocks(currentBlocks, prevBlocks).filter((block) => !currentBlockIds.has(block?.id))
      : [];
    const sanity = diffSanity(diffed, removed);

    // 改动 E + 改动 C（DESIGN §4）：注入 _respondedToPrev 与 _decidedInPrev
    // 读上一轮 feedback；null guard：缺失/第1轮/文件被删均安全跳过，绝不报错
    const prevFeedback = prevRound > 0
      ? filterFeedbackForIdentity(
          readJSON(paths.feedback(session, prevRound), null),
          feedbackVisibilityForIdentity(session, prevRound, identity),
        )
      : null;
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

      const { session } = fb;
      const round = parseInt(fb.round, 10);
      // 与 GET 侧一致的防御深度：session/round 先过白名单再进任何路径拼接
      if (!isValidSessionName(session) || !Number.isInteger(round) || round < 1) {
        json(res, 400, { ok: false, error: 'session 或 round 参数无效' });
        return;
      }
      if (identity.role === 'participant') {
        const visibility = feedbackVisibilityForIdentity(session, round, identity);
        if (!visibility.valid) {
          json(res, 403, { ok: false, error: '无法验证当前轮内容，拒绝写入反馈' });
          return;
        }
        const forbiddenBlockIds = [...new Set(
          [
            ...fb.items.map((item) => item?.blockId),
            ...(Array.isArray(fb.unanswered) ? fb.unanswered : []),
          ]
            .filter((blockId) => (
              typeof blockId !== 'string'
              || !visibility.knownBlockIds.has(blockId)
              || !visibility.visibleBlockIds.has(blockId)
            )),
        )];
        if (forbiddenBlockIds.length) {
          console.error('[workbench:feedback] 拒绝参与者提交不可见块反馈：', {
            session,
            round,
            participant: identity.id,
            blockIds: forbiddenBlockIds,
          });
          json(res, 403, {
            ok: false,
            error: `反馈包含不可见块：${forbiddenBlockIds.join('、')}`,
            blockIds: forbiddenBlockIds,
          });
          return;
        }
      }
      const pathOptions = { exactSession: true };
      const st = readStatus(session, pathOptions);
      if (identity.role === 'owner' && st && st.state === 'claimed') {
        json(res, 409, { ok: false, error: 'claimed' });
        return;
      }

      const now = new Date().toISOString();
      const submittedBy = { id: identity.id, name: identity.name };
      // submittedBy 永远由服务端覆盖，不能信任客户端自报身份。
      const saved = { ...fb, submittedAt: now, submittedBy };
      const primaryPath = paths.feedback(session, round, pathOptions);
      if (identity.role === 'participant') {
        writeJSON(paths.participantFeedback(session, round, identity.id, pathOptions), saved);
        const primary = readJSON(primaryPath, null);
        const mayRefreshBridge = !primary || (
          primary.submittedBy?.id === identity.id
          && !TERMINAL_OR_PROCESSING_STATES.has(st?.state)
        );
        if (mayRefreshBridge) {
          writeJSON(primaryPath, saved);
          writeText(paths.feedbackMd(session, round, pathOptions), feedbackToMd(saved));
        }
        if (!TERMINAL_OR_PROCESSING_STATES.has(st?.state)) {
          writeStatus(session, { state: 'submitted', round, error: null }, undefined, pathOptions);
        }
      } else {
        writeJSON(primaryPath, saved);
        writeText(paths.feedbackMd(session, round, pathOptions), feedbackToMd(saved));
        writeStatus(session, { state: 'submitted', round, error: null }, undefined, pathOptions);
      }
      appendStreamEntry(session, {
        author: AI_IDENTITY,
        kind: 'receipt',
        text: `${submittedBy.name} 已提交第 ${round} 轮反馈`,
        refs: { round },
      }, pathOptions);
      json(res, 200, { ok: true, count: (fb.items || []).length });
      dispatchExecutorEvent(eventWebhook, {
        event: 'feedback-submitted',
        session,
        round,
        submittedBy,
        at: now,
      });
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

  if (urlPath === '/api/retry' && method === 'POST') {
    if (identity.role !== 'owner') {
      json(res, 403, { ok: false, error: '仅管理员可重试轮次' });
      return;
    }
    const { session, round } = parseQuery(rawUrl);
    const r = validRoundQuery(round);
    if (!isValidSessionName(session) || r == null) {
      json(res, 400, { ok: false, error: 'session and round required' });
      return;
    }
    const pathOptions = { exactSession: true };
    removeFile(paths.ack(session, r, pathOptions));
    removeFile(paths.error(session, r, pathOptions));
    writeStatus(session, { state: 'submitted', error: null, round: r }, undefined, pathOptions);
    json(res, 200, { ok: true });
    return;
  }

  // --- 会话资产：/assets/<session>/<path> → workspace/<session>/assets/<path> ---
  // 用途：session 自带的静态资源（如高保真 UI 设计稿 HTML），让工作台自托管，
  // 不再依赖外部服务（此前 prd-studio 的 :8088 必须开着才能看 UI 面）。
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

export function startServer(port, host = '127.0.0.1', { participantsFile = DEFAULT_PARTICIPANTS_FILE } = {}) {
  const listenHost = host || '127.0.0.1';
  const token = process.env.WORKBENCH_TOKEN || '';
  const eventWebhook = process.env.WORKBENCH_EVENT_WEBHOOK || '';
  const inboxClaimTimeoutMs = configuredClaimTimeoutMs(
    process.env.WORKBENCH_INBOX_CLAIM_TIMEOUT_MS,
  );
  const runtimeState = { workerHeartbeat: null, inboxClaimTimeoutMs };
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
