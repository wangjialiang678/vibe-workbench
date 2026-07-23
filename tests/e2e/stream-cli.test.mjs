import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cmdWait } from '../../bin/workbench.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'workbench.mjs');
const ENV_KEYS = ['WB_WORKSPACE', 'WORKBENCH_REMOTE_URL', 'WORKBENCH_TOKEN'];

let tmpDir;
const savedEnv = new Map();

before(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-stream-cli-'));
  process.env.WB_WORKSPACE = tmpDir;
  delete process.env.WORKBENCH_REMOTE_URL;
  delete process.env.WORKBENCH_TOKEN;
});

after(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function appendStreamLine(session, entry) {
  const file = path.join(tmpDir, session, 'stream.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

function streamEntry({
  id,
  at,
  text,
  author = { id: 'owner', name: '管理员', role: 'owner' },
}) {
  return { id, at, author, kind: 'message', text };
}

async function withRemoteUrl(baseUrl, fn) {
  const previousUrl = process.env.WORKBENCH_REMOTE_URL;
  const previousToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_REMOTE_URL = baseUrl;
  delete process.env.WORKBENCH_TOKEN;
  try {
    return await fn();
  } finally {
    if (previousUrl == null) delete process.env.WORKBENCH_REMOTE_URL;
    else process.env.WORKBENCH_REMOTE_URL = previousUrl;
    if (previousToken == null) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = previousToken;
  }
}

async function startJsonServer(handler) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req))
      .then(({ status = 200, body }) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      })
      .catch((error) => {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        WB_WORKSPACE: tmpDir,
        WORKBENCH_REMOTE_URL: '',
        WORKBENCH_TOKEN: '',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

test('本地 cmdWait events:true 忽略启动前历史，并被启动后新消息唤醒', async () => {
  const session = 'local-stream-wait';
  const history = streamEntry({
    id: 'history-local',
    at: '2026-07-23T01:00:00.000Z',
    text: '启动前的历史消息',
  });
  const message = streamEntry({
    id: 'new-local',
    at: '2026-07-23T01:00:01.000Z',
    text: '启动后追加的新消息',
    author: { id: 'alice', name: '小艾', role: 'participant' },
  });
  appendStreamLine(session, history);

  let now = 0;
  let appended = false;
  const result = await cmdWait(session, 2, {
    events: true,
    timeoutMs: 100,
    intervalMs: 10,
    nowFn: () => now,
    sleepFn: async (ms) => {
      if (!appended) {
        appendStreamLine(session, message);
        appended = true;
      }
      now += ms;
    },
  });

  assert.equal(appended, true, '新消息必须在 wait 启动后的 sleepFn 中追加');
  assert.deepEqual(result, {
    ok: true,
    event: 'message',
    session,
    round: 2,
    message,
  });
});

test('cmdWait 默认 events:false 保持既有 feedback 返回结构', async () => {
  const session = 'local-feedback-compatible';
  const feedback = {
    session,
    round: 1,
    items: [{ blockId: 'decision', type: 'verdict', value: '赞成' }],
  };
  appendStreamLine(session, streamEntry({
    id: 'ignored-local-message',
    at: '2026-07-23T02:00:00.000Z',
    text: '默认模式不应改变反馈返回值',
  }));
  writeJson(path.join(tmpDir, session, 'round-1', 'feedback.json'), feedback);

  const result = await cmdWait(session, 1, { timeoutMs: 100, intervalMs: 10 });

  assert.deepEqual(result, {
    ok: true,
    event: 'feedback',
    session,
    round: 1,
    feedback,
  });
});

test('远程 cmdWait events:true 用 since 增量读取消息并被新消息唤醒', async () => {
  const session = 'remote-stream-wait';
  const history = streamEntry({
    id: 'history-remote',
    at: '2026-07-23T03:00:00.000Z',
    text: '远程启动前历史',
  });
  const message = streamEntry({
    id: 'new-remote',
    at: '2026-07-23T03:00:01.000Z',
    text: '远程增量消息',
    author: { id: 'bob', name: '小波', role: 'participant' },
  });
  const requests = [];
  const { server, baseUrl } = await startJsonServer((req) => {
    const url = new URL(req.url, 'http://stub.local');
    requests.push(url);
    if (url.pathname === '/api/feedback') {
      return { body: { ok: false, pending: true } };
    }
    if (url.pathname === '/api/messages') {
      const since = url.searchParams.get('since');
      return {
        body: {
          ok: true,
          entries: since == null ? [history] : (since === history.id ? [message] : []),
        },
      };
    }
    return { status: 404, body: { ok: false, error: 'not found' } };
  });

  try {
    const result = await withRemoteUrl(baseUrl, () => cmdWait(session, 3, {
      events: true,
      timeoutMs: 1000,
      intervalMs: 5,
    }));

    assert.deepEqual(result, {
      ok: true,
      event: 'message',
      session,
      round: 3,
      message,
    });
    const messageRequests = requests.filter(({ pathname }) => pathname === '/api/messages');
    assert.ok(messageRequests.length >= 2, '应先读取流尾，再增量轮询消息');
    assert.equal(messageRequests[0].searchParams.get('session'), session);
    assert.equal(messageRequests[0].searchParams.has('since'), false);
    assert.equal(messageRequests.at(-1).searchParams.get('since'), history.id);
  } finally {
    await closeServer(server);
  }
});

test('远程 cmdWait 未开启 events 时不请求 /api/messages', async () => {
  const session = 'remote-feedback-only';
  const feedback = {
    session,
    round: 4,
    items: [{ blockId: 'remote-decision', type: 'verdict', value: '继续' }],
  };
  let messagesRequests = 0;
  const { server, baseUrl } = await startJsonServer((req) => {
    const url = new URL(req.url, 'http://stub.local');
    if (url.pathname === '/api/messages') {
      messagesRequests += 1;
      return { body: { ok: true, entries: [] } };
    }
    if (url.pathname === '/api/feedback') {
      return { body: { ok: true, feedback } };
    }
    return { status: 404, body: { ok: false, error: 'not found' } };
  });

  try {
    const result = await withRemoteUrl(baseUrl, () => cmdWait(session, 4, {
      timeoutMs: 1000,
      intervalMs: 5,
    }));

    assert.deepEqual(result, {
      ok: true,
      event: 'feedback',
      session,
      round: 4,
      feedback,
    });
    assert.equal(messagesRequests, 0);
  } finally {
    await closeServer(server);
  }
});

test('CLI 子进程 wait <session> <round> --events 会启用消息等待', async () => {
  const session = 'cli-events-wait';
  const history = streamEntry({
    id: 'history-cli',
    at: '2026-07-23T04:00:00.000Z',
    text: 'CLI 启动前历史',
  });
  const message = streamEntry({
    id: 'new-cli',
    at: '2026-07-23T04:00:01.000Z',
    text: 'CLI 收到的新消息',
  });
  const messageRequests = [];
  const { server, baseUrl } = await startJsonServer((req) => {
    const url = new URL(req.url, 'http://stub.local');
    if (url.pathname === '/api/feedback') {
      return { body: { ok: false, pending: true } };
    }
    if (url.pathname === '/api/messages') {
      messageRequests.push(url);
      const since = url.searchParams.get('since');
      return {
        body: {
          ok: true,
          entries: since == null ? [history] : (since === history.id ? [message] : []),
        },
      };
    }
    return { status: 404, body: { ok: false, error: 'not found' } };
  });

  try {
    const result = await runCli(
      ['wait', session, '5', '--events', '--timeout', '1'],
      { WORKBENCH_REMOTE_URL: baseUrl },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      event: 'message',
      session,
      round: 5,
      message,
    });
    assert.equal(messageRequests.at(-1)?.searchParams.get('since'), history.id);
  } finally {
    await closeServer(server);
  }
});

test('CLI stream-migrate 首次迁移一条历史留言，重复执行 migrated 为 0', async () => {
  const session = 'cli-stream-migrate';
  writeJson(path.join(tmpDir, session, 'round-1', 'feedback.json'), {
    session,
    round: 1,
    items: [],
    sessionComment: '请把这条历史留言迁移到会话流',
    submittedBy: { id: 'alice', name: '小艾' },
    submittedAt: '2026-07-23T05:00:00.000Z',
  });

  const first = await runCli(['stream-migrate', session]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).migrated, 1);

  const second = await runCli(['stream-migrate', session]);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).migrated, 0);
});

test('CLI 帮助包含 wait --events 和 stream-migrate', async () => {
  const result = await runCli(['--help']);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /wait[^\n]*--events/);
  assert.match(result.stdout, /stream-migrate\s+<session>/);
});
