// 第 4 期：所有 driver 都是本地假实现；本文件不发网络请求、不使用真实凭据。
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

let root;
let ws;
let loop;
let drivers;
let startServer;
let resident;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cloud-ai-e2e-'));
  process.env.WB_WORKSPACE = root;
  ws = await import('../../src/storage/index.mjs');
  loop = await import('../../src/loop/listener.mjs');
  drivers = await import('../../src/loop/agent-exec.mjs');
  resident = await import('../../scripts/resident-worker.mjs');
  ({ startServer } = await import('../../src/server/server.mjs'));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.WB_WORKSPACE;
});

function seed(session) {
  ws.createRound(session, { title: 'seed', blocks: [{ id: 'm', type: 'markdown', body: 'seed' }] }, { exactSession: true });
  ws.writeJSON(ws.paths.feedback(session, 1, { exactSession: true }), { session, round: 1, items: [{ blockId: 'm', value: 'ok' }] });
  ws.writeStatus(session, { state: 'submitted', round: 1 }, undefined, { exactSession: true });
}

function fakeSpawn(calls) {
  return (_command, argv, options) => {
    calls.push({ argv, env: options.env });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.end(`${JSON.stringify({ type: 'result', session_id: 'claude-resume', result: 'done' })}\n`);
      child.emit('close', 0);
    });
    return child;
  };
}

async function withServer(env, fn) {
  const server = startServer(0, '127.0.0.1', { env: { ...process.env, WORKBENCH_TOKEN: 'cloud-test', ...env } });
  await new Promise((resolve) => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('默认关态不启动 listener；on 态假 driver 全链路写 ack/response/下一轮', async () => {
  assert.equal(loop.startListener({ env: {} }).enabled, false);
  const session = 'cloud-full-loop'; seed(session);
  const seen = [];
  const result = await loop.reconcile({ workerId: 'fake-a', driver: { async process(input) {
    seen.push(input);
    return { text: '假 driver 已处理', sessionId: 'fake-session', content: { title: '下一轮', blocks: [{ id: 'next', type: 'markdown', body: 'local fake only' }] } };
  } } });
  assert.deepEqual(result.map((item) => item.status), ['responded']);
  assert.equal(seen[0].session, session);
  assert.ok(ws.exists(ws.paths.ack(session, 1, { exactSession: true })));
  assert.equal(ws.readText(ws.paths.response(session, 1, { exactSession: true })).includes('假 driver'), true);
  assert.equal(ws.latestRound(session, { exactSession: true }), 2);
});

test('rename claim 并发只有一个赢家；过期租约可由冷启动 reconcile 接管；失败落 error', async () => {
  const concurrent = 'cloud-claim-race'; seed(concurrent);
  let calls = 0;
  const fake = async () => { calls += 1; return { text: 'once' }; };
  const race = await Promise.all([loop.processRound(concurrent, 1, { driver: fake, workerId: 'left' }), loop.processRound(concurrent, 1, { driver: fake, workerId: 'right' })]);
  assert.equal(calls, 1); assert.equal(race.filter((item) => item.status === 'responded').length, 1);

  const takeover = 'cloud-cold-start'; seed(takeover);
  ws.writeJSON(ws.paths.ack(takeover, 1, { exactSession: true }), { owner: 'dead', leaseExpiresAt: '2000-01-01T00:00:00.000Z' });
  await loop.reconcile({ driver: async () => ({ text: 'taken over' }), workerId: 'cold' });
  assert.equal(ws.readText(ws.paths.response(takeover, 1, { exactSession: true })), 'taken over');

  const failed = 'cloud-driver-failed'; seed(failed);
  await loop.processRound(failed, 1, { driver: async () => { throw { kind: 'driver', message: 'fake failure' }; } });
  assert.equal(ws.readStatus(failed, { exactSession: true }).state, 'error');
  assert.equal(ws.readJSON(ws.paths.error(failed, 1, { exactSession: true })).message, 'fake failure');
});

test('统一开关：inbox off=503、on 可入队；控制塔明确未启用', async () => {
  await withServer({ WB_CLOUD_AI: 'off' }, async (base) => {
    const response = await fetch(`${base}/api/inbox/tasks`, { method: 'POST', headers: { 'x-workbench-token': 'cloud-test', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /未启用/);
    const tower = await fetch(`${base}/api/control-tower`, { headers: { 'x-workbench-token': 'cloud-test' } }).then((item) => item.json());
    assert.equal(tower.health.execution.cloudWorker.state, '未启用');
  });
  await withServer({ WB_CLOUD_AI: 'on' }, async (base) => {
    const response = await fetch(`${base}/api/inbox/tasks`, { method: 'POST', headers: { 'x-workbench-token': 'cloud-test', 'content-type': 'application/json' }, body: JSON.stringify({ executor: 'local-mac', session: 'cloud-inbox', type: 'manual', title: 'fake queue', payload: {} }) });
    assert.equal(response.status, 201);
  });
});

test('Anthropic 凭据契约：订阅移除 key，apikey 只由 resolver 注入且不泄漏', async () => {
  const subscription = [];
  const sub = drivers.createWorkbenchContinueDriver({ env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'secret-sub', WB_CLOUD_AI_AUTH: 'subscription' }, spawnImpl: fakeSpawn(subscription) });
  await sub.process({ prompt: 'continue', sessionId: 'old-session' });
  assert.ok(subscription[0].argv.includes('-p')); assert.ok(subscription[0].argv.includes('--resume'));
  assert.equal(Object.hasOwn(subscription[0].env, 'ANTHROPIC_API_KEY'), false);

  const keyed = [];
  const api = drivers.createWorkbenchContinueDriver({ env: { PATH: process.env.PATH, WB_CLOUD_AI_AUTH: 'apikey' }, vaultResolver: () => 'vault-secret-123', spawnImpl: fakeSpawn(keyed) });
  await api.process({ prompt: 'continue', sessionId: 'old-session' });
  assert.equal(keyed[0].env.ANTHROPIC_API_KEY, 'vault-secret-123');
  const missing = drivers.createWorkbenchContinueDriver({ env: { PATH: process.env.PATH, WB_CLOUD_AI_AUTH: 'apikey' }, vaultResolver: () => '' });
  await assert.rejects(missing.process({ prompt: 'x', sessionId: null }), (error) => error.kind === 'auth' && /凭据/.test(error.message));
  assert.equal(JSON.stringify(ws.readStatus('cloud-driver-failed', { exactSession: true })).includes('vault-secret-123'), false);
});

test('code-exec 可注入且不受 Anthropic 开关影响；关闭 resident loop 不会认领', async () => {
  let captured;
  const codeExec = resident.createCodeExecDriver({
    run(prompt, options) { captured = { prompt, options }; return Promise.resolve({ exitCode: 0, stdout: '' }); },
    options: { model: 'fake-codex', auth: 'own-codex-login' },
  });
  await codeExec.process({ prompt: 'fake code task', memory: 'ignored', cwd: '/tmp/fake-project' });
  assert.equal(captured.prompt, 'fake code task');
  assert.equal(captured.options.cwd, '/tmp/fake-project');
  assert.equal(captured.options.auth, 'own-codex-login');
  const off = await resident.runWorkerLoop({ cloudAiEnabled: false }, {
    logger: { log() {} },
    runOnceImpl: () => { throw new Error('disabled worker must not run'); },
  });
  assert.deepEqual(off, { enabled: false });
});
