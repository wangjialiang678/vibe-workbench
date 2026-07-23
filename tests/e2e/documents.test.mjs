// 云端文档库：真实 HTTP server + CLI 的端到端契约测试。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/workbench.mjs');
const ADMIN_TOKEN = 'documents-admin-token';
const savedEnv = {};

let workspace;
let clientWorkspace;
let sourceDir;
let participantsFile;
let participantToken;
let server;
let port;
let readStreamEntries;

before(async () => {
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN', 'WORKBENCH_REMOTE_URL']) {
    savedEnv[key] = process.env[key];
  }
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-documents-server-'));
  clientWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-documents-client-'));
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-documents-source-'));
  participantsFile = path.join(workspace, 'config', 'participants.json');
  process.env.WB_WORKSPACE = workspace;
  process.env.WORKBENCH_TOKEN = ADMIN_TOKEN;
  delete process.env.WORKBENCH_REMOTE_URL;

  const [{ startServer }, { addParticipant }, stream] = await Promise.all([
    import('../../src/server/server.mjs'),
    import('../../src/participants.mjs'),
    import('../../src/stream.mjs'),
  ]);
  participantToken = addParticipant(
    { id: 'doc-reader', name: '文档读者' },
    { filePath: participantsFile },
  ).token;
  readStreamEntries = stream.readStreamEntries;

  server = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const directory of [workspace, clientWorkspace, sourceDir]) {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN', 'WORKBENCH_REMOTE_URL']) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function apiUrl(relativePath) {
  return `http://127.0.0.1:${port}${relativePath}`;
}

function tokenHeaders(token = ADMIN_TOKEN) {
  return { 'x-workbench-token': token };
}

async function publish(document, token = ADMIN_TOKEN) {
  return fetch(apiUrl('/api/documents'), {
    method: 'POST',
    headers: {
      ...tokenHeaders(token),
      'content-type': 'application/json',
    },
    body: JSON.stringify(document),
  });
}

async function runCli(args, env = {}) {
  return execFileAsync(process.execPath, [BIN, ...args], {
    env: {
      ...process.env,
      WB_WORKSPACE: clientWorkspace,
      WORKBENCH_TOKEN: '',
      WORKBENCH_REMOTE_URL: '',
      ...env,
    },
  });
}

test('POST/GET 文档：按分类路径保存 frontmatter，列表与单篇返回明确契约并写 receipt', async () => {
  const session = 'documents-basic';
  const request = {
    session,
    category: '需求',
    slug: 'product-brief',
    title: '产品 "蓝图"',
    body: '# 概览\n\n这是原文 Markdown。\n',
  };

  const response = await publish(request);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.ok, true);
  assert.equal(created.created, true);
  assert.deepEqual(created.document, {
    category: request.category,
    slug: request.slug,
    title: request.title,
    updatedAt: created.document.updatedAt,
    body: request.body,
  });
  assert.equal(Number.isNaN(Date.parse(created.document.updatedAt)), false);

  const storedPath = path.join(
    workspace,
    session,
    'documents',
    request.category,
    `${request.slug}.md`,
  );
  const stored = fs.readFileSync(storedPath, 'utf8');
  assert.match(stored, /^---\n/);
  assert.match(stored, /\ntitle: /);
  assert.match(stored, /\nupdatedAt: /);
  assert.equal(stored.endsWith(request.body), true);

  const listResponse = await fetch(
    apiUrl(`/api/documents?session=${encodeURIComponent(session)}`),
    { headers: tokenHeaders(participantToken) },
  );
  assert.equal(listResponse.status, 200);
  assert.deepEqual(await listResponse.json(), {
    documents: [{
      category: request.category,
      slug: request.slug,
      title: request.title,
      updatedAt: created.document.updatedAt,
    }],
  });

  const getResponse = await fetch(
    apiUrl(`/api/documents?session=${encodeURIComponent(session)}&slug=${request.slug}`),
    { headers: tokenHeaders(participantToken) },
  );
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await getResponse.json(), { document: created.document });

  const receipts = readStreamEntries(session, { exactSession: true });
  assert.equal(receipts.length, 1);
  assert.deepEqual(
    {
      author: receipts[0].author,
      kind: receipts[0].kind,
      text: receipts[0].text,
    },
    {
      author: { id: 'ai', name: 'AI', role: 'ai' },
      kind: 'receipt',
      text: `文档已更新：${request.title}`,
    },
  );
});

