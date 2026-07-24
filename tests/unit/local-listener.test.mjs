// 本地监听器单测：所有 HTTP 与子进程边界都使用注入替身，不接触真实云端和 CLI。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createFileLogger, createListener, loadConfig } from '../../scripts/local-listener.mjs';

const BASE_CONFIG = {
  workbenchUrl: 'http://workbench.test',
  token: 'test-token',
  executor: 'local-mac',
  pollMs: 1000,
  repoMap: { demo: '/tmp/demo-repo' },
  claimedBy: 'test-host-123',
};

function task(type, payload = {}, overrides = {}) {
  return {
    id: `${type}-task-id`,
    executor: 'local-mac',
    session: 'listener-test',
    type,
    title: `${type} 测试任务`,
    payload,
    status: 'pending',
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeChild({ stdout = '', stderr = '', code = 0, delayMs = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  setTimeout(() => {
    if (stdout) child.stdout.end(stdout);
    else child.stdout.end();
    if (stderr) child.stderr.end(stderr);
    else child.stderr.end();
    child.emit('close', code, null);
  }, delayMs);
  return child;
}

function makeFetch(tasks, { calls = [], onRequest } = {}) {
  return async (input, options = {}) => {
    const url = new URL(input);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method: options.method || 'GET', path: url.pathname, query: url.searchParams, body });
    if (onRequest) return onRequest({ url, options, body, calls });
    if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks });
    if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...tasks[0], status: 'claimed' } });
    if (url.pathname.endsWith('/renew')) return jsonResponse({ ok: true, task: { ...tasks[0], status: 'claimed' } });
    if (url.pathname.endsWith('/complete')) return jsonResponse({ ok: true, task: { ...tasks[0], status: body.ok ? 'done' : 'failed' } });
    if (url.pathname === '/api/stream-events') return jsonResponse({ ok: true, entry: {} });
    throw new Error(`测试未处理 URL：${url.pathname}`);
  };
}

function makeSpawn(sequence, calls = []) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const next = sequence.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`不应出现额外 spawn：${command}`);
    return fakeChild(next);
  };
}

test('loadConfig 解析默认值、仓库映射和唯一 claimedBy 所需配置', () => {
  const config = loadConfig({
    WORKBENCH_URL: 'https://example.test/',
    WORKBENCH_TOKEN: 'secret',
    LISTENER_REPO_MAP: JSON.stringify({ demo: '/Users/founder/demo' }),
  }, { hostname: () => 'macbook', pid: 42 });

  assert.deepEqual(config, {
    workbenchUrl: 'https://example.test',
    token: 'secret',
    executor: 'local-mac',
    pollMs: 30000,
    repoMap: { demo: '/Users/founder/demo' },
    claimedBy: 'macbook-42',
  });
});

test('codex-task 使用 tcd start/check，并按 GET→claim→complete 完成', async () => {
  const calls = [];
  const spawnCalls = [];
  const current = task('codex-task', { projectId: 'demo', prompt: '实现本地任务', timeoutMinutes: 1 });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname.endsWith('/complete')) {
        assert.deepEqual(body, { ok: true, summary: 'tcd 已完成' });
        return jsonResponse({ ok: true, task: { ...current, status: 'done' } });
      }
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([
      { stdout: 'job-123\n' },
      { stdout: JSON.stringify({ status: 'completed', summary: 'tcd 已完成' }) },
    ], spawnCalls),
    tcdPollMs: 1,
    logger: { log() {} },
  });

  const result = await listener.pollOnce();

  assert.equal(result.ok, true);
  assert.deepEqual(spawnCalls.map(({ command, args }) => [command, args]), [
    ['tcd', ['start', '-p', 'codex', '--worktree', '-d', '/tmp/demo-repo', '-m', '实现本地任务']],
    ['tcd', ['check', 'job-123']],
  ]);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/inbox/tasks',
    'POST /api/inbox/tasks/codex-task-task-id/claim',
    'POST /api/inbox/tasks/codex-task-task-id/complete',
  ]);
});

test('codex-task 在 tcd check 返回 running 时继续轮询直到 completed', async () => {
  const current = task('codex-task', { projectId: 'demo', prompt: '轮询任务' });
  const checkOutputs = [
    JSON.stringify({ status: 'running' }),
    JSON.stringify({ status: 'completed', output: '第二次检查完成' }),
  ];
  const calls = [];
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname.endsWith('/complete')) return jsonResponse({ ok: true, task: { ...current, status: 'done' } });
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const spawnCalls = [];
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([
      { stdout: 'job-poll\n' },
      { stdout: checkOutputs.shift() },
      { stdout: checkOutputs.shift() },
    ], spawnCalls),
    tcdPollMs: 1,
    logger: { log() {} },
  });

  await listener.pollOnce();

  assert.deepEqual(spawnCalls.map(({ args }) => args[0]), ['start', 'check', 'check']);
  assert.equal(calls.at(-1).path, '/api/inbox/tasks/codex-task-task-id/complete');
});

