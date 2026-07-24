// 会话流 E2E 契约测试：消息实名、自动回执、管理员事件与安全附件上传。
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const OWNER_TOKEN = 'session-stream-owner-token';
const PARTICIPANT = {
  id: 'alice',
  name: '小艾',
  token: 'session-stream-alice-token',
  createdAt: '2026-07-23T00:00:00.000Z',
};
const ENV_KEYS = ['WB_WORKSPACE', 'WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK'];

let tmpDir;
let participantsFile;
let startServer;
let server;
let baseUrl;
const savedEnv = {};

function waitForListening(target) {
  if (target.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    target.once('listening', resolve);
    target.once('error', reject);
  });
}

function closeServer(target) {
  if (!target?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    target.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token = OWNER_TOKEN, extra = {}) {
  return token == null
    ? { ...extra }
    : { 'x-workbench-token': token, ...extra };
}

async function postJson(pathname, body, token = OWNER_TOKEN) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: authHeaders(token, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

async function getMessages(session, since) {
  const query = new URLSearchParams({ session });
  if (since != null) query.set('since', since);
  const response = await fetch(`${baseUrl}/api/messages?${query}`, {
    headers: authHeaders(),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.entries));
  return body.entries;
}

function streamFile(session) {
  return path.join(tmpDir, session, 'stream.jsonl');
}

function seedStream(session, entries) {
  const target = streamFile(session);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

function roundContent(session, title = '计划评审') {
  return {
    session,
    title,
    blocks: [{ id: 'overview', type: 'markdown', body: '请评审本轮计划。' }],
  };
}

before(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-session-stream-e2e-'));
  participantsFile = path.join(tmpDir, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, `${JSON.stringify([PARTICIPANT], null, 2)}\n`, 'utf8');

  process.env.WB_WORKSPACE = tmpDir;
  process.env.WORKBENCH_TOKEN = OWNER_TOKEN;
  delete process.env.WORKBENCH_EVENT_WEBHOOK;

  ({ startServer } = await import('../../src/server/server.mjs'));
  server = startServer(0, '127.0.0.1', { participantsFile });
  await waitForListening(server);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await closeServer(server);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('POST /api/messages 以服务端身份写入 owner 与参与者实名，忽略客户端伪造 author', async () => {
  const session = 'message-real-identity';
  const forgedAuthor = { id: 'mallory', name: '伪造用户', role: 'ai' };

  const ownerResponse = await postJson('/api/messages', {
    session,
    text: '管理员消息',
    author: forgedAuthor,
  });
  assert.equal(ownerResponse.status, 200);
  const ownerBody = await ownerResponse.json();
  assert.equal(ownerBody.ok, true);
  assert.deepEqual(ownerBody.entry.author, { id: 'owner', name: '管理员', role: 'owner' });
  assert.equal(ownerBody.entry.kind, 'message');
  assert.equal(ownerBody.entry.text, '管理员消息');
  assert.equal(typeof ownerBody.entry.id, 'string');
  assert.ok(Number.isFinite(Date.parse(ownerBody.entry.at)));

  const participantResponse = await postJson('/api/messages', {
    session,
    text: '参与者消息',
    author: forgedAuthor,
  }, PARTICIPANT.token);
  assert.equal(participantResponse.status, 200);
  const participantBody = await participantResponse.json();
  assert.equal(participantBody.ok, true);
  assert.deepEqual(participantBody.entry.author, {
    id: PARTICIPANT.id,
    name: PARTICIPANT.name,
    role: 'participant',
  });
  assert.equal(participantBody.entry.kind, 'message');
  assert.equal(participantBody.entry.text, '参与者消息');
  assert.notEqual(participantBody.entry.id, ownerBody.entry.id);

  const entries = await getMessages(session);
  assert.deepEqual(entries.map(({ author, text }) => ({ author, text })), [
    { author: { id: 'owner', name: '管理员', role: 'owner' }, text: '管理员消息' },
    {
      author: { id: PARTICIPANT.id, name: PARTICIPANT.name, role: 'participant' },
      text: '参与者消息',
    },
  ]);
});

test('GET /api/messages 返回当前公开身份，供前端判断自己的消息分侧', async () => {
  const query = new URLSearchParams({ session: 'message-viewer-identity' });
  const response = await fetch(`${baseUrl}/api/messages?${query}`, {
    headers: authHeaders(PARTICIPANT.token),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.identity, {
    id: PARTICIPANT.id,
    name: PARTICIPANT.name,
    role: 'participant',
  });
  assert.equal(Object.hasOwn(body.identity, 'token'), false);
});

test('POST /api/messages 拒绝空白正文和超过 4000 个 Unicode 字符的正文', async () => {
  for (const text of ['', ' \n\t ', '字'.repeat(4001)]) {
    const response = await postJson('/api/messages', {
      session: 'message-text-limits',
      text,
    });
    assert.equal(response.status, 400, `正文长度 ${[...text].length} 应被拒绝`);
    assert.equal((await response.json()).ok, false);
  }
});

test('GET /api/messages 默认返回最后 100 条，并支持 ID 与时间 since 游标', async () => {
  const session = 'message-cursors';
  const entries = Array.from({ length: 101 }, (_, index) => ({
    id: `entry-${String(index + 1).padStart(3, '0')}`,
    at: new Date(Date.UTC(2026, 6, 23, 0, 0, index)).toISOString(),
    author: { id: 'owner', name: '管理员', role: 'owner' },
    kind: 'message',
    text: `消息 ${index + 1}`,
  }));
  seedStream(session, entries);

  const defaultEntries = await getMessages(session);
  assert.equal(defaultEntries.length, 100);
  assert.equal(defaultEntries[0].id, 'entry-002');
  assert.equal(defaultEntries.at(-1).id, 'entry-101');

  const afterId = await getMessages(session, 'entry-099');
  assert.deepEqual(afterId.map((entry) => entry.id), ['entry-100', 'entry-101']);

  const afterTime = await getMessages(session, entries[98].at);
  assert.deepEqual(afterTime.map((entry) => entry.id), ['entry-100', 'entry-101']);
});

test('POST /api/messages 成功后异步发送 message-posted webhook', async () => {
  let resolveEvent;
  const receivedEvent = new Promise((resolve) => { resolveEvent = resolve; });
  const webhookServer = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      resolveEvent({
        method: req.method,
        contentType: req.headers['content-type'],
        body: JSON.parse(raw),
      });
      res.writeHead(204);
      res.end();
    });
  });
  webhookServer.listen(0, '127.0.0.1');
  await waitForListening(webhookServer);

  const previousWebhook = process.env.WORKBENCH_EVENT_WEBHOOK;
  process.env.WORKBENCH_EVENT_WEBHOOK =
    `http://127.0.0.1:${webhookServer.address().port}/events`;
  const eventServer = startServer(0, '127.0.0.1', { participantsFile });
  await waitForListening(eventServer);
  if (previousWebhook == null) delete process.env.WORKBENCH_EVENT_WEBHOOK;
  else process.env.WORKBENCH_EVENT_WEBHOOK = previousWebhook;

  const eventBase = `http://127.0.0.1:${eventServer.address().port}`;
  try {
    const posted = await fetch(`${eventBase}/api/messages`, {
      method: 'POST',
      headers: authHeaders(OWNER_TOKEN, { 'content-type': 'application/json' }),
      body: JSON.stringify({ session: 'message-webhook', text: '需要异步通知' }),
    });
    assert.equal(posted.status, 200);

    const event = await withTimeout(receivedEvent, 1000, '等待 message-posted webhook 超时');
    assert.equal(event.method, 'POST');
    assert.match(event.contentType || '', /application\/json/i);
    assert.equal(event.body.event, 'message-posted');
    assert.equal(event.body.session, 'message-webhook');
    assert.ok(Number.isFinite(Date.parse(event.body.at)));
  } finally {
    await closeServer(eventServer);
    await closeServer(webhookServer);
  }
});

test('POST /api/rounds 成功后追加精确文案的 AI receipt', async () => {
  const session = 'round-ai-receipt';
  const response = await postJson('/api/rounds', roundContent(session, '架构评审'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.round, 1);

  const entries = await getMessages(session);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'receipt');
  assert.equal(entries[0].text, '已出第 1 轮：架构评审');
  assert.equal(entries[0].author.id, 'ai');
  assert.equal(entries[0].author.role, 'ai');
});

test('POST /api/feedback 成功后按服务端实名追加精确文案的 AI receipt', async () => {
  const session = 'feedback-ai-receipt';
  const roundResponse = await postJson('/api/rounds', roundContent(session));
  assert.equal(roundResponse.status, 200);

  const feedbackResponse = await postJson('/api/feedback', {
    session,
    round: 1,
    items: [],
    submittedBy: { id: 'mallory', name: '伪造用户' },
  }, PARTICIPANT.token);
  assert.equal(feedbackResponse.status, 200);

  const entries = await getMessages(session);
  const receipt = entries.at(-1);
  assert.equal(receipt.kind, 'receipt');
  assert.equal(receipt.text, '小艾 已提交第 1 轮反馈');
  assert.equal(receipt.author.id, 'ai');
  assert.equal(receipt.author.role, 'ai');
});

test('POST /api/stream-events 拒绝参与者，owner 可写 message/progress/receipt 且作者固定为 AI', async () => {
  const session = 'owner-stream-events';
  const denied = await postJson('/api/stream-events', {
    session,
    kind: 'progress',
    text: '参与者伪造进度',
  }, PARTICIPANT.token);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).ok, false);

  for (const [kind, text] of [
    ['message', '这是 AI 的实质回答'],
    ['progress', '正在分析反馈'],
    ['receipt', '分析已完成'],
  ]) {
    const response = await postJson('/api/stream-events', {
      session,
      kind,
      text,
      author: { id: 'mallory', name: '伪造用户', role: 'owner' },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.entry.kind, kind);
    assert.equal(body.entry.text, text);
    assert.equal(body.entry.author.id, 'ai');
    assert.equal(body.entry.author.role, 'ai');
  }

  const entries = await getMessages(session);
  assert.deepEqual(entries.map(({ kind, text, author }) => ({ kind, text, author: author.id })), [
    { kind: 'message', text: '这是 AI 的实质回答', author: 'ai' },
    { kind: 'progress', text: '正在分析反馈', author: 'ai' },
    { kind: 'receipt', text: '分析已完成', author: 'ai' },
  ]);
});

