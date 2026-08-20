import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const OWNER_TOKEN = 'self-report-owner-token';
const PARTICIPANTS = [
  {
    id: 'alice',
    name: '小艾',
    token: 'self-report-alice-token',
    createdAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'bob',
    name: '小波',
    token: 'self-report-bob-token',
    createdAt: '2026-08-20T00:00:01.000Z',
  },
];

let server;
let baseUrl;
let tmpDir;
let participantsFile;
let paths;
let readJSON;
let writeJSON;
let writeStatus;
let readStreamEntries;
let startServer;
const savedEnv = {};

function authHeaders(token = OWNER_TOKEN) {
  return {
    'content-type': 'application/json',
    'x-workbench-token': token,
  };
}

async function post(pathname, body, token = OWNER_TOKEN) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
}

function seedRound(session) {
  writeJSON(paths.content(session, 1, { exactSession: true }), {
    session,
    round: 1,
    title: '共享链接评审',
    blocks: [{ id: 'overview', type: 'markdown', body: '请评审。' }],
  });
  writeStatus(session, { state: 'rendered', round: 1 }, undefined, { exactSession: true });
}

before(async () => {
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) {
    savedEnv[key] = process.env[key];
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-self-report-e2e-'));
  participantsFile = path.join(tmpDir, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, `${JSON.stringify(PARTICIPANTS, null, 2)}\n`, 'utf8');
  process.env.WB_WORKSPACE = tmpDir;
  process.env.WORKBENCH_TOKEN = OWNER_TOKEN;
  delete process.env.WORKBENCH_EVENT_WEBHOOK;

  ({ paths, readJSON, writeJSON, writeStatus } = await import('../../src/workspace.mjs'));
  ({ readStreamEntries } = await import('../../src/stream.mjs'));
  ({ startServer } = await import('../../src/server/server.mjs'));
  server = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('owner 自报身份提交反馈：可信身份不变，自报进入主文件、历史件与 receipt', async () => {
  const session = 'self-report-owner-feedback';
  seedRound(session);
  const response = await post('/api/feedback', {
    session,
    round: 1,
    items: [],
    submittedBy: { id: 'forged', name: '伪造身份' },
    selfReport: { id: 'alice', name: '小艾 / QA' },
  });
  assert.equal(response.status, 200);

  const saved = readJSON(paths.feedback(session, 1, { exactSession: true }));
  assert.deepEqual(saved.submittedBy, { id: 'owner', name: '管理员' });
  assert.deepEqual(saved.selfReportedBy, { id: 'alice', name: '小艾 / QA' });
  assert.equal(Object.hasOwn(saved, 'selfReport'), false);

  const historyDir = path.join(path.dirname(paths.feedback(session, 1, { exactSession: true })), 'feedback-history');
  const historyFiles = fs.readdirSync(historyDir);
  assert.equal(historyFiles.length, 1);
  assert.match(historyFiles[0], /-owner-小艾-QA\.json$/u);
  const history = readJSON(path.join(historyDir, historyFiles[0]));
  assert.deepEqual(history.selfReportedBy, { id: 'alice', name: '小艾 / QA' });
  assert.deepEqual(history.submittedBy, { id: 'owner', name: '管理员' });

  const receipt = readStreamEntries(session, { exactSession: true }).at(-1);
  assert.equal(receipt.text, '小艾 / QA（共享链接）已提交第 1 轮反馈');
  assert.deepEqual(receipt.selfReportedBy, { id: 'alice', name: '小艾 / QA' });
});

test('owner 明确匿名提交：反馈可保存且不产生 selfReportedBy', async () => {
  const session = 'self-report-owner-anonymous';
  seedRound(session);
  const response = await post('/api/feedback', {
    session,
    round: 1,
    items: [],
  });
  assert.equal(response.status, 200);

  const saved = readJSON(paths.feedback(session, 1, { exactSession: true }));
  assert.deepEqual(saved.submittedBy, { id: 'owner', name: '管理员' });
  assert.equal(Object.hasOwn(saved, 'selfReportedBy'), false);
  assert.equal(Object.hasOwn(saved, 'selfReport'), false);
  const receipt = readStreamEntries(session, { exactSession: true }).at(-1);
  assert.equal(receipt.text, '管理员 已提交第 1 轮反馈');
  assert.equal(Object.hasOwn(receipt, 'selfReportedBy'), false);
});

test('owner 自报 name 超过 40 字符返回 400', async () => {
  const session = 'self-report-name-limit';
  seedRound(session);
  const response = await post('/api/feedback', {
    session,
    round: 1,
    items: [],
    selfReport: { name: '甲'.repeat(41) },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /1~40/);
  assert.equal(fs.existsSync(paths.feedback(session, 1, { exactSession: true })), false);
});

test('participant 夹带 selfReport 一律忽略，实名链接身份与原流程不变', async () => {
  const session = 'self-report-participant-ignored';
  seedRound(session);
  const response = await post('/api/feedback', {
    session,
    round: 1,
    items: [],
    selfReport: { id: 'bob', name: '不应落盘'.repeat(20) },
  }, PARTICIPANTS[0].token);
  assert.equal(response.status, 200, 'participant 的非法自报字段也应直接忽略');

  const saved = readJSON(paths.participantFeedback(
    session,
    1,
    PARTICIPANTS[0].id,
    { exactSession: true },
  ));
  assert.deepEqual(saved.submittedBy, { id: 'alice', name: '小艾' });
  assert.equal(Object.hasOwn(saved, 'selfReportedBy'), false);
  assert.equal(Object.hasOwn(saved, 'selfReport'), false);
  const receipt = readStreamEntries(session, { exactSession: true }).at(-1);
  assert.equal(receipt.text, '小艾 已提交第 1 轮反馈');
  assert.equal(Object.hasOwn(receipt, 'selfReportedBy'), false);
});

test('GET /api/participants-public：owner 与 participant 均可读且绝不泄漏 token', async () => {
  for (const token of [OWNER_TOKEN, PARTICIPANTS[0].token]) {
    const response = await fetch(`${baseUrl}/api/participants-public?session=public-roster`, {
      headers: { 'x-workbench-token': token },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, PARTICIPANTS.map(({ id, name }) => ({ id, name })));
    assert.equal(JSON.stringify(body).includes('token'), false);
    for (const participant of PARTICIPANTS) {
      assert.equal(JSON.stringify(body).includes(participant.token), false);
    }
  }
});

test('留言自报身份独立于 author；未知 id 被丢弃且 participant 夹带字段仍忽略', async () => {
  const session = 'self-report-messages';
  const ownerResponse = await post('/api/messages', {
    session,
    text: '共享链接留言',
    selfReport: { id: 'missing-id', name: '外部顾问' },
  });
  assert.equal(ownerResponse.status, 200);
  const ownerEntry = (await ownerResponse.json()).entry;
  assert.deepEqual(ownerEntry.author, { id: 'owner', name: '管理员', role: 'owner' });
  assert.deepEqual(ownerEntry.selfReportedBy, { name: '外部顾问' });

  const participantResponse = await post('/api/messages', {
    session,
    text: '实名链接留言',
    selfReport: { id: 'bob', name: '甲'.repeat(41) },
  }, PARTICIPANTS[0].token);
  assert.equal(participantResponse.status, 200);
  const participantEntry = (await participantResponse.json()).entry;
  assert.deepEqual(participantEntry.author, {
    id: 'alice',
    name: '小艾',
    role: 'participant',
  });
  assert.equal(Object.hasOwn(participantEntry, 'selfReportedBy'), false);

  const entries = readStreamEntries(session, { exactSession: true });
  assert.deepEqual(entries[0].selfReportedBy, { name: '外部顾问' });
  assert.equal(Object.hasOwn(entries[1], 'selfReportedBy'), false);
});

test('feedback-submitted 与 message-posted 事件都携带 selfReportedBy', async () => {
  const received = [];
  let resolveReceived;
  const receivedBoth = new Promise((resolve) => { resolveReceived = resolve; });
  const webhookServer = http.createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      received.push(JSON.parse(raw));
      response.writeHead(204);
      response.end();
      if (received.length === 2) resolveReceived();
    });
  });
  webhookServer.listen(0, '127.0.0.1');
  await new Promise((resolve) => webhookServer.once('listening', resolve));

  const previousWebhook = process.env.WORKBENCH_EVENT_WEBHOOK;
  process.env.WORKBENCH_EVENT_WEBHOOK =
    `http://127.0.0.1:${webhookServer.address().port}/events`;
  const eventServer = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => eventServer.once('listening', resolve));
  if (previousWebhook == null) delete process.env.WORKBENCH_EVENT_WEBHOOK;
  else process.env.WORKBENCH_EVENT_WEBHOOK = previousWebhook;

  try {
    const eventBase = `http://127.0.0.1:${eventServer.address().port}`;
    const session = 'self-report-events';
    seedRound(session);
    const request = (pathname, body) => fetch(`${eventBase}${pathname}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal((await request('/api/feedback', {
      session,
      round: 1,
      items: [],
      selfReport: { id: 'bob', name: '小波' },
    })).status, 200);
    assert.equal((await request('/api/messages', {
      session,
      text: '事件里的实名留言',
      selfReport: { name: '客户代表' },
    })).status, 200);

    await Promise.race([
      receivedBoth,
      new Promise((_, reject) => setTimeout(() => reject(new Error('等待自报身份事件超时')), 1000)),
    ]);
    assert.deepEqual(
      received.find((event) => event.event === 'feedback-submitted').selfReportedBy,
      { id: 'bob', name: '小波' },
    );
    assert.deepEqual(
      received.find((event) => event.event === 'message-posted').selfReportedBy,
      { name: '客户代表' },
    );
  } finally {
    await new Promise((resolve) => eventServer.close(resolve));
    await new Promise((resolve) => webhookServer.close(resolve));
  }
});
