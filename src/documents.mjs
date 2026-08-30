// 云端文档库文件契约：每篇文档一个带 frontmatter 的 Markdown 文件。
import { disk } from './storage/index.mjs';
import path from 'node:path';

import { isValidSessionName, sessionDir } from './workspace.mjs';

export const DOCUMENT_CATEGORIES = Object.freeze([
  '需求',
  'PRD',
  '架构',
  'UI 设计',
  '交互设计',
  '测试',
  '其他',
]);
export const DOCUMENT_SLUG_RE = /^[a-z0-9-]{1,64}$/;
export const DOCUMENT_BODY_LIMIT = 256 * 1024;

function documentError(message, code = 'INVALID_DOCUMENT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertSession(session) {
  if (!isValidSessionName(session)) throw documentError('session 参数无效');
}

function assertCategory(category) {
  if (!DOCUMENT_CATEGORIES.includes(category)) {
    throw documentError(`category 分类无效：仅允许 ${DOCUMENT_CATEGORIES.join('、')}`);
  }
}

function assertSlug(slug) {
  if (typeof slug !== 'string' || !DOCUMENT_SLUG_RE.test(slug)) {
    throw documentError('slug 无效：仅允许 1-64 位小写字母、数字和连字符');
  }
}

function cleanTitle(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw documentError('title 标题必须是非空字符串');
  }
  return title.trim();
}

function assertBody(body) {
  if (typeof body !== 'string') throw documentError('body 正文必须是 Markdown 字符串');
  if (Buffer.byteLength(body, 'utf8') > DOCUMENT_BODY_LIMIT) {
    throw documentError('body 正文 UTF-8 字节长度不能超过 256 KiB');
  }
}

export function documentPath(session, category, slug, { exactSession = true } = {}) {
  assertSession(session);
  assertCategory(category);
  assertSlug(slug);
  return path.join(sessionDir(session, { exactSession }), 'documents', category, `${slug}.md`);
}

function parseFrontmatterValue(value) {
  const raw = value.trim();
  if (!raw) return '';
  if (raw.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : raw;
    } catch {
      return raw;
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  return raw;
}

function splitFrontmatter(markdown) {
  if (typeof markdown !== 'string') return null;
  const matched = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!matched) return null;
  const metadata = {};
  for (const line of matched[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (field) metadata[field[1]] = parseFrontmatterValue(field[2]);
  }
  return { metadata, body: matched[2] };
}

/** CLI 读取普通 Markdown 时只消费最前面的一组 frontmatter，其余正文保持原样。 */
export function parseMarkdownSource(markdown) {
  const parsed = splitFrontmatter(markdown);
  if (!parsed) return { title: null, body: markdown };
  const title = typeof parsed.metadata.title === 'string' && parsed.metadata.title.trim()
    ? parsed.metadata.title.trim()
    : null;
  return { title, body: parsed.body };
}

function parseStoredDocument(raw, category, slug) {
  const parsed = splitFrontmatter(raw);
  const { title, updatedAt } = parsed?.metadata || {};
  if (!parsed || typeof title !== 'string' || !title.trim()
    || typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) {
    throw documentError(`文档 ${category}/${slug} 的 frontmatter 已损坏`, 'CORRUPT_DOCUMENT');
  }
  return {
    category,
    slug,
    title,
    updatedAt,
    body: parsed.body,
  };
}

function serializeDocument({ title, updatedAt, body }) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `updatedAt: ${JSON.stringify(updatedAt)}`,
    '---',
    body,
  ].join('\n');
}

function nextUpdatedAt(previousUpdatedAt, now = new Date()) {
  const currentMs = now instanceof Date ? now.getTime() : Date.now();
  const previousMs = Date.parse(previousUpdatedAt || '');
  return new Date(Number.isNaN(previousMs) ? currentMs : Math.max(currentMs, previousMs + 1))
    .toISOString();
}

export function publishDocument(input, { exactSession = true, now } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw documentError('请求体必须是文档对象');
  }
  const { session, category, slug, body } = input;
  assertSession(session);
  assertCategory(category);
  assertSlug(slug);
  const title = cleanTitle(input.title);
  assertBody(body);

  const file = documentPath(session, category, slug, { exactSession });
  let previous = null;
  try {
    previous = parseStoredDocument(disk.readFileSync(file, 'utf8'), category, slug);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const updatedAt = nextUpdatedAt(previous?.updatedAt, now);
  const document = { category, slug, title, updatedAt, body };
  disk.mkdirSync(path.dirname(file), { recursive: true });
  disk.writeFileSync(file, serializeDocument(document), 'utf8');
  return { created: previous == null, document };
}

function readDocumentInCategory(session, category, slug, { exactSession }) {
  const file = documentPath(session, category, slug, { exactSession });
  try {
    return parseStoredDocument(disk.readFileSync(file, 'utf8'), category, slug);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function readDocument(session, {
  slug,
  category,
  exactSession = true,
} = {}) {
  assertSession(session);
  assertSlug(slug);
  if (category != null) {
    assertCategory(category);
    return readDocumentInCategory(session, category, slug, { exactSession });
  }

  const matches = DOCUMENT_CATEGORIES
    .map((candidate) => readDocumentInCategory(session, candidate, slug, { exactSession }))
    .filter(Boolean);
  if (matches.length > 1) {
    throw documentError(
      '文档 slug 在多个分类中重复，请指定 category',
      'AMBIGUOUS_DOCUMENT',
    );
  }
  return matches[0] || null;
}

export function listDocuments(session, { exactSession = true } = {}) {
  assertSession(session);
  const documents = [];
  for (const category of DOCUMENT_CATEGORIES) {
    const categoryDir = path.join(sessionDir(session, { exactSession }), 'documents', category);
    let entries;
    try {
      entries = disk.readdirSync(categoryDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const slug = entry.name.slice(0, -3);
      if (!DOCUMENT_SLUG_RE.test(slug)) continue;
      const document = readDocumentInCategory(session, category, slug, { exactSession });
      documents.push({
        category,
        slug,
        title: document.title,
        updatedAt: document.updatedAt,
      });
    }
  }
  return documents.sort((left, right) => {
    const categoryOrder = DOCUMENT_CATEGORIES.indexOf(left.category)
      - DOCUMENT_CATEGORIES.indexOf(right.category);
    return categoryOrder || left.slug.localeCompare(right.slug);
  });
}