test('POST /api/stream-events 写 ask，并拒绝缺 desc、非法 recommendation 与越界选项数', async () => {
  const session = 'ask-validation';
  const validAsk = {
    id: 'deploy-mode',
    question: '选择部署方式',
    options: [
      { id: 'rolling', label: '滚动发布', desc: '风险低，但发布时间更长。' },
      { id: 'direct', label: '直接发布', desc: '速度快，但故障影响面更大。' },
    ],
    multi: false,
    recommendation: 'rolling',
  };

  const denied = await postJson('/api/stream-events', {
    session,
    kind: 'ask',
    text: validAsk.question,
    ask: validAsk,
  }, PARTICIPANT.token);
  assert.equal(denied.status, 403);

  const accepted = await postJson('/api/stream-events', {
    session,
    kind: 'ask',
    text: validAsk.question,
    ask: validAsk,
  });
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.entry.kind, 'ask');
  assert.equal(acceptedBody.entry.author.id, 'ai');
  assert.deepEqual(acceptedBody.entry.ask, validAsk);

  const cases = [
    {
      name: '缺 desc',
      ask: {
        ...validAsk,
        id: 'missing-desc',
        options: [{ id: 'a', label: 'A' }, validAsk.options[1]],
        recommendation: undefined,
      },
    },
    {
      name: '非法推荐项',
      ask: { ...validAsk, id: 'bad-rec', recommendation: 'not-an-option' },
    },
    {
      name: '选项不足',
      ask: {
        ...validAsk,
        id: 'too-few',
        options: [validAsk.options[0]],
        recommendation: 'rolling',
      },
    },
    {
      name: '选项过多',
      ask: {
        ...validAsk,
        id: 'too-many',
        options: [
          ...validAsk.options,
          { id: 'three', label: '第三项', desc: '代价三。' },
          { id: 'four', label: '第四项', desc: '代价四。' },
          { id: 'five', label: '第五项', desc: '代价五。' },
        ],
      },
    },
  ];
  for (const item of cases) {
    const response = await postJson('/api/stream-events', {
      session,
      kind: 'ask',
      text: item.name,
      ask: item.ask,
    });
    assert.equal(response.status, 400, item.name);
    assert.equal((await response.json()).ok, false);
  }
});