test('同 category+slug 更新覆盖正文，updatedAt 即使同毫秒写入也必须变化', async () => {
  const base = {
    session: 'documents-update',
    category: 'PRD',
    slug: 'main-prd',
    title: '主 PRD',
    body: '第一版',
  };
  const firstResponse = await publish(base);
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();

  const secondResponse = await publish({
    ...base,
    title: '主 PRD v2',
    body: '第二版',
  });
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.created, false);
  assert.notEqual(second.document.updatedAt, first.document.updatedAt);
  assert.equal(Date.parse(second.document.updatedAt) > Date.parse(first.document.updatedAt), true);
  assert.equal(second.document.body, '第二版');

  const receipts = readStreamEntries(base.session, { exactSession: true });
  assert.deepEqual(
    receipts.map(({ text }) => text),
    ['文档已更新：主 PRD', '文档已更新：主 PRD v2'],
  );
});

test('单篇查询：slug 全会话唯一时直接返回，跨分类重复时 409，category 可消歧', async () => {
  const session = 'documents-ambiguous';
  for (const [category, title] of [['架构', '后端架构'], ['UI 设计', '界面架构']]) {
    const response = await publish({
      session,
      category,
      slug: 'system-design',
      title,
      body: `${title}正文`,
    });
    assert.equal(response.status, 201);
  }

  const ambiguous = await fetch(
    apiUrl(`/api/documents?session=${session}&slug=system-design`),
    { headers: tokenHeaders() },
  );
  assert.equal(ambiguous.status, 409);
  assert.deepEqual(await ambiguous.json(), {
    ok: false,
    error: '文档 slug 在多个分类中重复，请指定 category',
  });

  const selected = await fetch(
    apiUrl(`/api/documents?session=${session}&slug=system-design&category=${encodeURIComponent('架构')}`),
    { headers: tokenHeaders() },
  );
  assert.equal(selected.status, 200);
  const selectedBody = await selected.json();
  assert.equal(selectedBody.document.category, '架构');
  assert.equal(selectedBody.document.body, '后端架构正文');
});

test('POST 仅管理员可用；GET 允许已认证参与者读取', async () => {
  const input = {
    session: 'documents-auth',
    category: '测试',
    slug: 'auth-check',
    title: '鉴权检查',
    body: '只有管理员能发布。',
  };
  const forbidden = await publish(input, participantToken);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), {
    ok: false,
    error: '仅管理员可发布文档',
  });

  const owner = await publish(input);
  assert.equal(owner.status, 201);
  const readable = await fetch(
    apiUrl(`/api/documents?session=${input.session}`),
    { headers: tokenHeaders(participantToken) },
  );
  assert.equal(readable.status, 200);
  assert.equal((await readable.json()).documents.length, 1);
});

test('POST 校验 session/category/slug/title/body，并按 UTF-8 字节执行 256 KiB 上限', async () => {
  const valid = {
    session: 'documents-validation',
    category: '其他',
    slug: 'valid-doc',
    title: '合法文档',
    body: '正文',
  };
  const invalidCases = [
    [{ ...valid, session: '../escape' }, /session/i],
    [{ ...valid, category: '产品' }, /category|分类/i],
    [{ ...valid, slug: '../escape' }, /slug/i],
    [{ ...valid, slug: 'Upper_Case' }, /slug/i],
    [{ ...valid, title: ' \n ' }, /title|标题/i],
    [{ ...valid, body: { markdown: true } }, /body|正文/i],
  ];
  for (const [input, errorPattern] of invalidCases) {
    const response = await publish(input);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, errorPattern);
  }

  const exactBody = `${'你'.repeat(87381)}a`;
  assert.equal(Buffer.byteLength(exactBody, 'utf8'), 256 * 1024);
  const exact = await publish({
    ...valid,
    slug: 'exact-limit',
    body: exactBody,
  });
  assert.equal(exact.status, 201);

  // JSON 传输会把引号转义成两个字节，但限额必须按解码后的 UTF-8 正文字节计算。
  const escapedExactBody = '"'.repeat(256 * 1024);
  assert.equal(Buffer.byteLength(escapedExactBody, 'utf8'), 256 * 1024);
  const escapedExact = await publish({
    ...valid,
    slug: 'escaped-exact-limit',
    body: escapedExactBody,
  });
  assert.equal(escapedExact.status, 201);

  const tooLarge = await publish({
    ...valid,
    slug: 'over-limit',
    body: `${exactBody}b`,
  });
  assert.equal(tooLarge.status, 400);
  assert.match((await tooLarge.json()).error, /256 KiB|256KB|字节/);
  assert.equal(
    fs.existsSync(path.join(workspace, valid.session, 'documents', valid.category, 'over-limit.md')),
    false,
  );
});

