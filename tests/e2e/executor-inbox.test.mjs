// 执行面收件箱 E2E：管理员 API、文件状态机、超时回退与事件派发分流。
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const OWNER_TOKEN = 'executor-inbox-owner-token';
const PARTICIPANT = {
  id: 'alice',
  name: '小艾',
  token: 'executor-inbox-alice-token',
  createdAt: '2026-07-24T00:00:00.000Z',
};
const ENV_KEYS = [
  'WB_WORKSPACE',
  'WORKBENCH_TOKEN',
  'WORKBENCH_EVENT_WEBHOOK',
  'WORKBENCH_INBOX_CLAIM_TIMEOUT_MS',
];
const PAYLOAD_LIMIT = 64 * 1024;

let tmpDir;
let participantsFile;
let startServer;
let projects;
let inbox;
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(check, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(10);
  }
  throw new Error('等待条件超时');
}

function authHeaders(token = OWNER_TOKEN, extra = {}) {
  return token == null
    ? { ...extra }
    : { 'x-workbench-token': token, ...extra };
}

function postJson(pathname, body, token = OWNER_TOKEN, targetBase = baseUrl) {
  return fetch(`${targetBase}${pathname}`, {
    method: 'POST',
    headers: authHeaders(token, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

function getJson(pathname, token = OWNER_TOKEN, targetBase = baseUrl) {
  return fetch(`${targetBase}${pathname}`, {
    headers: authHeaders(token),
  });
}

function taskFile(executor, id) {
  return path.join(tmpDir, 'inbox', executor, `${id}.json`);
}

function readTask(executor, id) {
  return JSON.parse(fs.readFileSync(taskFile(executor, id), 'utf8'));
}

function readStream(session) {
  const target = path.join(tmpDir, session, 'stream.jsonl');
  try {
    return fs.readFileSync(target, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function taskInput(overrides = {}) {
  return {
    executor: 'local-mac',
    session: 'inbox-basic',
    type: 'manual',
    title: '本地任务',
    payload: { instruction: '执行测试任务' },
    ...overrides,
  };
}

async function enqueue(input = taskInput(), targetBase = baseUrl) {
  const response = await postJson('/api/inbox/tasks', input, OWNER_TOKEN, targetBase);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  return body.task;
}

before(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-executor-inbox-'));
  participantsFile = path.join(tmpDir, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, `${JSON.stringify([PARTICIPANT], null, 2)}\n`, 'utf8');

  process.env.WB_WORKSPACE = tmpDir;
  process.env.WORKBENCH_TOKEN = OWNER_TOKEN;
  process.env.WORKBENCH_INBOX_CLAIM_TIMEOUT_MS = '60000';
  delete process.env.WORKBENCH_EVENT_WEBHOOK;

  ({ startServer } = await import('../../src/server/server.mjs'));
  projects = await import('../../src/projects.mjs');
  inbox = await import('../../src/executor-inbox.mjs');
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

test('inbox API 全部要求已配置的管理员口令，并拒绝畸形 executor', async () => {
  const missing = await getJson('/api/inbox/tasks?executor=local-mac', null);
  assert.equal(missing.status, 403);

  const participant = await getJson(
    '/api/inbox/tasks?executor=local-mac',
    PARTICIPANT.token,
  );
  assert.equal(participant.status, 403);

  for (const executor of ['missing-worker', '../local-mac']) {
    const response = await postJson('/api/inbox/tasks', taskInput({ executor }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /executor/);
  }

  const missingExecutor = await getJson('/api/inbox/tasks?status=pending');
  assert.equal(missingExecutor.status, 400);
});

test('入队按原子 JSON 文件保存，列表可按执行面和状态筛选', async () => {
  const task = await enqueue();

  assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.equal(task.executor, 'local-mac');
  assert.equal(task.status, 'pending');
  assert.equal(task.claimedAt, null);
  assert.equal(task.claimedBy, null);
  assert.equal(task.leaseExpiresAt, null);
  assert.equal(task.completedAt, null);
  assert.equal(task.result, null);
  assert.deepEqual(task.history, []);
  assert.ok(Number.isFinite(Date.parse(task.createdAt)));

  const target = taskFile(task.executor, task.id);
  assert.equal(fs.existsSync(target), true);
  const mode = fs.statSync(target).mode & 0o777;
  assert.equal(mode & 0o600, 0o600, '任务文件必须保留所有者读写位');
  assert.equal(mode & 0o111, 0, '任务文件不能带可执行位');
  assert.deepEqual(readTask(task.executor, task.id), task);
  assert.deepEqual(
    fs.readdirSync(path.dirname(target)).filter((name) => name.endsWith('.tmp')),
    [],
  );

  const response = await getJson('/api/inbox/tasks?executor=local-mac&status=pending');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.tasks.some(({ id }) => id === task.id));

  const sessions = await getJson('/api/sessions');
  assert.equal(sessions.status, 200);
  assert.equal((await sessions.json()).sessions.includes('inbox'), false);
});

test('external-review 只接受 review-request，不可由 pull 监听 claim，且只由服务端回传完成', async () => {
  const reviewInput = taskInput({
    executor: 'github-actions',
    session: 'paper-edit-review',
    type: 'review-request',
    title: 'GitHub PR 评审',
    payload: {
      repo: 'wangjialiang678/ai-video-paper-edit',
      branch: 'vibeloop/ticket-42',
      pr: 42,
    },
  });
  const task = await enqueue(reviewInput);
  assert.equal(task.executor, 'github-actions');
  assert.equal(task.type, 'review-request');
  assert.deepEqual(task.payload, reviewInput.payload);

  const malformed = await postJson('/api/inbox/tasks', taskInput({
    executor: 'github-actions',
    session: 'paper-edit-invalid-review',
    type: 'message-posted',
  }));
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /review-request/);

  const missingPr = await postJson('/api/inbox/tasks', taskInput({
    executor: 'github-actions',
    session: 'paper-edit-missing-pr',
    type: 'review-request',
    payload: { repo: 'owner/repo', branch: 'review-branch' },
  }));
  assert.equal(missingPr.status, 400);
  assert.match((await missingPr.json()).error, /payload\.pr/);

  const claimed = await postJson(`/api/inbox/tasks/${task.id}/claim`, {
    claimedBy: 'pull-listener',
  });
  assert.equal(claimed.status, 409);
  assert.match((await claimed.json()).error, /external-review/);
  assert.equal(readTask('github-actions', task.id).status, 'pending');

  const publicComplete = await postJson(`/api/inbox/tasks/${task.id}/complete`, {
    ok: true,
    summary: '外部执行面不得自行完成',
  });
  assert.equal(publicComplete.status, 409);
  assert.match((await publicComplete.json()).error, /external-review/);

  const completed = inbox.completeExternalReviewInboxTask(task.id, {
    ok: true,
    summary: 'Codex 未发现 P0/P1，CI 全绿',
    verdict: 'approved',
    ciStatus: 'success',
    changes: [{ file: '不得保存的代码改动' }],
  });
  assert.equal(completed.idempotent, false);
  assert.equal(completed.task.status, 'done');
  assert.deepEqual(completed.task.result, {
    ok: true,
    summary: 'Codex 未发现 P0/P1，CI 全绿',
    verdict: 'approved',
    ciStatus: 'success',
  });
  assert.equal(Object.hasOwn(completed.task.result, 'changes'), false);

  const ordinary = await enqueue(taskInput({
    session: 'ordinary-completion-boundary',
    title: '普通任务不得使用评审回传完成',
  }));
  assert.equal((await postJson(`/api/inbox/tasks/${ordinary.id}/claim`, {
    claimedBy: 'local-worker',
  })).status, 200);
  assert.throws(() => inbox.completeExternalReviewInboxTask(ordinary.id, {
    ok: true,
    summary: '不应完成普通任务',
    verdict: 'approved',
    ciStatus: 'success',
  }), /external-review/);
});

test('领取只允许 pending，完成幂等且不重复写回执', async () => {
  const task = await enqueue(taskInput({
    session: 'inbox-claim',
    title: '领取测试',
  }));

  const claimed = await postJson(`/api/inbox/tasks/${task.id}/claim`, {
    claimedBy: 'founder-mac',
  });
  assert.equal(claimed.status, 200);
  const claimedTask = (await claimed.json()).task;
  assert.equal(claimedTask.status, 'claimed');
  assert.equal(claimedTask.claimedBy, 'founder-mac');
  assert.ok(Number.isFinite(Date.parse(claimedTask.claimedAt)));
  assert.ok(Date.parse(claimedTask.leaseExpiresAt) > Date.parse(claimedTask.claimedAt));

  const repeated = await postJson(`/api/inbox/tasks/${task.id}/claim`, {
    claimedBy: 'other-listener',
  });
  assert.equal(repeated.status, 409);

  const completed = await postJson(`/api/inbox/tasks/${task.id}/complete`, {
    ok: true,
    summary: '领取测试完成',
  });
  assert.equal(completed.status, 200);
  const completedTask = (await completed.json()).task;
  assert.equal(completedTask.status, 'done');
  assert.deepEqual(completedTask.result, { ok: true, summary: '领取测试完成' });
  assert.ok(Number.isFinite(Date.parse(completedTask.completedAt)));

  const firstReceipts = readStream('inbox-claim');
  assert.equal(firstReceipts.at(-1).kind, 'receipt');
  assert.equal(firstReceipts.at(-1).text, '任务执行完成：领取测试完成');
  assert.equal(firstReceipts.at(-1).author.role, 'ai');

  const repeatedComplete = await postJson(`/api/inbox/tasks/${task.id}/complete`, {
    ok: true,
    summary: '网络重试不应再次写回执',
  });
  assert.equal(repeatedComplete.status, 200);
  const repeatedBody = await repeatedComplete.json();
  assert.equal(repeatedBody.idempotent, true);
  assert.equal(repeatedBody.task.status, 'done');
  assert.deepEqual(repeatedBody.task.result, { ok: true, summary: '领取测试完成' });
  assert.equal(readStream('inbox-claim').length, firstReceipts.length);

  const afterDone = await postJson(`/api/inbox/tasks/${task.id}/claim`, {
    claimedBy: 'founder-mac',
  });
  assert.equal(afterDone.status, 409);
});

test('renew 仅允许当前 claimedBy 续租，并把租约到期时间向后延长', async () => {
  const task = await enqueue(taskInput({
    session: 'inbox-renew',
    title: '续租测试',
  }));
  const claimed = await postJson(`/api/inbox/tasks/${task.id}/claim`, {
    claimedBy: 'founder-mac',
  });
  assert.equal(claimed.status, 200);
  const firstClaim = (await claimed.json()).task;
  const firstLease = firstClaim.leaseExpiresAt;

  const wrongWorker = await postJson(`/api/inbox/tasks/${task.id}/renew`, {
    claimedBy: 'other-listener',
  });
  assert.equal(wrongWorker.status, 409);

  await delay(5);
  const renewed = await postJson(`/api/inbox/tasks/${task.id}/renew`, {
    claimedBy: 'founder-mac',
  });
  assert.equal(renewed.status, 200);
  const renewedTask = (await renewed.json()).task;
  assert.equal(renewedTask.status, 'claimed');
  assert.equal(renewedTask.claimedAt, firstClaim.claimedAt);
  assert.ok(Date.parse(renewedTask.leaseExpiresAt) > Date.parse(firstLease));
});

test('两个 server 并发 claim 只有原子 rename 赢家成功，任务内容保持完整', async () => {
  const task = await enqueue(taskInput({
    session: 'inbox-claim-race',
    title: '并发领取',
    payload: { marker: 'claim-race-payload' },
  }));
  const secondServer = startServer(0, '127.0.0.1', { participantsFile });
  await waitForListening(secondServer);
  const secondBase = `http://127.0.0.1:${secondServer.address().port}`;

  try {
    const [left, right] = await Promise.all([
      postJson(`/api/inbox/tasks/${task.id}/claim`, {
        claimedBy: 'worker-left',
      }),
      postJson(`/api/inbox/tasks/${task.id}/claim`, {
        claimedBy: 'worker-right',
      }, OWNER_TOKEN, secondBase),
    ]);
    assert.deepEqual([left.status, right.status].sort(), [200, 409]);

    const saved = readTask('local-mac', task.id);
    assert.equal(saved.status, 'claimed');
    assert.equal(saved.payload.marker, 'claim-race-payload');
    assert.ok(['worker-left', 'worker-right'].includes(saved.claimedBy));
    assert.equal(
      fs.readdirSync(path.dirname(taskFile('local-mac', task.id)))
        .some((name) => name.includes(`${task.id}.claim-`)),
      false,
    );
  } finally {
    await closeServer(secondServer);
  }
});

test('失败完成写 failed 状态，并向原 session 写 AI message', async () => {
  const task = await enqueue(taskInput({
    session: 'inbox-failed',
    title: '失败测试',
  }));
  assert.equal((await postJson(`/api/inbox/tasks/${task.id}/claim`, {
    claimedBy: 'founder-mac',
  })).status, 200);

  const response = await postJson(`/api/inbox/tasks/${task.id}/complete`, {
    ok: false,
    summary: '本地依赖不可用',
  });
  assert.equal(response.status, 200);
  const saved = (await response.json()).task;
  assert.equal(saved.status, 'failed');
  assert.deepEqual(saved.result, { ok: false, summary: '本地依赖不可用' });

  const messages = readStream('inbox-failed');
  assert.equal(messages.at(-1).kind, 'message');
  assert.equal(messages.at(-1).text, '任务执行失败：本地依赖不可用');
});

test('payload 按 JSON UTF-8 字节允许恰好 64 KiB，超过一字节返回 413', async () => {
  const exact = 'x'.repeat(PAYLOAD_LIMIT - 2);
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), PAYLOAD_LIMIT);
  const accepted = await postJson('/api/inbox/tasks', taskInput({
    session: 'payload-exact',
    payload: exact,
  }));
  assert.equal(accepted.status, 201);

  const over = 'x'.repeat(PAYLOAD_LIMIT - 1);
  assert.equal(Buffer.byteLength(JSON.stringify(over)), PAYLOAD_LIMIT + 1);
  const rejected = await postJson('/api/inbox/tasks', taskInput({
    session: 'payload-over',
    payload: over,
  }));
  assert.equal(rejected.status, 413);
  assert.match((await rejected.json()).error, /64 KiB|payload/i);
});

test('短时限 server 会自动把超时 claimed 回退 pending，并记录任务历史', async () => {
  const previousTimeout = process.env.WORKBENCH_INBOX_CLAIM_TIMEOUT_MS;
  process.env.WORKBENCH_INBOX_CLAIM_TIMEOUT_MS = '250';
  const shortServer = startServer(0, '127.0.0.1', { participantsFile });
  process.env.WORKBENCH_INBOX_CLAIM_TIMEOUT_MS = previousTimeout;
  await waitForListening(shortServer);
  const shortBase = `http://127.0.0.1:${shortServer.address().port}`;

  try {
    const task = await enqueue(taskInput({
      session: 'inbox-timeout',
      title: '超时回退测试',
    }), shortBase);
    const claimed = await postJson(
      `/api/inbox/tasks/${task.id}/claim`,
      { claimedBy: 'temporary-listener' },
      OWNER_TOKEN,
      shortBase,
    );
    assert.equal(claimed.status, 200);

    await waitUntil(() => {
      try { return readTask('local-mac', task.id).status === 'pending'; } catch { return false; }
    }, 2000);

    const saved = readTask('local-mac', task.id);
    assert.equal(saved.status, 'pending');
    assert.equal(saved.claimedAt, null);
    assert.equal(saved.claimedBy, null);
    assert.equal(saved.leaseExpiresAt, null);
    assert.equal(saved.history.at(-1).event, 'claim-expired');
    assert.equal(saved.history.at(-1).claimedBy, 'temporary-listener');

    const interrupted = await enqueue(taskInput({
      session: 'inbox-interrupted-claim',
      title: 'rename 后崩溃恢复',
    }), shortBase);
    const interruptedPath = taskFile('local-mac', interrupted.id);
    fs.renameSync(
      interruptedPath,
      path.join(
        path.dirname(interruptedPath),
        `${interrupted.id}.claim-${Date.now() - 1000}-deadbeef.json`,
      ),
    );
    await waitUntil(() => fs.existsSync(interruptedPath), 2000);
    const recoveredPending = readTask('local-mac', interrupted.id);
    assert.equal(recoveredPending.status, 'pending');
    assert.equal(recoveredPending.history.at(-1).event, 'claim-expired');

    const terminal = await enqueue(taskInput({
      session: 'inbox-terminal-recovery',
      title: '终态崩溃恢复',
    }), shortBase);
    assert.equal((await postJson(
      `/api/inbox/tasks/${terminal.id}/claim`,
      { claimedBy: 'terminal-worker' },
      OWNER_TOKEN,
      shortBase,
    )).status, 200);
    assert.equal((await postJson(
      `/api/inbox/tasks/${terminal.id}/complete`,
      { ok: true, summary: '终态不得回退' },
      OWNER_TOKEN,
      shortBase,
    )).status, 200);
    const terminalPath = taskFile('local-mac', terminal.id);
    fs.renameSync(
      terminalPath,
      path.join(
        path.dirname(terminalPath),
        `${terminal.id}.claim-${Date.now() - 1000}-cafebabe.json`,
      ),
    );
    await waitUntil(() => fs.existsSync(terminalPath), 2000);
    const recoveredTerminal = readTask('local-mac', terminal.id);
    assert.equal(recoveredTerminal.status, 'done');
    assert.deepEqual(recoveredTerminal.result, { ok: true, summary: '终态不得回退' });
  } finally {
    await closeServer(shortServer);
  }
});

test('事件派发：resident 与无归属会话照旧走 webhook，pull 三类事件只入队并写 progress', async () => {
  projects.writeProjectRegistry({
    version: 1,
    projects: [
      {
        id: 'resident-project',
        displayName: '云端项目',
        executor: 'cloud-codex',
        aliases: ['resident-dispatch'],
      },
      {
        id: 'local-project',
        displayName: '本地项目',
        executor: 'local-mac',
        aliases: ['local-dispatch'],
      },
    ],
  });

  const received = [];
  const webhookServer = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(raw));
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
  process.env.WORKBENCH_EVENT_WEBHOOK = previousWebhook;
  await waitForListening(eventServer);
  const eventBase = `http://127.0.0.1:${eventServer.address().port}`;

  try {
    assert.equal((await postJson('/api/messages', {
      session: 'resident-dispatch',
      text: '云端继续处理',
    }, OWNER_TOKEN, eventBase)).status, 200);
    assert.equal((await postJson('/api/messages', {
      session: 'unowned-dispatch',
      text: '无归属兼容处理',
    }, OWNER_TOKEN, eventBase)).status, 200);
    assert.equal((await postJson('/api/messages', {
      session: 'local-dispatch',
      text: '交给本地处理',
    }, OWNER_TOKEN, eventBase)).status, 200);

    const round = await postJson('/api/rounds', {
      session: 'local-dispatch',
      title: '本地评审',
      blocks: [{ id: 'overview', type: 'markdown', body: '请本地继续。' }],
    }, OWNER_TOKEN, eventBase);
    assert.equal(round.status, 200);
    assert.equal((await postJson('/api/feedback', {
      session: 'local-dispatch',
      round: 1,
      items: [],
    }, OWNER_TOKEN, eventBase)).status, 200);

    await waitUntil(() => received.length >= 2);
    await delay(100);

    assert.deepEqual(
      received.map(({ session }) => session).sort(),
      ['resident-dispatch', 'unowned-dispatch'],
    );

    const listed = await getJson(
      '/api/inbox/tasks?executor=local-mac&status=pending',
      OWNER_TOKEN,
      eventBase,
    );
    assert.equal(listed.status, 200);
    const localTasks = (await listed.json()).tasks
      .filter(({ session }) => session === 'local-dispatch');
    assert.deepEqual(
      localTasks.map(({ type }) => type).sort(),
      ['feedback-submitted', 'message-posted', 'round-presented'],
    );
    assert.ok(localTasks.every(({ payload }) => payload.session === 'local-dispatch'));

    const progress = readStream('local-dispatch')
      .filter(({ kind }) => kind === 'progress');
    assert.equal(progress.length, 3);
    assert.ok(progress.every(({ text }) => text.startsWith('已入队待本地执行：')));
    assert.equal(
      readStream('resident-dispatch').some(({ kind }) => kind === 'progress'),
      false,
    );
  } finally {
    await closeServer(eventServer);
    await closeServer(webhookServer);
  }
});
