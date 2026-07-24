import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as worker from '../../scripts/resident-worker.mjs';

function workerConfig(workerHome, extra = {}) {
  return {
    workbenchUrl: 'http://127.0.0.1:8099',
    token: 'test-token',
    model: 'gpt-test',
    workerHome,
    pollMs: 60_000,
    eventPort: 8097,
    workerLabel: '云端 Codex · sol xhigh',
    ...extra,
  };
}

test('状态文件读写可重复执行且保持同一结果', () => {
  assert.equal(typeof worker.readState, 'function');
  assert.equal(typeof worker.writeState, 'function');

  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-state-'));
  try {
    assert.deepEqual(worker.readState(workerHome), { perSession: {} });

    const expected = {
      perSession: {
        'session-a': {
          lastStreamId: 'stream-7',
          lastFeedbackKey: '3',
        },
      },
    };
    worker.writeState(workerHome, expected);
    const firstRaw = fs.readFileSync(path.join(workerHome, 'state.json'), 'utf8');
    worker.writeState(workerHome, expected);

    assert.deepEqual(worker.readState(workerHome), expected);
    assert.equal(fs.readFileSync(path.join(workerHome, 'state.json'), 'utf8'), firstRaw);
    assert.equal(fs.existsSync(path.join(workerHome, 'state.json.tmp')), false);
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('状态文件可安全保存 JavaScript 原型同名 session', () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-state-key-'));
  try {
    const perSession = {};
    Object.defineProperty(perSession, '__proto__', {
      value: { lastStreamId: 'proto-stream', lastFeedbackKey: '1' },
      enumerable: true,
    });
    Object.defineProperty(perSession, 'constructor', {
      value: { lastStreamId: 'constructor-stream', lastFeedbackKey: '2' },
      enumerable: true,
    });

    worker.writeState(workerHome, { perSession });
    const loaded = worker.readState(workerHome);

    assert.equal(Object.hasOwn(loaded.perSession, '__proto__'), true);
    assert.equal(Object.hasOwn(loaded.perSession, 'constructor'), true);
    assert.equal(loaded.perSession.__proto__.lastStreamId, 'proto-stream');
    assert.equal(loaded.perSession.constructor.lastStreamId, 'constructor-stream');
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('空工作台单轮执行也会初始化状态文件', async () => {
  assert.equal(typeof worker.runOnce, 'function');

  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-once-'));
  try {
    const result = await worker.runOnce({
      workbenchUrl: 'http://127.0.0.1:8099',
      token: 'test-token',
      model: 'gpt-test',
      workerHome,
      pollMs: 5000,
    }, {
      async fetchImpl() {
        return new Response(JSON.stringify({ ok: true, sessions: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    assert.deepEqual(result, { sessions: 0, queued: 0, processed: 0 });
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(workerHome, 'state.json'), 'utf8')),
      { perSession: {} },
    );
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('事件过滤只保留 owner 与 participant，忽略 AI 条目', () => {
  assert.equal(typeof worker.filterHumanEntries, 'function');

  const entries = [
    {
      id: 'owner-1',
      author: { id: 'owner', name: '创始人', role: 'owner' },
      kind: 'message',
      text: '请检查线上状态。',
    },
    {
      id: 'ai-1',
      author: { id: 'ai', name: 'AI', role: 'ai' },
      kind: 'receipt',
      text: '已处理完毕',
    },
    {
      id: 'participant-1',
      author: { id: 'alice', name: '小艾', role: 'participant' },
      kind: 'message',
      text: '按钮点了没有反应。',
    },
    {
      id: 'answer-1',
      author: { id: 'owner', name: '创始人', role: 'owner' },
      kind: 'answer',
      text: '滚动发布',
      answerTo: 'deploy-mode',
      answerValue: 'rolling',
    },
    {
      id: 'ai-2',
      author: { id: 'ai', name: 'AI', role: 'ai' },
      kind: 'progress',
      text: '处理中',
    },
  ];

  assert.deepEqual(
    worker.filterHumanEntries(entries).map((entry) => entry.id),
    ['owner-1', 'participant-1', 'answer-1'],
  );
});

test('任务简报包含事件原文、会话与轮次', () => {
  assert.equal(typeof worker.buildTaskBrief, 'function');

  const brief = worker.buildTaskBrief({
    session: 'founder-review',
    round: 4,
    events: [{
      type: 'message',
      entry: {
        id: 'message-9',
        at: '2026-07-23T10:00:00.000Z',
        author: { id: 'owner', name: '创始人', role: 'owner' },
        kind: 'message',
        text: '请修复支付回调里的重复入账，并把验证结果写回来。',
      },
    }],
    workbenchUrl: 'http://127.0.0.1:8099',
    workerHome: '/home/ubuntu/cloud-codex-now',
  });

  assert.match(brief, /founder-review/);
  assert.match(brief, /第 4 轮/);
  assert.match(brief, /请修复支付回调里的重复入账，并把验证结果写回来。/);
  assert.match(brief, /stdout 不会被任何人看到/);
  assert.match(brief, /"kind":"message"/);
});

test('任务简报包含 ask 卡行为指引、curl 模板，并要求写卡后结束运行等待回答', () => {
  const brief = worker.buildTaskBrief({
    session: 'ask-guide',
    round: 2,
    events: [{
      type: 'message',
      entry: {
        id: 'message-ask-guide',
        author: { id: 'owner', name: '创始人', role: 'owner' },
        kind: 'message',
        text: '继续处理，有简单取舍就问我。',
      },
    }],
    workbenchUrl: 'http://127.0.0.1:8099',
    workerHome: '/home/ubuntu/cloud-codex-now',
  });

  assert.match(brief, /简单取舍/);
  assert.match(brief, /复杂决策.*整轮工作台卡片/);
  assert.match(brief, /"kind":"ask"/);
  assert.match(brief, /"desc":/);
  assert.match(brief, /"recommendation":/);
  assert.match(brief, /写入 ask.*结束本次运行.*等待回答/s);
  assert.match(brief, /curl --fail-with-body/);
  assert.match(brief, /\$WORKBENCH_URL\/api\/stream-events/);
});

test('answer 事件进入本次事件原文，并作为 D19 最近对话注入后续简报', () => {
  const answer = {
    id: 'answer-current',
    at: '2026-07-23T10:00:00.000Z',
    author: { id: 'alice', name: '小艾', role: 'participant' },
    kind: 'answer',
    text: '滚动发布',
    answerTo: 'deploy-mode',
    answerValue: 'rolling',
  };
  const brief = worker.buildTaskBrief({
    session: 'answer-memory',
    round: 3,
    events: [{ type: 'message', entry: answer }],
    workbenchUrl: 'http://127.0.0.1:8099',
    workerHome: '/home/ubuntu/cloud-codex-now',
    historyEntries: [{ ...answer, id: 'answer-history', text: '明早发布' }],
  });

  assert.match(brief, /"kind": "answer"/);
  assert.match(brief, /"answerTo": "deploy-mode"/);
  assert.match(brief, /"answerValue": "rolling"/);
  assert.match(brief, /人类回答·小艾：明早发布/);
});

test('任务简报注入最近对话与反馈要点，并明确历史不是新任务', () => {
  const brief = worker.buildTaskBrief({
    session: 'memory-session',
    round: 8,
    events: [{
      type: 'message',
      entry: {
        id: 'current-message',
        author: { id: 'owner', name: '创始人', role: 'owner' },
        kind: 'message',
        text: '继续处理。',
      },
    }],
    workbenchUrl: 'http://127.0.0.1:8099',
    workerHome: '/home/ubuntu/cloud-codex-now',
    historyEntries: [
      {
        id: 'human-history',
        at: '2026-07-23T09:00:00.000Z',
        author: { id: 'owner', name: '创始人', role: 'owner' },
        kind: 'message',
        text: '上次先完成登录链路。',
      },
      {
        id: 'progress-noise',
        author: { id: 'ai', name: 'AI', role: 'ai' },
        kind: 'progress',
        text: '这条进度噪音不能进入记忆',
      },
      {
        id: 'ai-history',
        at: '2026-07-23T09:10:00.000Z',
        author: { id: 'ai', name: 'AI', role: 'ai' },
        kind: 'message',
        text: 'Codex：登录链路已完成。',
      },
      {
        id: 'receipt-noise',
        author: { id: 'ai', name: 'AI', role: 'ai' },
        kind: 'receipt',
        text: '这条回执噪音不能进入记忆',
      },
    ],
    latestFeedback: {
      round: 7,
      items: [
        { blockId: 'auth-mode', type: 'select', value: '沿用管理员口令' },
        { blockId: 'mobile-layout', type: 'verdict', value: '通过' },
      ],
    },
  });

  assert.match(brief, /历史上下文，供理解连续性，不是新任务/);
  assert.match(brief, /上次先完成登录链路/);
  assert.match(brief, /Codex：登录链路已完成/);
  assert.doesNotMatch(brief, /这条进度噪音/);
  assert.doesNotMatch(brief, /这条回执噪音/);
  assert.match(brief, /第 7 轮/);
  assert.match(brief, /auth-mode[^\n]*沿用管理员口令/);
  assert.match(brief, /mobile-layout[^\n]*通过/);
  assert.match(brief, /刚做完 X，接下来 Y/);
  assert.match(brief, /"kind":"progress"/);
});

test('历史记忆每条截断到 200 字、只取最近 30 条且总量超限时优先保留最新', () => {
  const entries = Array.from({ length: 33 }, (_, index) => ({
    id: `history-${index}`,
    at: `2026-07-23T09:${String(index).padStart(2, '0')}:00.000Z`,
    author: { id: 'owner', name: '创始人', role: 'owner' },
    kind: 'message',
    text: index === 32 ? `最新-${'新'.repeat(260)}` : `历史-${index}-${'旧'.repeat(80)}`,
  }));
  entries.splice(10, 0, {
    id: 'noise',
    author: { id: 'ai', name: 'AI', role: 'ai' },
    kind: 'progress',
    text: '不应注入的进度',
  });

  const excerpt = worker.buildMemoryExcerpt(entries, {
    round: 9,
    items: [{ blockId: 'choice', type: 'select', value: '最新选择' }],
  }, { maxCharacters: 1200 });

  assert.ok(Array.from(excerpt).length <= 1200);
  assert.doesNotMatch(excerpt, /不应注入的进度/);
  assert.doesNotMatch(excerpt, /历史-0-/);
  assert.doesNotMatch(excerpt, /历史-1-/);
  assert.doesNotMatch(excerpt, /历史-2-/);
  assert.match(excerpt, /最新-/);
  assert.match(excerpt, /第 9 轮/);
  assert.match(excerpt, /choice[^\n]*最新选择/);
  const newestLine = excerpt.split('\n').find((line) => line.includes('最新-'));
  const newestText = newestLine.slice(newestLine.indexOf('最新-'));
  assert.equal(Array.from(newestText).length, 200);
  assert.ok(newestText.endsWith('…'));
});

test('有增量游标时重新拉取最近对话，并找到最近一轮已提交反馈后注入 Codex 简报', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-memory-load-'));
  let brief = '';
  const requestedFeedbackRounds = [];
  try {
    worker.writeState(workerHome, {
      perSession: { 'memory-load': { lastStreamId: 'old-cursor' } },
    });
    const result = await worker.runOnce(workerConfig(workerHome), {
      sessions: ['memory-load'],
      logger: { log() {} },
      async fetchImpl(target, options = {}) {
        const url = new URL(target);
        assert.equal(options.headers['x-workbench-token'], 'test-token');
        let payload;
        if (url.pathname === '/api/messages' && url.searchParams.get('since') === 'old-cursor') {
          payload = {
            ok: true,
            entries: [{
              id: 'current-message',
              author: { id: 'owner', name: '创始人', role: 'owner' },
              kind: 'message',
              text: '继续上次任务。',
            }],
          };
        } else if (url.pathname === '/api/messages' && !url.searchParams.has('since')) {
          payload = {
            ok: true,
            entries: [
              {
                id: 'old-human',
                author: { id: 'owner', name: '创始人', role: 'owner' },
                kind: 'message',
                text: '上次先确认部署范围。',
              },
              {
                id: 'old-progress',
                author: { id: 'ai', name: 'AI', role: 'ai' },
                kind: 'progress',
                text: '不应进入简报的历史进度',
              },
              {
                id: 'old-ai-final',
                author: { id: 'ai', name: 'AI', role: 'ai' },
                kind: 'message',
                text: 'Codex：已确认只部署测试环境。',
              },
              {
                id: 'current-message',
                author: { id: 'owner', name: '创始人', role: 'owner' },
                kind: 'message',
                text: '继续上次任务。',
              },
            ],
          };
        } else if (url.pathname === '/api/messages') {
          payload = { ok: true, entries: [] };
        } else if (url.pathname === '/api/status') {
          payload = {
            ok: true,
            status: { session: 'memory-load', state: 'presented', round: 3 },
            display: 'awaiting_feedback',
          };
        } else if (url.pathname === '/api/feedback') {
          const feedbackRound = Number(url.searchParams.get('round'));
          requestedFeedbackRounds.push(feedbackRound);
          payload = feedbackRound === 2
            ? {
                ok: true,
                feedback: {
                  session: 'memory-load',
                  round: 2,
                  items: [{ blockId: 'deploy-target', type: 'select', value: '测试环境' }],
                },
              }
            : { ok: false, pending: true };
        } else if (url.pathname === '/api/session-context') {
          payload = { ok: true, context: { session: { id: 'memory-load' }, primaryProject: null } };
        } else if (url.pathname === '/api/stream-events') {
          const event = JSON.parse(options.body);
          payload = { ok: true, entry: { id: `stream-${event.kind}`, ...event } };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl(_command, args) {
        brief = args.at(-1);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        queueMicrotask(() => child.emit('close', 0, null));
        return child;
      },
    });

    assert.equal(result.processed, 1);
    assert.deepEqual(requestedFeedbackRounds, [3, 2]);
    assert.match(brief, /上次先确认部署范围/);
    assert.match(brief, /Codex：已确认只部署测试环境/);
    assert.doesNotMatch(brief, /不应进入简报的历史进度/);
    assert.match(brief, /第 2 轮/);
    assert.match(brief, /deploy-target[^\n]*测试环境/);
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('Codex 子进程运行期间每 60 秒写进度心跳，退出后立即停止', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-task-heartbeat-'));
  const streamEvents = [];
  let now = 0;
  let taskTick;
  let clearedTimer = null;
  let child;
  let resolveSpawned;
  const spawned = new Promise((resolve) => { resolveSpawned = resolve; });
  let running;
  try {
    running = worker.runOnce(workerConfig(workerHome), {
      sessions: ['heartbeat-session'],
      now: () => now,
      setIntervalImpl(callback, ms) {
        assert.equal(ms, 60_000);
        taskTick = callback;
        return 'task-progress-timer';
      },
      clearIntervalImpl(timer) {
        clearedTimer = timer;
      },
      logger: { log() {} },
      async fetchImpl(target, options = {}) {
        const url = new URL(target);
        let payload;
        if (url.pathname === '/api/messages' && !url.searchParams.has('since')) {
          payload = {
            ok: true,
            entries: [{
              id: 'heartbeat-message',
              author: { id: 'owner', name: '创始人', role: 'owner' },
              kind: 'message',
              text: '执行长任务。',
            }],
          };
        } else if (url.pathname === '/api/messages') {
          payload = { ok: true, entries: [] };
        } else if (url.pathname === '/api/status') {
          payload = { ok: true, status: null, display: 'unknown' };
        } else if (url.pathname === '/api/session-context') {
          payload = { ok: true, context: { session: { id: 'heartbeat-session' }, primaryProject: null } };
        } else if (url.pathname === '/api/stream-events') {
          const event = JSON.parse(options.body);
          streamEvents.push(event);
          payload = { ok: true, entry: { id: `event-${streamEvents.length}`, ...event } };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl() {
        child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        resolveSpawned();
        return child;
      },
    });

    await spawned;
    if (typeof taskTick !== 'function') {
      child.emit('close', 0, null);
      await running;
      assert.equal(typeof taskTick, 'function');
      return;
    }
    now = 60_000;
    await taskTick();
    now = 120_000;
    await taskTick();
    child.emit('close', 0, null);
    await running;

    assert.equal(clearedTimer, 'task-progress-timer');
    assert.deepEqual(
      streamEvents.filter(({ kind }) => kind === 'progress').map(({ text }) => text),
      [
        '常驻 Codex 已接单：执行长任务。（模型 sol xhigh）',
        'Codex：任务仍在处理中，已用时 1 分钟。',
        'Codex：任务仍在处理中，已用时 2 分钟。',
      ],
    );
    const countAfterExit = streamEvents.length;
    now = 180_000;
    await taskTick();
    assert.equal(streamEvents.length, countAfterExit);
  } finally {
    if (child && running && clearedTimer == null) {
      child.emit('close', 0, null);
      await running;
    }
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('Codex 超时后终止子进程', async () => {
  assert.equal(typeof worker.runCodex, 'function');

  class StubChild extends EventEmitter {
    constructor() {
      super();
      this.pid = 43210;
      this.stdout = new EventEmitter();
      this.stderr = new EventEmitter();
      this.killedWith = [];
    }

    kill(signal) {
      this.killedWith.push(signal);
      queueMicrotask(() => this.emit('close', null, signal));
      return true;
    }
  }

  const child = new StubChild();
  const calls = [];
  const groupKills = [];
  const result = await worker.runCodex('测试简报', {
    model: 'gpt-test',
    workerHome: '/tmp/resident-worker-test',
    timeoutMs: 5,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
    killImpl(pid, signal) {
      groupKills.push([pid, signal]);
      queueMicrotask(() => child.emit('close', null, signal));
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'codex');
  assert.deepEqual(calls[0].args.slice(0, 6), [
    'exec',
    '--model',
    'gpt-test',
    '--sandbox',
    'danger-full-access',
    '-C',
  ]);
  assert.equal(calls[0].args.includes('--skip-git-repo-check'), true);
  assert.equal(calls[0].args.includes('model_reasoning_effort="xhigh"'), true);
  assert.equal(calls[0].options.detached, true);
  assert.equal(result.timedOut, true);
  assert.deepEqual(groupKills, [[-43210, 'SIGTERM']]);
  assert.deepEqual(child.killedWith, []);
});

test('解析 Codex stdout：提取最终回答并剥离启动信息与 token 统计', () => {
  assert.equal(typeof worker.parseCodexFinalMessage, 'function');

  const stdout = [
    'OpenAI Codex v0.144.1',
    '--------',
    'workdir: /home/ubuntu/cloud-codex-now',
    'model: gpt-5.6-sol',
    'reasoning effort: xhigh',
    '--------',
    'user',
    '请修复问题',
    'codex',
    '\u001b[32m已完成修复，并验证了关键路径。\u001b[0m',
    '- 测试：12 项全部通过',
    'tokens used',
    '12,345',
  ].join('\n');

  assert.equal(
    worker.parseCodexFinalMessage(stdout),
    '已完成修复，并验证了关键路径。\n- 测试：12 项全部通过',
  );
  assert.equal(
    worker.parseCodexFinalMessage('这是纯文本最终回答\nToken usage: 1,024'),
    '这是纯文本最终回答',
  );
});

test('stdout 长回答按流接口上限拆分，每条都保留 Codex 前缀', () => {
  assert.equal(typeof worker.codexMessageChunks, 'function');

  const chunks = worker.codexMessageChunks('答'.repeat(4500));

  assert.equal(chunks.length, 2);
  assert.equal(chunks.every((chunk) => Array.from(chunk).length <= 4000), true);
  assert.equal(chunks.every((chunk) => chunk.startsWith('Codex：')), true);
  assert.equal(
    chunks
      .map((chunk, index) => chunk.replace(index === 0 ? /^Codex：/ : /^Codex：（续）/, ''))
      .join(''),
    '答'.repeat(4500),
  );
});

test('Codex 未自行写流时，把 stdout 最终回答作为 AI message 补写', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-stdout-fallback-'));
  const streamEvents = [];
  try {
    const result = await worker.runOnce({
      workbenchUrl: 'http://127.0.0.1:8099',
      token: 'test-token',
      model: 'gpt-test',
      workerHome,
      pollMs: 5000,
    }, {
      async fetchImpl(target, options = {}) {
        const url = new URL(target);
        let payload;
        if (url.pathname === '/api/sessions') {
          payload = { ok: true, sessions: ['session-a'] };
        } else if (url.pathname === '/api/messages' && !url.searchParams.has('since')) {
          payload = {
            ok: true,
            entries: [{
              id: 'message-1',
              author: { id: 'owner', name: '创始人', role: 'owner' },
              kind: 'message',
              text: '请给出可见回答',
            }],
          };
        } else if (url.pathname === '/api/messages') {
          assert.equal(url.searchParams.get('since'), 'progress-1');
          payload = { ok: true, entries: [] };
        } else if (url.pathname === '/api/status') {
          payload = { ok: true, status: null, display: 'unknown' };
        } else if (url.pathname === '/api/stream-events') {
          const event = JSON.parse(options.body);
          streamEvents.push(event);
          payload = {
            ok: true,
            entry: {
              id: event.kind === 'progress' ? 'progress-1' : `event-${streamEvents.length}`,
              at: '2026-07-23T10:00:00.000Z',
              author: { id: 'ai', name: 'AI', role: 'ai' },
              ...event,
            },
          };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl(command, args, options) {
        assert.equal(options.env.WORKBENCH_SESSION, 'session-a');
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        queueMicrotask(() => {
          child.stdout.emit('data', [
            'codex',
            '修复已经完成。',
            '全量测试通过。',
            'tokens used',
            '2,048',
          ].join('\n'));
          child.emit('close', 0, null);
        });
        return child;
      },
      logger: { log() {} },
    });

    assert.equal(result.processed, 1);
    assert.deepEqual(streamEvents.map(({ kind }) => kind), ['progress', 'message']);
    assert.equal(streamEvents[1].text, 'Codex：修复已经完成。\n全量测试通过。');
    assert.equal(streamEvents.some(({ text }) => text === '已处理完毕'), false);
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('Codex 已自行写入 ask 后不重复转发 stdout 或补 receipt', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-existing-reply-'));
  const streamEvents = [];
  try {
    await worker.runOnce({
      workbenchUrl: 'http://127.0.0.1:8099',
      token: 'test-token',
      model: 'gpt-test',
      workerHome,
      pollMs: 5000,
    }, {
      async fetchImpl(target, options = {}) {
        const url = new URL(target);
        let payload;
        if (url.pathname === '/api/sessions') {
          payload = { ok: true, sessions: ['session-a'] };
        } else if (url.pathname === '/api/messages' && !url.searchParams.has('since')) {
          payload = {
            ok: true,
            entries: [{
              id: 'message-1',
              author: { id: 'owner', name: '创始人', role: 'owner' },
              kind: 'message',
              text: '处理后请回复',
            }],
          };
        } else if (url.pathname === '/api/messages') {
          payload = {
            ok: true,
            entries: [{
              id: 'codex-ask-1',
              author: { id: 'ai', name: 'AI', role: 'ai' },
              kind: 'ask',
              text: '请选择发布方式',
              ask: {
                id: 'deploy-mode',
                question: '请选择发布方式',
                options: [
                  { id: 'safe', label: '分批发布', desc: '更稳，但更慢。' },
                  { id: 'fast', label: '直接发布', desc: '更快，但风险更高。' },
                ],
                multi: false,
              },
            }],
          };
        } else if (url.pathname === '/api/status') {
          payload = { ok: true, status: null, display: 'unknown' };
        } else if (url.pathname === '/api/stream-events') {
          const event = JSON.parse(options.body);
          streamEvents.push(event);
          payload = {
            ok: true,
            entry: {
              id: 'progress-1',
              at: '2026-07-23T10:00:00.000Z',
              author: { id: 'ai', name: 'AI', role: 'ai' },
              ...event,
            },
          };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        queueMicrotask(() => {
          child.stdout.emit('data', 'codex\n这段 stdout 不应重复写流\ntokens used\n99');
          child.emit('close', 0, null);
        });
        return child;
      },
      logger: { log() {} },
    });

    assert.deepEqual(streamEvents.map(({ kind }) => kind), ['progress']);
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('Codex 失败回执不会泄露环境变量中的口令', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-redact-'));
  const streamEvents = [];
  try {
    const result = await worker.runOnce({
      workbenchUrl: 'http://127.0.0.1:8099',
      token: 'super-secret-token',
      model: 'gpt-test',
      workerHome,
      pollMs: 5000,
    }, {
      async fetchImpl(target, options = {}) {
        const url = new URL(target);
        let payload;
        if (url.pathname === '/api/sessions') {
          payload = { ok: true, sessions: ['session-a'] };
        } else if (url.pathname === '/api/messages') {
          payload = {
            ok: true,
            entries: [{
              id: 'message-1',
              author: { id: 'owner', name: '创始人', role: 'owner' },
              kind: 'message',
              text: '执行测试任务',
            }],
          };
        } else if (url.pathname === '/api/status') {
          payload = { ok: true, status: null, display: 'unknown' };
        } else if (url.pathname === '/api/stream-events') {
          streamEvents.push(JSON.parse(options.body));
          payload = { ok: true };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        queueMicrotask(() => {
          child.stderr.emit('data', '请求失败：super-secret-token');
          child.emit('close', 1, null);
        });
        return child;
      },
      logger: { log() {} },
    });

    assert.equal(result.processed, 1);
    const receipt = streamEvents.find((event) => event.kind === 'receipt');
    assert.match(receipt.text, /^处理失败：/);
    assert.doesNotMatch(receipt.text, /super-secret-token/);
    assert.match(receipt.text, /已脱敏/);
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('默认配置使用 60 秒兜底轮询与 127.0.0.1:8097 推送端口', () => {
  const config = worker.loadConfig({
    WORKBENCH_TOKEN: 'config-token',
    WORKER_HOME: '/tmp/resident-worker-config',
  });

  assert.equal(config.pollMs, 60_000);
  assert.equal(config.eventPort, 8097);
  assert.equal(config.workerLabel, '云端 Codex · sol xhigh');
});

test('任务简报包含显式项目路由，不再把所有任务固定到主业务仓库', () => {
  const brief = worker.buildTaskBrief({
    session: 'paper-session',
    round: 2,
    events: [{
      type: 'message',
      entry: {
        id: 'message-1',
        author: { id: 'owner', name: '管理员', role: 'owner' },
        kind: 'message',
        text: '修一下',
      },
    }],
    workbenchUrl: 'http://127.0.0.1:8099',
    workerHome: '/srv/worker',
    executionContext: {
      session: { id: 'paper-session', title: '视频剪辑主线' },
      primaryProject: {
        id: 'paper-edit-studio',
        displayName: 'Paper Edit Studio',
        repoPath: '/srv/paper-edit',
        memoryPath: '/srv/memory/paper-edit',
      },
      relatedProjects: [{
        id: 'user-vibeloop',
        displayName: 'User Vibe Loop',
        repoPath: '/srv/user-vibeloop',
      }],
    },
  });

  assert.match(brief, /paper-edit-studio/);
  assert.match(brief, /`\/srv\/paper-edit`/);
  assert.match(brief, /共享记忆根：`\/srv\/memory`/);
  assert.match(brief, /`\/srv\/user-vibeloop`/);
  assert.match(brief, /视频剪辑主线/);
  assert.doesNotMatch(brief, /主业务仓库：`\/home\/ubuntu\/apps\/user-vibeloop`/);
});

test('项目上下文解析期间收到停止信号时不领取事件也不启动 Codex', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-context-stop-'));
  let stopping = false;
  let spawnCount = 0;
  try {
    const result = await worker.runOnce(workerConfig(workerHome), {
      shouldStop: () => stopping,
      logger: { log() {} },
      async fetchImpl(target) {
        const url = new URL(target);
        let payload;
        if (url.pathname === '/api/sessions') {
          payload = { ok: true, sessions: ['stop-session'] };
        } else if (url.pathname === '/api/messages') {
          payload = {
            ok: true,
            entries: [{
              id: 'message-before-stop',
              author: { id: 'owner', name: '管理员', role: 'owner' },
              kind: 'message',
              text: '不要丢失我',
            }],
          };
        } else if (url.pathname === '/api/status') {
          payload = { ok: true, status: null, display: 'unknown' };
        } else if (url.pathname === '/api/session-context') {
          stopping = true;
          payload = { ok: true, context: { session: { id: 'stop-session' }, primaryProject: null } };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl() {
        spawnCount += 1;
        throw new Error('停止后不应启动 Codex');
      },
    });

    assert.deepEqual(result, { sessions: 1, queued: 1, processed: 0 });
    assert.equal(spawnCount, 0);
    assert.equal(
      worker.readState(workerHome).perSession['stop-session']?.lastStreamId || '',
      '',
      '未开始执行的事件必须留给重启后的 worker',
    );
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('有效项目上下文把 Codex cwd 与项目环境变量路由到注册仓库', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-context-home-'));
  const projectHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-context-project-'));
  let spawnCall;
  try {
    const result = await worker.runOnce(workerConfig(workerHome), {
      logger: { log() {} },
      async fetchImpl(target, options = {}) {
        const url = new URL(target);
        let payload;
        if (url.pathname === '/api/sessions') {
          payload = { ok: true, sessions: ['routed-session'] };
        } else if (url.pathname === '/api/messages' && !url.searchParams.has('since')) {
          payload = {
            ok: true,
            entries: [{
              id: 'routed-message',
              author: { id: 'owner', name: '管理员', role: 'owner' },
              kind: 'message',
              text: '执行路由测试',
            }],
          };
        } else if (url.pathname === '/api/messages') {
          payload = { ok: true, entries: [] };
        } else if (url.pathname === '/api/status') {
          payload = { ok: true, status: null, display: 'unknown' };
        } else if (url.pathname === '/api/session-context') {
          payload = {
            ok: true,
            context: {
              session: { id: 'routed-session', title: '路由会话' },
              primaryProject: {
                id: 'routed-project',
                displayName: '路由项目',
                repoPath: projectHome,
              },
              relatedProjects: [],
            },
          };
        } else if (url.pathname === '/api/stream-events') {
          const event = JSON.parse(options.body);
          payload = { ok: true, entry: { id: `entry-${event.kind}`, ...event } };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl(command, args, options) {
        spawnCall = { command, args, options };
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        queueMicrotask(() => child.emit('close', 0, null));
        return child;
      },
    });

    assert.equal(result.processed, 1);
    assert.equal(spawnCall.options.cwd, projectHome);
    assert.equal(spawnCall.args[spawnCall.args.indexOf('-C') + 1], projectHome);
    assert.equal(spawnCall.options.env.WORKBENCH_PROJECT, 'routed-project');
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
    fs.rmSync(projectHome, { recursive: true, force: true });
  }
});

test('注册仓库不存在时回退常驻目录，畸形上下文不影响接单', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-context-fallback-'));
  let spawnOptions;
  try {
    const result = await worker.runOnce(workerConfig(workerHome), {
      logger: { log() {} },
      async fetchImpl(target, options = {}) {
        const url = new URL(target);
        let payload;
        if (url.pathname === '/api/sessions') {
          payload = { ok: true, sessions: ['fallback-session'] };
        } else if (url.pathname === '/api/messages' && !url.searchParams.has('since')) {
          payload = {
            ok: true,
            entries: [{
              id: 'fallback-message',
              author: { id: 'owner', name: '管理员', role: 'owner' },
              kind: 'message',
              text: '执行回退测试',
            }],
          };
        } else if (url.pathname === '/api/messages') {
          payload = { ok: true, entries: [] };
        } else if (url.pathname === '/api/status') {
          payload = { ok: true, status: null, display: 'unknown' };
        } else if (url.pathname === '/api/session-context') {
          payload = {
            ok: true,
            context: {
              session: { id: 'fallback-session', title: '回退会话' },
              primaryProject: {
                id: 'missing-project',
                displayName: '不存在的仓库',
                repoPath: path.join(workerHome, 'not-created'),
              },
              relatedProjects: [null],
            },
          };
        } else if (url.pathname === '/api/stream-events') {
          const event = JSON.parse(options.body);
          payload = { ok: true, entry: { id: `entry-${event.kind}`, ...event } };
        } else {
          throw new Error(`未预期的请求：${url.pathname}`);
        }
        return new Response(JSON.stringify(payload), { status: 200 });
      },
      spawnImpl(_command, _args, options) {
        spawnOptions = options;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => true;
        queueMicrotask(() => child.emit('close', 0, null));
        return child;
      },
    });

    assert.equal(result.processed, 1);
    assert.equal(spawnOptions.cwd, workerHome);
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('同一轮 feedback 的 submittedAt 更新后会再次接单处理', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-feedback-key-'));
  let submittedAt = '2026-07-23T12:32:00.000Z';
  let streamSequence = 0;
  let spawnCount = 0;
  try {
    const config = workerConfig(workerHome);
    const fetchImpl = async (target, options = {}) => {
      const url = new URL(target);
      let payload;
      if (url.pathname === '/api/sessions') {
        payload = { ok: true, sessions: ['same-round'] };
      } else if (url.pathname === '/api/messages') {
        payload = { ok: true, entries: [] };
      } else if (url.pathname === '/api/status') {
        payload = {
          ok: true,
          status: { session: 'same-round', state: 'submitted', round: 9 },
          display: 'submitted',
          workerOnline: true,
          workerLabel: config.workerLabel,
        };
      } else if (url.pathname === '/api/feedback') {
        payload = {
          ok: true,
          feedback: {
            session: 'same-round',
            round: 9,
            submittedAt,
            submittedBy: { id: 'owner', name: '管理员' },
            items: [],
          },
          byParticipant: [],
          conflicts: [],
        };
      } else if (url.pathname === '/api/stream-events') {
        const event = JSON.parse(options.body);
        streamSequence += 1;
        payload = {
          ok: true,
          entry: {
            id: `worker-event-${streamSequence}`,
            at: submittedAt,
            author: { id: 'ai', name: 'AI', role: 'ai' },
            ...event,
          },
        };
      } else {
        throw new Error(`未预期的请求：${url.pathname}`);
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    };

    const first = await worker.runOnce(config, {
      fetchImpl,
      spawnImpl,
      logger: { log() {} },
    });
    submittedAt = '2026-07-23T12:32:32.000Z';
    const second = await worker.runOnce(config, {
      fetchImpl,
      spawnImpl,
      logger: { log() {} },
    });

    assert.equal(first.processed, 1);
    assert.equal(second.processed, 1, '同一轮重新提交不能被 round-only 游标吞掉');
    assert.equal(spawnCount, 2);
    assert.equal(
      worker.readState(workerHome).perSession['same-round'].lastFeedbackKey,
      '9@2026-07-23T12:32:32.000Z',
    );
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('本机 webhook POST 会立即唤醒并只检查指定 session', async () => {
  const scheduler = worker.createSessionScheduler();
  const calls = [];
  let stopped = false;
  let resolveInitial;
  let resolvePushed;
  const initial = new Promise((resolve) => { resolveInitial = resolve; });
  const pushed = new Promise((resolve) => { resolvePushed = resolve; });
  const config = workerConfig('/tmp/resident-worker-push');
  const loop = worker.runWorkerLoop(config, {
    scheduler,
    stopping: { requested: () => stopped },
    logger: { log() {} },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    async runOnceImpl(_config, options) {
      calls.push(options.sessions ?? null);
      if (calls.length === 1) resolveInitial();
      if (calls.length === 2) {
        stopped = true;
        resolvePushed();
      }
      return { sessions: options.sessions?.length ?? 0, queued: 0, processed: 0 };
    },
  });

  await initial;
  const eventServer = worker.startWorkerEventServer({
    port: 0,
    onSession: (session) => scheduler.push(session),
    logger: { log() {} },
  });
  await new Promise((resolve) => eventServer.once('listening', resolve));
  try {
    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${eventServer.address().port}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'message-posted', session: 'push-session' }),
    });
    assert.equal(response.status, 202);
    await Promise.race([
      pushed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('推送未即时触发检查')), 1000)),
    ]);
    assert.ok(Date.now() - startedAt < 1000);
    assert.deepEqual(calls, [null, ['push-session']]);
  } finally {
    await new Promise((resolve) => eventServer.close(resolve));
    scheduler.close();
    await loop;
  }
});

test('runOnce 收到推送 session 时不做全量 sessions 枚举', async () => {
  const workerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-pushed-session-'));
  const requested = [];
  try {
    const result = await worker.runOnce(workerConfig(workerHome), {
      sessions: ['push-session'],
      logger: { log() {} },
      async fetchImpl(target) {
        const url = new URL(target);
        requested.push(`${url.pathname}?${url.searchParams}`);
        if (url.pathname === '/api/messages') {
          assert.equal(url.searchParams.get('session'), 'push-session');
          return new Response(JSON.stringify({ ok: true, entries: [] }), { status: 200 });
        }
        if (url.pathname === '/api/status') {
          assert.equal(url.searchParams.get('session'), 'push-session');
          return new Response(JSON.stringify({
            ok: true,
            status: null,
            display: 'unknown',
            workerOnline: true,
            workerLabel: '云端 Codex · sol xhigh',
          }), { status: 200 });
        }
        throw new Error(`未预期的请求：${url.pathname}`);
      },
    });

    assert.deepEqual(result, { sessions: 1, queued: 0, processed: 0 });
    assert.equal(requested.some((target) => target.startsWith('/api/sessions?')), false);
  } finally {
    fs.rmSync(workerHome, { recursive: true, force: true });
  }
});

test('worker 每 30 秒上报心跳，60 秒仍执行一次全量兜底轮询', async () => {
  let now = 0;
  let stopped = false;
  const waits = [];
  const runs = [];
  const heartbeats = [];
  let heartbeatTick;
  const config = workerConfig('/tmp/resident-worker-loop');

  await worker.runWorkerLoop(config, {
    now: () => now,
    stopping: { requested: () => stopped },
    scheduler: {
      async wait(ms) {
        waits.push(ms);
        now += 30_000;
        await heartbeatTick();
        now += 30_000;
        await heartbeatTick();
        return [];
      },
    },
    logger: { log() {} },
    fetchImpl: async (target, options) => {
      const url = new URL(target);
      assert.equal(url.pathname, '/api/worker-heartbeat');
      heartbeats.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async runOnceImpl(_config, options) {
      runs.push(options.sessions ?? null);
      if (runs.length === 2) stopped = true;
      return { sessions: 0, queued: 0, processed: 0 };
    },
    setIntervalImpl(callback, ms) {
      assert.equal(ms, 30_000);
      heartbeatTick = callback;
      return 'heartbeat-timer';
    },
    clearIntervalImpl(timer) {
      assert.equal(timer, 'heartbeat-timer');
    },
  });

  assert.deepEqual(waits, [60_000]);
  assert.deepEqual(runs, [null, null], '第二次全量检查应来自 60 秒兜底轮询');
  assert.deepEqual(
    heartbeats.map((heartbeat) => heartbeat.at),
    [
      '1970-01-01T00:00:00.000Z',
      '1970-01-01T00:00:30.000Z',
      '1970-01-01T00:01:00.000Z',
    ],
  );
  assert.ok(heartbeats.every((heartbeat) => heartbeat.label === config.workerLabel));
});

test('worker 心跳失败只记日志，不中断循环', async () => {
  const logs = [];
  const ok = await worker.sendWorkerHeartbeat(workerConfig('/tmp/resident-worker-heartbeat'), {
    now: () => Date.parse('2026-07-23T12:00:00.000Z'),
    fetchImpl: async () => new Response(
      JSON.stringify({ ok: false, error: '临时不可用' }),
      { status: 503 },
    ),
    logger: { log(message) { logs.push(message); } },
  });

  assert.equal(ok, false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /心跳上报失败/);
});

test('systemd 先只终止 worker 主进程，让当前 Codex 有时间完成', () => {
  const service = fs.readFileSync(
    new URL('../../scripts/resident-worker.service', import.meta.url),
    'utf8',
  );
  assert.match(service, /^KillMode=mixed$/m);
  assert.match(service, /^KillSignal=SIGTERM$/m);
  assert.match(service, /^TimeoutStopSec=31min$/m);
  assert.match(service, /^Environment=POLL_MS=60000$/m);
  assert.match(service, /^Environment=WORKER_EVENT_PORT=8097$/m);
  assert.match(service, /WORKBENCH_EVENT_WEBHOOK=http:\/\/127\.0\.0\.1:8097\/events/);
});

test('常驻 AGENTS 在开头强调 stdout 不可见，并提供 message curl 示例', () => {
  const agents = fs.readFileSync(
    new URL('../../scripts/resident-AGENTS.md', import.meta.url),
    'utf8',
  );
  assert.match(agents.slice(0, 500), /所有回应必须通过工作台 API 写入对话流/);
  assert.match(agents.slice(0, 500), /stdout 不会被任何人看到/);
  assert.match(agents, /curl --fail-with-body/);
  assert.match(agents, /\$WORKBENCH_URL\/api\/stream-events/);
  assert.match(agents, /x-workbench-token: \$WORKBENCH_TOKEN/);
  assert.match(agents, /"kind":"message"/);
});
