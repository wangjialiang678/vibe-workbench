import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateBlock } from '../../src/protocol/schema.mjs';
import { paths, readJSON, writeJSON, writeStatus } from '../../src/workspace.mjs';
import { startServer } from '../../src/server/server.mjs';

const OWNER_TOKEN = 'owner-visibility-token';
const PARTICIPANTS = [
  { id: 'alice', name: '小艾', token: 'alice-visibility-token', createdAt: '2026-07-25T00:00:00.000Z' },
  { id: 'bob', name: '小波', token: 'bob-visibility-token', createdAt: '2026-07-25T00:00:01.000Z' },
];

let server;
let baseUrl;
let workspace;
let participantsFile;
const savedEnv = {};

before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-block-visibility-'));
  participantsFile = path.join(workspace, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, JSON.stringify(PARTICIPANTS, null, 2));

  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN']) savedEnv[key] = process.env[key];
  process.env.WB_WORKSPACE = workspace;
  process.env.WORKBENCH_TOKEN = OWNER_TOKEN;

  server = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(workspace, { recursive: true, force: true });
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN']) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function contentFor(session, blocks) {
  writeJSON(paths.content(session, 1, { exactSession: true }), {
    session,
    round: 1,
    prevRound: 0,
    blocks,
  });
  writeStatus(session, { state: 'rendered', round: 1 }, undefined, { exactSession: true });
}

async function getContent(session, token = OWNER_TOKEN) {
  const response = await fetch(`${baseUrl}/api/content?session=${session}&round=1`, {
    headers: { 'x-workbench-token': token },
  });
  return { response, body: await response.json() };
}

async function postFeedback(session, token, items) {
  const response = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-workbench-token': token,
    },
    body: JSON.stringify({ session, round: 1, items }),
  });
  return { response, body: await response.json() };
}

test('validateBlock：assignee 省略、null、空串和非空字符串均按契约处理', () => {
  assert.equal(validateBlock({ id: 'public', type: 'markdown' }).ok, true);
  assert.equal(validateBlock({ id: 'null', type: 'markdown', assignee: null }).ok, true);
  assert.equal(validateBlock({ id: 'empty', type: 'markdown', assignee: '' }).ok, true);
  assert.equal(validateBlock({ id: 'alice', type: 'markdown', assignee: 'alice' }).ok, true);
});

test('validateBlock：assignee 有值时拒绝非字符串和空白字符串', () => {
  for (const assignee of [42, true, {}, [], '   ']) {
    const result = validateBlock({ id: 'invalid', type: 'markdown', assignee });
    assert.equal(result.ok, false, `assignee=${JSON.stringify(assignee)} 应被拒绝`);
    assert.ok(result.errors.some((error) => error.includes('assignee')));
  }
});

test('owner 看到全部块', async () => {
  const session = 'visibility-owner';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'alice-only', type: 'markdown', body: '给小艾的内容', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await getContent(session);
  assert.equal(response.status, 200);
  assert.deepEqual(body.blocks.map((block) => block.id), ['public', 'alice-only', 'bob-only']);
});

test('participant 只看到公共块和指派给自己的块', async () => {
  const session = 'visibility-alice';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'alice-only', type: 'markdown', body: '给小艾的内容', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await getContent(session, 'alice-visibility-token');
  assert.equal(response.status, 200);
  assert.deepEqual(body.blocks.map((block) => block.id), ['public', 'alice-only']);
  assert.doesNotMatch(JSON.stringify(body), /给小波的内容/);
});

test('participant 看不到指派给别人的块', async () => {
  const session = 'visibility-bob';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'alice-only', type: 'markdown', body: '给小艾的秘密', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await getContent(session, 'bob-visibility-token');
  assert.equal(response.status, 200);
  assert.deepEqual(body.blocks.map((block) => block.id), ['public', 'bob-only']);
  assert.doesNotMatch(JSON.stringify(body), /alice-only|给小艾的秘密/);
});

test('participant 对不可见块提交反馈被拒绝', async () => {
  const session = 'visibility-write';
  contentFor(session, [
    { id: 'public', type: 'markdown', body: '公共内容' },
    { id: 'bob-only', type: 'markdown', body: '给小波的内容', assignee: 'bob' },
  ]);

  const { response, body } = await postFeedback(session, 'alice-visibility-token', [
    { blockId: 'bob-only', type: 'select', value: 'reject' },
  ]);
  assert.ok([400, 403].includes(response.status));
  assert.equal(body.ok, false);
  assert.match(body.error, /不可见|不可访问|visibility/i);
  assert.equal(fs.existsSync(paths.participantFeedback(session, 1, 'alice', { exactSession: true })), false);
  assert.equal(readJSON(paths.status(session, { exactSession: true })).state, 'rendered');
});

test('老内容无 assignee 字段时所有人可见', async () => {
  const session = 'visibility-legacy';
  contentFor(session, [
    { id: 'legacy-a', type: 'markdown', body: '旧内容 A' },
    { id: 'legacy-b', type: 'markdown', body: '旧内容 B' },
  ]);

  const owner = await getContent(session, OWNER_TOKEN);
  const alice = await getContent(session, 'alice-visibility-token');
  assert.deepEqual(owner.body.blocks.map((block) => block.id), ['legacy-a', 'legacy-b']);
  assert.deepEqual(alice.body.blocks.map((block) => block.id), ['legacy-a', 'legacy-b']);
});

test('只读互见：甲可见块上乙的意见仍然显示，隐藏块意见不泄漏', async () => {
  const session = 'visibility-cross-feedback';
  contentFor(session, [
    { id: 'shared', type: 'markdown', body: '甲乙都可见' },
    { id: 'alice-only', type: 'markdown', body: '甲可见', assignee: 'alice' },
    { id: 'bob-only', type: 'markdown', body: '乙可见', assignee: 'bob' },
  ]);

  assert.equal((await postFeedback(session, 'alice-visibility-token', [
    { blockId: 'shared', type: 'select', value: 'alice-choice' },
    { blockId: 'alice-only', type: 'text', value: '甲的意见' },
  ])).response.status, 200);
  assert.equal((await postFeedback(session, 'bob-visibility-token', [
    { blockId: 'shared', type: 'select', value: 'bob-choice' },
    { blockId: 'bob-only', type: 'text', value: '乙的私有意见' },
  ])).response.status, 200);

  const response = await fetch(`${baseUrl}/api/feedback?session=${session}&round=1`, {
    headers: { 'x-workbench-token': 'alice-visibility-token' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const bob = body.byParticipant.find((entry) => entry.id === 'bob');
  assert.ok(bob);
  assert.deepEqual(bob.feedback.items.map((item) => item.blockId), ['shared']);
  assert.equal(bob.feedback.items[0].value, 'bob-choice');
  assert.deepEqual(body.conflicts, [{
    blockId: 'shared',
    choices: [
      { participant: '小艾', value: 'alice-choice' },
      { participant: '小波', value: 'bob-choice' },
    ],
  }]);
});