test('claude-task 写入前后 progress，stdout 截断后 complete', async () => {
  const calls = [];
  const spawnCalls = [];
  const current = task('claude-task', {
    projectId: 'demo',
    prompt: '检查代码',
  });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname === '/api/stream-events') {
        assert.equal(body.kind, 'progress');
        assert.match(body.text, /『本地监听器』/);
        return jsonResponse({ ok: true, entry: {} });
      }
      if (url.pathname.endsWith('/complete')) {
        assert.equal(Array.from(body.summary).length, 4000);
        return jsonResponse({ ok: true, task: { ...current, status: 'done' } });
      }
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([{ stdout: 'x'.repeat(4500) }], spawnCalls),
    logger: { log() {} },
  });

  await listener.pollOnce();

  assert.deepEqual(spawnCalls[0].args, ['-p', '检查代码', '--output-format', 'text', '--dangerously-skip-permissions']);
  assert.equal(spawnCalls[0].options.cwd, '/tmp/demo-repo');
  assert.deepEqual(calls.filter(({ path }) => path === '/api/stream-events').length, 2);
});

test('message/feedback/round 会话事件先通知，再按会话项目启动 Claude 编排', async () => {
  for (const type of ['message', 'feedback', 'round']) {
    const calls = [];
    const spawnCalls = [];
    const current = task(type, { event: type, detail: `${type} 原文` }, {
      id: `${type}-event-id`,
      session: 'listener-test',
    });
    const fetchImpl = makeFetch([current], {
      calls,
      onRequest: ({ url, body }) => {
        if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
        if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
        if (url.pathname === '/api/projects') {
          return jsonResponse({
            ok: true,
            projects: [{ id: 'demo', sessions: ['listener-test'] }],
          });
        }
        if (url.pathname.endsWith('/complete')) {
          assert.equal(body.ok, true);
          assert.match(body.summary, new RegExp(type));
          return jsonResponse({ ok: true, task: { ...current, status: 'done' } });
        }
        throw new Error(`不应出现请求：${url.pathname}`);
      },
    });
    const claudeOutput = `开头-${type}-${'x'.repeat(2200)}-尾部-${type}`;
    const listener = createListener(BASE_CONFIG, {
      fetchImpl,
      spawnImpl: makeSpawn([{ stdout: '' }, { stdout: claudeOutput }], spawnCalls),
      logger: { log() {} },
    });

    const result = await listener.pollOnce();

    assert.equal(result.ok, true);
    assert.match(result.summary, new RegExp(`尾部-${type}$`));
    assert.doesNotMatch(result.summary, new RegExp(`开头-${type}`));
    assert.deepEqual(spawnCalls.map(({ command }) => command), ['osascript', 'claude']);
    assert.match(spawnCalls[0].args[1], new RegExp(`listener-test.*${type}|${type}.*listener-test`));
    assert.equal(spawnCalls[1].options.cwd, '/tmp/demo-repo');
    assert.deepEqual(spawnCalls[1].args, ['-p', spawnCalls[1].args[1], '--output-format', 'text', '--dangerously-skip-permissions']);
    assert.match(spawnCalls[1].args[1], /本地编排者 Claude/);
    assert.match(spawnCalls[1].args[1], /事件原文 JSON/);
    assert.match(spawnCalls[1].args[1], /listener-test/);
    assert.match(spawnCalls[1].args[1], /POST \$WORKBENCH_URL\/api\/stream-events/);
    assert.match(spawnCalls[1].args[1], /x-workbench-token/);
    assert.match(spawnCalls[1].args[1], /kind=message/);
    assert.match(spawnCalls[1].args[1], /kind=progress/);
    assert.match(spawnCalls[1].args[1], /tcd/);
    assert.match(spawnCalls[1].args[1], /绝不在任何输出中打印口令/);
    assert.equal(spawnCalls[1].options.env.WORKBENCH_URL, BASE_CONFIG.workbenchUrl);
    assert.equal(spawnCalls[1].options.env.WORKBENCH_TOKEN, BASE_CONFIG.token);
    assert.deepEqual(calls.filter(({ path }) => path === '/api/projects').length, 1);
  }
});