test('POST /api/messages 实名写 answer，校验引用与选项，并拒绝同一 ask 重复回答', async () => {
  const session = 'answer-validation';
  const ask = {
    id: 'release-window',
    question: '选择发布时间',
    options: [
      { id: 'tonight', label: '今晚发布', desc: '更快交付，但值守成本更高。' },
      { id: 'tomorrow', label: '明早发布', desc: '值守稳定，但晚半天交付。' },
    ],
    multi: false,
    recommendation: 'tomorrow',
  };
  assert.equal((await postJson('/api/stream-events', {
    session,
    kind: 'ask',
    text: ask.question,
    ask,
  })).status, 200);

  const missing = await postJson('/api/messages', {
    session,
    answerTo: 'missing-ask',
    answerValue: 'tonight',
  }, PARTICIPANT.token);
  assert.equal(missing.status, 400);

  const invalid = await postJson('/api/messages', {
    session,
    answerTo: ask.id,
    answerValue: 'missing-option',
  }, PARTICIPANT.token);
  assert.equal(invalid.status, 400);

  const answered = await postJson('/api/messages', {
    session,
    answerTo: ask.id,
    answerValue: 'tomorrow',
    author: { id: 'mallory', name: '伪造用户', role: 'owner' },
  }, PARTICIPANT.token);
  assert.equal(answered.status, 200);
  const body = await answered.json();
  assert.deepEqual(body.entry.author, {
    id: PARTICIPANT.id,
    name: PARTICIPANT.name,
    role: 'participant',
  });
  assert.equal(body.entry.kind, 'answer');
  assert.equal(body.entry.text, '明早发布');
  assert.equal(body.entry.answerTo, ask.id);
  assert.equal(body.entry.answerValue, 'tomorrow');

  const repeated = await postJson('/api/messages', {
    session,
    answerTo: ask.id,
    answerValue: 'tonight',
  });
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).ok, false);

  const entries = await getMessages(session);
  assert.deepEqual(entries.map((entry) => entry.kind), ['ask', 'answer']);
});

