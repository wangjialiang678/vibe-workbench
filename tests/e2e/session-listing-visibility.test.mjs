// 跨客户信息泄漏守卫（2026-08-30 Opus 评审发现，已核实为真）：
// /api/sessions 与 /api/projects 曾对任何持 token 者返回全部会话名，
// 思锐客户能在下拉框看到你别家客户的会话名。参与者 token 不绑定具体会话，
// 会话总清单是 owner 专属；参与者应拿到空清单（靠直达链接进入自己的会话）。
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OWNER_TOKEN = 'listing-owner-token';
const PARTICIPANTS = [
  { id: 'guest', name: '外部评审', token: 'listing-guest-token', createdAt: '2026-08-30T00:00:00.000Z' },
];

let server;
let baseUrl;
let tmpDir;
let participantsFile;
let paths;
let writeJSON;
let writeStatus;
let startServer;
const savedEnv = {};

function seedRound(session, title) {
  writeJSON(paths.content(session, 1, { exactSession: true }), {
    session, round: 1, title, blocks: [{ id: 'b1', type: 'markdown', body: 'x' }],
  });
  writeStatus(session, { state: 'rendered', round: 1 }, undefined, { exactSession: true });
}

async function getJson(pathname, token) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    headers: token ? { 'x-workbench-token': token } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) savedEnv[key] = process.env[key];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-listing-e2e-'));
  participantsFile = path.join(tmpDir, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, `${JSON.stringify(PARTICIPANTS, null, 2)}\n`, 'utf8');
  process.env.WB_WORKSPACE = tmpDir;
  process.env.WORKBENCH_TOKEN = OWNER_TOKEN;
  delete process.env.WORKBENCH_EVENT_WEBHOOK;

  ({ paths, writeJSON, writeStatus } = await import('../../src/workspace.mjs'));
  ({ startServer } = await import('../../src/server/server.mjs'));
  server = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 两个"不同客户"的会话
  seedRound('client-sirui', '思锐 TMS 需求评审');
  seedRound('client-acme', 'ACME 内部方案');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const key of ['WB_WORKSPACE', 'WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('owner 能看到全部会话清单', async () => {
  const { status, body } = await getJson('/api/sessions', OWNER_TOKEN);
  assert.equal(status, 200);
  assert.ok(body.sessions.includes('client-sirui'));
  assert.ok(body.sessions.includes('client-acme'));
});

test('参与者 /api/sessions 拿到空清单——不泄漏任何会话名', async () => {
  const { status, body } = await getJson('/api/sessions', 'listing-guest-token');
  assert.equal(status, 200);
  assert.deepEqual(body.sessions, []);
});

test('参与者 /api/projects 拿到空目录——不泄漏任何客户标题', async () => {
  const { status, body } = await getJson('/api/projects', 'listing-guest-token');
  assert.equal(status, 200);
  const blob = JSON.stringify(body);
  assert.ok(!blob.includes('思锐'), 'projects 响应不得含其他客户标题');
  assert.ok(!blob.includes('ACME'), 'projects 响应不得含其他客户标题');
  assert.deepEqual(body.projects, []);
});

test('owner /api/projects 仍返回完整目录（本机功能不受影响）', async () => {
  const { status, body } = await getJson('/api/projects', OWNER_TOKEN);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.sessions));
});