test('GET 校验查询参数；不存在的文档返回 404', async () => {
  for (const relative of [
    '/api/documents',
    '/api/documents?session=../escape',
    '/api/documents?session=valid&slug=',
    '/api/documents?session=valid&slug=Upper_Case',
    '/api/documents?session=valid&slug=missing&category=',
    `/api/documents?session=valid&slug=missing&category=${encodeURIComponent('产品')}`,
  ]) {
    const response = await fetch(apiUrl(relative), { headers: tokenHeaders() });
    assert.equal(response.status, 400, relative);
    assert.equal((await response.json()).ok, false);
  }

  const missing = await fetch(
    apiUrl('/api/documents?session=valid-session&slug=missing'),
    { headers: tokenHeaders() },
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { ok: false, error: '文档不存在' });
});

test('CLI 本地 doc-publish：标题优先采用 frontmatter，正文不重复保存源 frontmatter', async () => {
  const source = path.join(sourceDir, 'requirements.md');
  fs.writeFileSync(
    source,
    '---\ntitle: "源文件标题"\nauthor: ignored\n---\n# 需求\n\n本地正文\n',
    'utf8',
  );

  const { stdout } = await runCli([
    'doc-publish',
    'cli-local',
    '需求',
    'requirements',
    source,
  ]);
  const output = JSON.parse(stdout);
  assert.equal(output.ok, true);
  assert.equal(output.created, true);
  assert.equal(output.document.title, '源文件标题');
  assert.equal(output.document.body, '# 需求\n\n本地正文\n');

  const stored = fs.readFileSync(
    path.join(clientWorkspace, 'cli-local', 'documents', '需求', 'requirements.md'),
    'utf8',
  );
  assert.equal((stored.match(/^---$/gm) || []).length, 2, '落盘文件只应有一组 frontmatter');
});

test('CLI 本地 doc-publish：无 frontmatter 时用文件名，--title 可覆盖', async () => {
  const source = path.join(sourceDir, 'release-notes.md');
  fs.writeFileSync(source, '发布说明正文', 'utf8');

  const first = JSON.parse((await runCli([
    'doc-publish',
    'cli-default-title',
    '其他',
    'release-notes',
    source,
  ])).stdout);
  assert.equal(first.document.title, 'release-notes');

  const second = JSON.parse((await runCli([
    'doc-publish',
    'cli-title-override',
    '其他',
    'release-notes',
    source,
    '--title',
    '显式标题',
  ])).stdout);
  assert.equal(second.document.title, '显式标题');
});

test('CLI 远程 doc-publish：使用 WORKBENCH_REMOTE_URL 和管理员 token，仅写云端', async () => {
  const source = path.join(sourceDir, 'remote.md');
  fs.writeFileSync(source, '# 远程正文\n', 'utf8');
  const session = 'cli-remote';

  const { stdout } = await runCli([
    'doc-publish',
    session,
    '交互设计',
    'remote-flow',
    source,
    '--title',
    '远程交互稿',
  ], {
    WORKBENCH_REMOTE_URL: `http://127.0.0.1:${port}`,
    WORKBENCH_TOKEN: ADMIN_TOKEN,
  });
  const output = JSON.parse(stdout);
  assert.equal(output.ok, true);
  assert.equal(output.document.title, '远程交互稿');
  assert.equal(output.document.body, '# 远程正文\n');
  assert.equal(
    fs.existsSync(path.join(workspace, session, 'documents', '交互设计', 'remote-flow.md')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(clientWorkspace, session, 'documents', '交互设计', 'remote-flow.md')),
    false,
  );
});

test('CLI --help 展示 doc-publish 完整参数', async () => {
  const { stdout } = await runCli(['--help']);
  assert.match(
    stdout,
    /doc-publish\s+<session>\s+<category>\s+<slug>\s+<md文件路径>\s+\[--title/,
  );
});