test('answer 仍走 message-posted webhook，可即时唤醒 resident worker', async () => {
  let resolveEvent;
  const receivedEvent = new Promise((resolve) => { resolveEvent = resolve; });
  const webhookServer = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      resolveEvent(JSON.parse(raw));
      res.writeHead(204);
      res.end();
    });
  });
  webhookServer.listen(0, '127.0.0.1');
  await waitForListening(webhookServer);

  const previousWebhook = process.env.WORKBENCH_EVENT_WEBHOOK;
  process.env.WORKBENCH_EVENT_WEBHOOK =
    `http://127.0.0.1:${webhookServer.address().port}/events`;
  const eventServer = startServer(0, '127.0.0.1', { participantsFile });
  await waitForListening(eventServer);
  if (previousWebhook == null) delete process.env.WORKBENCH_EVENT_WEBHOOK;
  else process.env.WORKBENCH_EVENT_WEBHOOK = previousWebhook;

  const eventBase = `http://127.0.0.1:${eventServer.address().port}`;
  try {
    const ask = {
      id: 'wake-choice',
      question: '是否继续？',
      options: [
        { id: 'yes', label: '继续', desc: '立即继续，会占用当前资源。' },
        { id: 'no', label: '暂停', desc: '暂不占资源，但整体完成更晚。' },
      ],
      multi: false,
    };
    const askResponse = await fetch(`${eventBase}/api/stream-events`, {
      method: 'POST',
      headers: authHeaders(OWNER_TOKEN, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        session: 'answer-webhook',
        kind: 'ask',
        text: ask.question,
        ask,
      }),
    });
    assert.equal(askResponse.status, 200);

    const answerResponse = await fetch(`${eventBase}/api/messages`, {
      method: 'POST',
      headers: authHeaders(PARTICIPANT.token, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        session: 'answer-webhook',
        answerTo: ask.id,
        answerValue: 'yes',
      }),
    });
    assert.equal(answerResponse.status, 200);

    const event = await withTimeout(receivedEvent, 1000, '等待 answer webhook 超时');
    assert.equal(event.event, 'message-posted');
    assert.equal(event.session, 'answer-webhook');
    assert.equal(event.kind, 'answer');
  } finally {
    await closeServer(eventServer);
    await closeServer(webhookServer);
  }
});

async function upload({
  session,
  mime,
  filename,
  bytes,
  token = OWNER_TOKEN,
}) {
  const query = new URLSearchParams({ session });
  return fetch(`${baseUrl}/api/attachments?${query}`, {
    method: 'POST',
    headers: authHeaders(token, {
      'content-type': mime,
      'x-file-name': filename,
    }),
    body: bytes,
  });
}