test('会话项目查不到时使用工作台仓库目录启动 Claude', async () => {
  const calls = [];
  const spawnCalls = [];
  const current = task('message', { event: 'message' }, {
    session: 'unmapped-session',
  });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname === '/api/projects') return jsonResponse({
        ok: true,
        projects: [{ id: 'demo', sessions: ['another-session'] }],
      });
      if (url.pathname.endsWith('/complete')) return jsonResponse({ ok: true, task: { ...current, status: 'done' } });
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([{ stdout: '' }, { stdout: '使用工作台仓库完成' }], spawnCalls),
    logger: { log() {} },
  });

  await listener.pollOnce();

  assert.equal(spawnCalls[1].command, 'claude');
  assert.equal(spawnCalls[1].options.cwd, path.resolve(process.cwd()));
  assert.equal(calls.filter(({ path: pathname }) => pathname === '/api/projects').length, 1);
});

test('会话事件 Claude 非零退出时写失败 complete 并说明原因', async () => {
  const calls = [];
  const spawnCalls = [];
  const current = task('feedback', { event: 'feedback' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname === '/api/projects') return jsonResponse({ ok: true, projects: [] });
      if (url.pathname.endsWith('/complete')) {
        assert.equal(body.ok, false);
        assert.match(body.summary, /claude|退出码|编排失败/);
        return jsonResponse({ ok: true, task: { ...current, status: 'failed' } });
      }
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([{ stdout: '' }, { stderr: 'Claude 编排失败', code: 2 }], spawnCalls),
    logger: { log() {} },
  });

  const result = await listener.pollOnce();

  assert.equal(result.ok, false);
  assert.deepEqual(spawnCalls.map(({ command }) => command), ['osascript', 'claude']);
  assert.equal(calls.filter(({ path: pathname }) => pathname.endsWith('/complete')).length, 1);
});

test('会话事件 Claude 不存在时写失败 complete', async () => {
  const calls = [];
  const spawnCalls = [];
  const current = task('round', { event: 'round' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname === '/api/projects') return jsonResponse({ ok: true, projects: [] });
      if (url.pathname.endsWith('/complete')) {
        assert.equal(body.ok, false);
        assert.match(body.summary, /claude.*不存在|未找到 claude/);
        return jsonResponse({ ok: true, task: { ...current, status: 'failed' } });
      }
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      if (command === 'osascript') return fakeChild();
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    },
    logger: { log() {} },
  });

  const result = await listener.pollOnce();

  assert.equal(result.ok, false);
  assert.deepEqual(spawnCalls.map(({ command }) => command), ['osascript', 'claude']);
});

test('会话事件 Claude 超时时写失败 complete 并说明超时', async () => {
  const calls = [];
  const current = task('message', { event: 'message' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname === '/api/projects') return jsonResponse({ ok: true, projects: [] });
      if (url.pathname.endsWith('/complete')) {
        assert.equal(body.ok, false);
        assert.match(body.summary, /超时/);
        return jsonResponse({ ok: true, task: { ...current, status: 'failed' } });
      }
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([{ stdout: '' }, { delayMs: 20 }]),
    claudeTimeoutMs: 1,
    logger: { log() {} },
  });

  const result = await listener.pollOnce();

  assert.equal(result.ok, false);
});

test('长任务执行期间按注入间隔 renew，最后才 complete', async () => {
  const calls = [];
  const current = task('notify', { message: '稍后提醒' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname.endsWith('/renew')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname.endsWith('/complete')) return jsonResponse({ ok: true, task: { ...current, status: body.ok ? 'done' : 'failed' } });
      if (url.pathname === '/api/stream-events') return jsonResponse({ ok: true });
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const spawnCalls = [];
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([{ delayMs: 35 }], spawnCalls),
    renewIntervalMs: 5,
    logger: { log() {} },
  });

  await listener.pollOnce();

  const paths = calls.map(({ path }) => path);
  assert.ok(paths.filter((path) => path.endsWith('/renew')).length >= 1);
  assert.equal(paths.at(-1), '/api/inbox/tasks/notify-task-id/complete');
  assert.deepEqual(spawnCalls[0].args[0], '-e');
});

test('tcd 不存在时不重试，写失败 complete 并包含原因', async () => {
  const calls = [];
  const current = task('codex-task', { projectId: 'demo', prompt: '失败启动' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname.endsWith('/complete')) {
        assert.equal(body.ok, false);
        assert.match(body.summary, /tcd|ENOENT|启动/);
        return jsonResponse({ ok: true, task: { ...current, status: 'failed' } });
      }
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: () => { throw Object.assign(new Error('spawn tcd ENOENT'), { code: 'ENOENT' }); },
    logger: { log() {} },
  });

  const result = await listener.pollOnce();
  assert.equal(result.ok, false);
  assert.equal(calls.filter(({ path }) => path.endsWith('/complete')).length, 1);
});

test('并发调用 pollOnce 仍只拉取和执行一个任务', async () => {
  const calls = [];
  const current = task('notify', { message: '只执行一次' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname.endsWith('/complete')) return jsonResponse({ ok: true, task: { ...current, status: 'done' } });
      if (url.pathname === '/api/stream-events') return jsonResponse({ ok: true });
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const spawnCalls = [];
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([{ delayMs: 25 }], spawnCalls),
    logger: { log() {} },
  });

  await Promise.all([listener.pollOnce(), listener.pollOnce()]);

  assert.equal(calls.filter(({ path }) => path === '/api/inbox/tasks').length, 1);
  assert.equal(spawnCalls.length, 1);
  assert.equal(calls.filter(({ path }) => path.endsWith('/complete')).length, 1);
});

test('优雅下线停止拉新并等待当前任务完成', async () => {
  const calls = [];
  const first = task('notify', { message: '当前任务' });
  const second = task('notify', { message: '不应拉取' }, { id: 'second-task-id' });
  const fetchImpl = makeFetch([first, second], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [first, second] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...first, status: 'claimed' } });
      if (url.pathname.endsWith('/complete')) return jsonResponse({ ok: true, task: { ...first, status: 'done' } });
      if (url.pathname === '/api/stream-events') return jsonResponse({ ok: true });
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const listener = createListener({ ...BASE_CONFIG, pollMs: 1 }, {
    fetchImpl,
    spawnImpl: makeSpawn([{ delayMs: 25 }]),
    logger: { log() {} },
  });

  listener.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await listener.stop({ shutdownWaitMs: 60 });

  assert.equal(calls.filter(({ path }) => path === '/api/inbox/tasks').length, 1);
  assert.equal(calls.filter(({ path }) => path.endsWith('/complete')).length, 1);
});

test('下线超过等待上限会中止子进程且不发送 complete', async () => {
  const calls = [];
  const current = task('notify', { message: '超时下线' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      throw new Error(`下线后不应请求：${url.pathname}`);
    },
  });
  const listener = createListener({ ...BASE_CONFIG, pollMs: 1 }, {
    fetchImpl,
    spawnImpl: makeSpawn([{ delayMs: 100 }]),
    logger: { log() {} },
  });

  listener.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await listener.stop({ shutdownWaitMs: 10 });

  assert.equal(calls.filter(({ path }) => path.endsWith('/complete')).length, 0);
});

test('notify 只调用 osascript display notification 并完成任务', async () => {
  const calls = [];
  const current = task('notify', { title: '提醒标题', message: '提醒内容' });
  const fetchImpl = makeFetch([current], {
    calls,
    onRequest: ({ url, body }) => {
      if (url.pathname === '/api/inbox/tasks') return jsonResponse({ ok: true, tasks: [current] });
      if (url.pathname.endsWith('/claim')) return jsonResponse({ ok: true, task: { ...current, status: 'claimed' } });
      if (url.pathname.endsWith('/complete')) {
        assert.equal(body.ok, true);
        return jsonResponse({ ok: true, task: { ...current, status: 'done' } });
      }
      throw new Error(`不应出现请求：${url.pathname}`);
    },
  });
  const spawnCalls = [];
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([{ stdout: '' }], spawnCalls),
    logger: { log() {} },
  });

  await listener.pollOnce();

  assert.equal(spawnCalls[0].command, 'osascript');
  assert.match(spawnCalls[0].args[1], /display notification/);
  assert.match(spawnCalls[0].args[1], /提醒内容/);
});

test('真正未知的任务类型仍直接失败且不启动子进程', async () => {
  const calls = [];
  const spawnCalls = [];
  const current = task('unknown-task', { message: '未知类型' });
  const fetchImpl = makeFetch([current], { calls });
  const listener = createListener(BASE_CONFIG, {
    fetchImpl,
    spawnImpl: makeSpawn([], spawnCalls),
    logger: { log() {} },
  });

  const result = await listener.pollOnce();

  assert.equal(result.ok, false);
  assert.match(result.summary, /不支持的本地任务类型/);
  assert.equal(spawnCalls.length, 0);
  assert.equal(calls.filter(({ path }) => path.endsWith('/complete')).length, 1);
});

test('日志启动时超过 5 MiB 会轮转为 .old，并继续追加当前日志', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-listener-log-'));
  const logFile = path.join(directory, 'listener.log');
  try {
    fs.writeFileSync(logFile, 'x'.repeat(5 * 1024 * 1024 + 1));
    const logger = createFileLogger(logFile);
    logger.log('轮转后日志');
    assert.equal(fs.existsSync(`${logFile}.old`), true);
    assert.match(fs.readFileSync(logFile, 'utf8'), /轮转后日志/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