test('POST /api/attachments 允许 PNG/JPEG/WebP/GIF/PDF，落盘并返回可带 query token 读取的 URL', async () => {
  const session = 'attachment-types';
  const cases = [
    ['image/png', 'diagram.png', '.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['image/jpeg', 'photo.jpeg', '.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['image/webp', 'preview.webp', '.webp', Buffer.from('RIFF____WEBP')],
    ['image/gif', 'motion.gif', '.gif', Buffer.from('GIF89a')],
    ['application/pdf', 'report.pdf', '.pdf', Buffer.from('%PDF-1.4\n%%EOF')],
  ];

  for (const [mime, filename, extension, bytes] of cases) {
    const response = await upload({ session, mime, filename, bytes });
    assert.equal(response.status, 200, mime);
    const body = await response.json();
    assert.equal(body.ok, true);

    const assetUrl = new URL(body.url, baseUrl);
    assert.equal(assetUrl.pathname.startsWith(`/assets/${session}/uploads/`), true);
    assert.equal(assetUrl.pathname.endsWith(extension), true);
    assetUrl.searchParams.set('token', OWNER_TOKEN);

    const downloaded = await fetch(assetUrl);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);

    const assetRelativePath = decodeURIComponent(assetUrl.pathname.slice('/assets/'.length));
    const [assetSession, ...assetParts] = assetRelativePath.split('/');
    const savedPath = path.join(tmpDir, assetSession, 'assets', ...assetParts);
    assert.equal(fs.existsSync(savedPath), true);
    assert.deepEqual(fs.readFileSync(savedPath), bytes);
  }
});

test('POST /api/attachments 允许恰好 5 MiB，超过 5 MiB 返回 413', async () => {
  const exactlyFiveMiB = Buffer.alloc(5 * 1024 * 1024, 0x61);
  const allowed = await upload({
    session: 'attachment-five-mib',
    mime: 'image/png',
    filename: 'boundary.png',
    bytes: exactlyFiveMiB,
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).ok, true);

  const tooLarge = await upload({
    session: 'attachment-too-large',
    mime: 'image/png',
    filename: 'oversized.png',
    bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 0x62),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).ok, false);
  assert.equal(fs.existsSync(path.join(tmpDir, 'attachment-too-large', 'assets', 'uploads')), false);
});

test('POST /api/attachments 对不支持的 MIME 返回 415，缺 token 返回 403', async () => {
  const unsupported = await upload({
    session: 'attachment-unsupported',
    mime: 'text/plain',
    filename: 'notes.txt',
    bytes: Buffer.from('not allowed'),
  });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).ok, false);

  const unauthenticated = await upload({
    session: 'attachment-no-token',
    mime: 'image/png',
    filename: 'secret.png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    token: null,
  });
  assert.equal(unauthenticated.status, 403);
  assert.equal((await unauthenticated.json()).ok, false);
});

test('GET /api/assets 递归列出会话全部资产，包含旧 uploads 且不依赖最近消息窗口', async () => {
  const session = 'asset-inventory';
  const assetRoot = path.join(tmpDir, session, 'assets');
  fs.mkdirSync(path.join(assetRoot, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(assetRoot, 'prototype'), { recursive: true });
  fs.writeFileSync(path.join(assetRoot, 'uploads', 'old-screen.png'), 'old-image');
  fs.writeFileSync(path.join(assetRoot, 'prototype', 'index.html'), '<h1>prototype</h1>');

  const response = await fetch(`${baseUrl}/api/assets?session=${session}`, {
    headers: authHeaders(),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.files.map((file) => file.path), [
    'prototype/index.html',
    'uploads/old-screen.png',
  ]);
  assert.deepEqual(body.files.map((file) => file.url), [
    `/assets/${session}/prototype/index.html`,
    `/assets/${session}/uploads/old-screen.png`,
  ]);
  assert.deepEqual(body.files.map((file) => file.size), [18, 9]);
});

test('POST /api/attachments 清洗危险文件名为安全 ASCII slug、时间戳和 MIME 扩展，且不能路径穿越', async () => {
  const session = 'attachment-safe-name';
  const response = await upload({
    session,
    mime: 'image/png',
    filename: '../../Evil File<script>.tar.exe',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const assetUrl = new URL(body.url, baseUrl);
  const basename = path.posix.basename(decodeURIComponent(assetUrl.pathname));

  assert.match(basename, /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{13}\.png$/);
  assert.equal(basename.includes('..'), false);
  assert.equal(basename.endsWith('.exe'), false);

  const uploadsDir = path.resolve(tmpDir, session, 'assets', 'uploads');
  const savedPath = path.resolve(uploadsDir, basename);
  assert.equal(path.dirname(savedPath), uploadsDir);
  assert.equal(fs.existsSync(savedPath), true);
  assert.deepEqual(fs.readdirSync(uploadsDir), [basename]);
  assert.equal(fs.existsSync(path.resolve(tmpDir, 'Evil File<script>.tar.exe')), false);
});
