// tests/e2e/loop.test.mjs — TDD：先红后绿（node:test, 零依赖）
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// ── 临时 workspace ──────────────────────────────────────────────────────────
let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-loop-test-'));
  process.env.WB_WORKSPACE = tmpDir;
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.WB_WORKSPACE;
});

// 导入必须在 before 里设好 WB_WORKSPACE 之后动态 import，但 node:test 的 before 在
// 顶层 describe 内先于 it 执行，而静态 import 在模块顶层就运行。
// 解法：用动态 import 延迟到测试体内（首次 it 内 import 即可；node:test 保证 before 先于 it）。
let buildArgv, parseStreamJson, redactSecrets, runClaude;
let getSession, getSessionId, setSessionId, getCwd;
let processRound, reconcile, markDead;
let paths, readJSON, exists, writeJSON, writeText, readStatus;

before(async () => {
  ({ buildArgv, parseStreamJson, redactSecrets, runClaude } =
    await import('../../src/loop/claude-exec.mjs'));
  ({ getSession, getSessionId, setSessionId, getCwd } =
    await import('../../src/loop/session-store.mjs'));
  ({ processRound, reconcile, markDead } =
    await import('../../src/loop/listener.mjs'));
  ({ paths, readJSON, exists, writeJSON, writeText, readStatus } =
    await import('../../src/workspace.mjs'));
});

// ── 辅助 ─────────────────────────────────────────────────────────────────────
function mkSession(name) {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return name;
}

function mkRound(session, round, { feedback = true, content = true } = {}) {
  const dir = path.join(tmpDir, session, `round-${round}`);
  fs.mkdirSync(dir, { recursive: true });
  if (feedback) {
    fs.writeFileSync(
      path.join(dir, 'feedback.json'),
      JSON.stringify({ session, round, submittedAt: new Date().toISOString(), items: [] }),
    );
  }
  if (content) {
    fs.writeFileSync(
      path.join(dir, 'content.json'),
      JSON.stringify({ session, round, blocks: [] }),
    );
  }
}

function streamResult(sessionId, text) {
  return `${JSON.stringify({ type: 'result', session_id: sessionId, result: text })}\n`;
}

// 用可控子进程脚本验证每次 spawn 的环境与终态，不依赖本机 claude CLI。
function scriptedSpawn(steps) {
  const calls = [];

  const spawnImpl = (command, argv, options) => {
    const step = steps[calls.length];
    if (!step) throw new Error('不应该出现额外的 spawn 调用');

    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      if (step.closeOnKill) child.emit('close', null, signal);
      return true;
    };
    calls.push({ command, argv, options: { ...options, env: { ...options.env } } });

    queueMicrotask(() => {
      if (step.error) {
        child.emit('error', step.error);
        return;
      }
      if (step.stdout) child.stdout.write(step.stdout);
      if (step.stderr) child.stderr.write(step.stderr);
      if (Object.hasOwn(step, 'code')) child.emit('close', step.code);
    });

    return child;
  };

  return { spawnImpl, calls };
}

async function withApiKey(value, fn) {
  const hadKey = Object.hasOwn(process.env, 'ANTHROPIC_API_KEY');
  const previous = process.env.ANTHROPIC_API_KEY;
  if (value === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = value;

  try {
    return await fn();
  } finally {
    if (hadKey) process.env.ANTHROPIC_API_KEY = previous;
    else delete process.env.ANTHROPIC_API_KEY;
  }
}

// ────────────────────────────────────────────────────────────────────────────
describe('buildArgv', () => {
  it('无 sessionId 时不含 --resume', () => {
    const argv = buildArgv('hello', null);
    assert.ok(Array.isArray(argv));
    assert.equal(argv[0], '-p');
    assert.equal(argv[1], 'hello');
    assert.ok(argv.includes('--output-format'));
    assert.ok(argv.includes('stream-json'));
    assert.ok(argv.includes('--verbose'));
    assert.ok(!argv.includes('--resume'));
  });

  it('有 sessionId 时含 --resume <id>', () => {
    const argv = buildArgv('hello', 'ses_abc123');
    assert.ok(argv.includes('--resume'));
    const idx = argv.indexOf('--resume');
    assert.equal(argv[idx + 1], 'ses_abc123');
  });

  it('sessionId 为 undefined 时不含 --resume', () => {
    const argv = buildArgv('hello', undefined);
    assert.ok(!argv.includes('--resume'));
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('parseStreamJson', () => {
  // 样例：模拟 claude --output-format stream-json --verbose 输出
  const sampleLines = [
    JSON.stringify({ type: 'message_start', session_id: 'ses_XYZ789', model: 'claude-3' }),
    JSON.stringify({ type: 'content_block_start', index: 0 }),
    JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello, ' } }),
    JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world!' } }),
    JSON.stringify({ type: 'content_block_stop', index: 0 }),
    JSON.stringify({ type: 'message_stop' }),
    'this is not json and should be ignored',
    '',
  ];
  const sampleText = sampleLines.join('\n');

  it('从多行 stream-json 中提取 sessionId', () => {
    const { sessionId } = parseStreamJson(sampleText);
    assert.equal(sessionId, 'ses_XYZ789');
  });

  it('拼接 assistant 文本', () => {
    const { text } = parseStreamJson(sampleText);
    assert.equal(text, 'Hello, world!');
  });

  it('容错：非 JSON 行被忽略', () => {
    const { sessionId, text } = parseStreamJson('not json\nalso not json');
    assert.equal(sessionId, null);
    assert.equal(text, '');
  });

  it('容错：空字符串', () => {
    const { sessionId, text } = parseStreamJson('');
    assert.equal(sessionId, null);
    assert.equal(text, '');
  });

  it('从 result 事件提取文本', () => {
    const lines = [
      JSON.stringify({ type: 'result', session_id: 'ses_R1', result: 'Final answer' }),
    ];
    const { sessionId, text } = parseStreamJson(lines.join('\n'));
    assert.equal(sessionId, 'ses_R1');
    assert.equal(text, 'Final answer');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('redactSecrets', () => {
  it('脱敏 API key 赋值（含引号）与独立 sk-ant token，保留其余上下文', () => {
    const input = [
      'auth failed',
      'ANTHROPIC_API_KEY=plain-secret',
      'quoted ANTHROPIC_API_KEY="quoted secret"',
      'token sk-ant-api03-AbC_123 trace=42',
    ].join('\n');

    assert.equal(redactSecrets(input), [
      'auth failed',
      'ANTHROPIC_API_KEY=***',
      'quoted ANTHROPIC_API_KEY=***',
      'token *** trace=42',
    ].join('\n'));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('runClaude — 订阅优先与 SDK 单次托底', () => {
  it('首跑移除 API key，成功时标记 subscription 且不重试', async () => {
    await withApiKey('sk-test-subscription', async () => {
      const { spawnImpl, calls } = scriptedSpawn([
        { code: 0, stdout: streamResult('ses_SUB', '订阅成功') },
      ]);

      const result = await runClaude({ prompt: 'hello', spawnImpl });

      assert.equal(calls.length, 1);
      assert.equal(Object.hasOwn(calls[0].options.env, 'ANTHROPIC_API_KEY'), false);
      assert.equal(calls[0].options.env.PATH, process.env.PATH);
      assert.equal(result.driverSource, 'subscription');
      assert.equal(result.text, '订阅成功');
    });
  });

  it('首跑非 0 退出时用 API key 恰好重跑一次，并标记 sdk-fallback', async () => {
    await withApiKey('sk-test-fallback', async () => {
      const { spawnImpl, calls } = scriptedSpawn([
        { code: 1, stderr: '订阅凭据不可用' },
        { code: 0, stdout: streamResult('ses_SDK', 'SDK 成功') },
      ]);

      const result = await runClaude({ prompt: 'hello', spawnImpl });

      assert.equal(calls.length, 2);
      assert.equal(Object.hasOwn(calls[0].options.env, 'ANTHROPIC_API_KEY'), false);
      assert.equal(calls[1].options.env.ANTHROPIC_API_KEY, 'sk-test-fallback');
      assert.equal(result.driverSource, 'sdk-fallback');
      assert.equal(result.sessionId, 'ses_SDK');
    });
  });

  it('SDK 托底也失败时仅 spawn 两次，错误携带 sdk-fallback', async () => {
    await withApiKey('sk-test-fallback-fail', async () => {
      const { spawnImpl, calls } = scriptedSpawn([
        { code: 1, stderr: '首跑失败' },
        { code: 2, stderr: '托底失败' },
      ]);

      await assert.rejects(
        runClaude({ prompt: 'hello', spawnImpl }),
        (err) => err.kind === 'driver' && err.driverSource === 'sdk-fallback',
      );
      assert.equal(calls.length, 2);
    });
  });

  it('没有非空 API key 时，首跑非 0 退出也不重试', async () => {
    await withApiKey(undefined, async () => {
      const { spawnImpl, calls } = scriptedSpawn([
        { code: 1, stderr: '订阅失败' },
      ]);

      await assert.rejects(
        runClaude({ prompt: 'hello', spawnImpl }),
        (err) => err.kind === 'driver' && err.driverSource === 'subscription',
      );
      assert.equal(calls.length, 1);
    });
  });

  it('非 0 退出的 stderr 进入错误对象前脱敏，且保留诊断上下文', async () => {
    await withApiKey(undefined, async () => {
      const { spawnImpl, calls } = scriptedSpawn([{
        code: 1,
        stderr: 'auth failed ANTHROPIC_API_KEY=env-secret trace=abc; leaked sk-ant-api03-token_456 request-id=req-1',
      }]);

      await assert.rejects(
        runClaude({ prompt: 'hello', spawnImpl }),
        (err) => {
          assert.equal(err.kind, 'driver');
          assert.equal(err.driverSource, 'subscription');
          assert.match(err.message, /auth failed/);
          assert.match(err.message, /trace=abc/);
          assert.match(err.message, /request-id=req-1/);
          assert.match(err.message, /ANTHROPIC_API_KEY=\*\*\*/);
          assert.doesNotMatch(err.message, /env-secret/);
          assert.doesNotMatch(err.message, /sk-ant-api03-token_456/);
          return true;
        },
      );
      assert.equal(calls.length, 1);
    });
  });

  it('spawn ENOENT 属于启动错误，即使有 API key 也不重试', async () => {
    await withApiKey('sk-test-no-spawn-retry', async () => {
      const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      const { spawnImpl, calls } = scriptedSpawn([{ error: enoent }]);

      await assert.rejects(
        runClaude({ prompt: 'hello', spawnImpl }),
        (err) => err.kind === 'driver' && err.driverSource === 'subscription',
      );
      assert.equal(calls.length, 1);
    });
  });

  it('首跑超时后可 SDK 托底，kill 同步触发 close 也不会重复 settle', async () => {
    await withApiKey('sk-test-timeout', async () => {
      const { spawnImpl, calls } = scriptedSpawn([
        { closeOnKill: true },
        { code: 0, stdout: streamResult('ses_TIMEOUT_SDK', '超时托底成功') },
      ]);

      const result = await runClaude({ prompt: 'hello', timeoutMs: 10, spawnImpl });

      assert.equal(calls.length, 2);
      assert.equal(calls[1].options.env.ANTHROPIC_API_KEY, 'sk-test-timeout');
      assert.equal(result.driverSource, 'sdk-fallback');
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('session-store', () => {
  it('getSession 无文件时返回 null', () => {
    const s = mkSession('store-test-1');
    assert.equal(getSession(s), null);
  });

  it('setSessionId / getSession 往返', () => {
    const s = mkSession('store-test-2');
    setSessionId(s, 'ses_NEW');
    const data = getSession(s);
    assert.ok(data !== null);
    assert.equal(data.claudeSessionId, 'ses_NEW');
    assert.ok(data.createdAt); // 自动填入
  });

  it('setSessionId 保留已有字段（合并写）', () => {
    const s = mkSession('store-test-3');
    // 先写 cwd（writeJSON 已在 before 里导入）
    writeJSON(paths.session(s), { claudeSessionId: null, cwd: '/my/project', createdAt: '2024-01-01T00:00:00.000Z' });
    setSessionId(s, 'ses_UPDATED');
    const data = getSession(s);
    assert.equal(data.claudeSessionId, 'ses_UPDATED');
    assert.equal(data.cwd, '/my/project');
  });

  it('setSessionId 记录 agent 所属，getSessionId 拒绝跨 agent 续接', () => {
    const s = mkSession('store-agent-owner');
    setSessionId(s, 'codex-session', 'codex');

    assert.equal(getSessionId(s, 'codex'), 'codex-session');
    assert.equal(getSessionId(s, 'claude'), null);
    assert.equal(getSession(s).agent, 'codex');
  });

  it('无 agent 字段的存量 sessionId 仅按 Claude 会话兼容', () => {
    const s = mkSession('store-legacy-owner');
    writeJSON(paths.session(s), {
      claudeSessionId: 'legacy-claude-session',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    assert.equal(getSessionId(s, 'claude'), 'legacy-claude-session');
    assert.equal(getSessionId(s, 'workbuddy'), null);
    assert.equal(getSessionId(s, 'codex'), null);
  });

  it('getCwd 无记录时返回 null', () => {
    const s = mkSession('store-test-4');
    assert.equal(getCwd(s), null);
  });

  it('getCwd 返回 session.json 中的 cwd', () => {
    const s = mkSession('store-test-5');
    writeJSON(paths.session(s), { claudeSessionId: 'x', cwd: '/proj/foo', createdAt: '2024-01-01T00:00:00.000Z' });
    assert.equal(getCwd(s), '/proj/foo');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('reconcile — 幂等与容错', () => {
  // mock driver 工厂
  const goodDriver = (a) => Promise.resolve({ sessionId: 'ses_MOCK_' + Date.now(), text: '# AI 回复\n内容。' });
  const badDriver = (a) => Promise.reject({ kind: 'api', message: 'API 调用失败' });

  it('预置有 feedback 无 ack 的轮 → reconcile 后 ack 存在', async () => {
    const s = mkSession('reconcile-1');
    mkRound(s, 1);

    await reconcile({ driver: goodDriver });

    assert.ok(exists(paths.ack(s, 1)), 'ack.json 应存在');
  });

  it('reconcile 后 response.md 存在', async () => {
    const s = mkSession('reconcile-2');
    mkRound(s, 1);

    await reconcile({ driver: goodDriver });

    assert.ok(exists(paths.response(s, 1)), 'response.md 应存在');
    const text = fs.readFileSync(paths.response(s, 1), 'utf8');
    assert.ok(text.length > 0);
  });

  it('reconcile 后 status.state === responded', async () => {
    const s = mkSession('reconcile-3');
    mkRound(s, 1);

    await reconcile({ driver: goodDriver });

    const status = readStatus(s);
    assert.equal(status.state, 'responded');
  });

  it('再次 reconcile → 该轮 skipped（幂等，不重复处理）', async () => {
    const s = mkSession('reconcile-4');
    mkRound(s, 1);

    const firstResult = await reconcile({ driver: goodDriver });
    assert.equal(firstResult[0].status, 'responded');

    // 第二次对账：ack 已存在，应 skipped
    // 注意：reconcile 跳过已有 ack 的轮（不放进结果列表）
    // 但 processRound 返回 skipped — reconcile 只处理"无 ack"的轮，第二次什么都不处理
    const secondResult = await reconcile({ driver: goodDriver });
    assert.equal(secondResult.length, 0, '第二次对账不应处理任何轮（已有 ack）');
  });

  it('driver 抛 {kind,message} → error.json 写出', async () => {
    const s = mkSession('reconcile-err-1');
    mkRound(s, 1);

    await reconcile({ driver: badDriver });

    assert.ok(exists(paths.error(s, 1)), 'error.json 应存在');
    const err = readJSON(paths.error(s, 1));
    assert.equal(err.kind, 'api');
    assert.ok(err.message);
    assert.ok(err.userMessage);
    assert.ok(err.suggestedAction);
    assert.ok(err.at);
  });

  it('driver 抛错 → status.state === error', async () => {
    const s = mkSession('reconcile-err-2');
    mkRound(s, 1);

    await reconcile({ driver: badDriver });

    const status = readStatus(s);
    assert.equal(status.state, 'error');
  });

  it('driver 抛错 → reconcile 不抛出（进程不崩溃）', async () => {
    const s = mkSession('reconcile-err-3');
    mkRound(s, 1);

    await assert.doesNotReject(() => reconcile({ driver: badDriver }));
  });

  it('多 session 多 round 对账', async () => {
    const s1 = mkSession('reconcile-multi-1');
    const s2 = mkSession('reconcile-multi-2');
    mkRound(s1, 1);
    mkRound(s1, 2);
    mkRound(s2, 1);

    const results = await reconcile({ driver: goodDriver });
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.status === 'responded'));
  });

  it('无 feedback 的轮不被处理', async () => {
    const s = mkSession('reconcile-no-fb');
    mkRound(s, 1, { feedback: false, content: true });

    const results = await reconcile({ driver: goodDriver });
    assert.equal(results.filter((r) => r.session === s).length, 0);
  });

  it('已有 response 的轮不被重复处理', async () => {
    const s = mkSession('reconcile-has-resp');
    mkRound(s, 1);
    // 手动写 response（模拟已完成但无 ack 的异常情形）
    writeText(paths.response(s, 1), '已有回复');

    const results = await reconcile({ driver: goodDriver });
    assert.equal(results.filter((r) => r.session === s).length, 0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('processRound', () => {
  const goodDriver = () => Promise.resolve({ sessionId: 'ses_PR', text: 'PR 回复' });

  it('ack 已存在时返回 skipped', async () => {
    const s = mkSession('pr-skip-1');
    mkRound(s, 1);
    // 预先写 ack
    writeJSON(paths.ack(s, 1), { claimedAt: new Date().toISOString(), pid: 99 });

    const result = await processRound(s, 1, { driver: goodDriver });
    assert.equal(result.status, 'skipped');
  });

  it('成功时写 ack + response + status=responded', async () => {
    const s = mkSession('pr-success-1');
    mkRound(s, 1);

    const result = await processRound(s, 1, { driver: goodDriver });
    assert.equal(result.status, 'responded');
    assert.ok(exists(paths.ack(s, 1)));
    assert.ok(exists(paths.response(s, 1)));
    assert.equal(readStatus(s).state, 'responded');
    assert.equal(readStatus(s).driverSource, 'subscription');
    assert.equal(result.driverSource, 'subscription');
  });

  it('SDK 托底成功时响应前置计费标注，并把来源写入 status', async () => {
    const s = mkSession('pr-sdk-fallback');
    mkRound(s, 1);
    const sdkDriver = () => Promise.resolve({
      sessionId: 'ses_SDK_PR',
      text: 'SDK 回复',
      driverSource: 'sdk-fallback',
    });

    const result = await processRound(s, 1, { driver: sdkDriver });

    assert.equal(result.driverSource, 'sdk-fallback');
    assert.equal(readStatus(s).driverSource, 'sdk-fallback');
    assert.equal(
      fs.readFileSync(paths.response(s, 1), 'utf8'),
      '（本次由 SDK 托底执行，走 API 计费）\n\nSDK 回复',
    );
  });

  it('SDK 托底失败时保留 driverSource 供状态展示', async () => {
    const s = mkSession('pr-sdk-fallback-error');
    mkRound(s, 1);
    const sdkFailure = () => Promise.reject({
      kind: 'driver',
      message: 'SDK 托底失败',
      driverSource: 'sdk-fallback',
    });

    const result = await processRound(s, 1, { driver: sdkFailure });

    assert.equal(result.driverSource, 'sdk-fallback');
    assert.equal(readStatus(s).driverSource, 'sdk-fallback');
    assert.equal(readJSON(paths.error(s, 1)).driverSource, 'sdk-fallback');
  });

  it('driver 启动失败时错误文案跟随当前 agent', async () => {
    const s = mkSession('pr-codex-driver-error');
    mkRound(s, 1);
    const codexFailure = () => Promise.reject({
      kind: 'driver',
      message: 'spawn codex ENOENT',
      driverSource: 'subscription',
      agent: 'codex',
    });

    await processRound(s, 1, { driver: codexFailure });

    const error = readJSON(paths.error(s, 1));
    assert.match(error.userMessage, /Codex/);
    assert.match(error.suggestedAction, /`codex`/);
    assert.doesNotMatch(error.userMessage, /Claude/);
  });

  it('写 ack 中含 pid', async () => {
    const s = mkSession('pr-ack-pid');
    mkRound(s, 1);

    await processRound(s, 1, { driver: goodDriver });

    const ack = readJSON(paths.ack(s, 1));
    assert.ok(ack.claimedAt);
    assert.equal(ack.pid, process.pid);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('markDead', () => {
  it('写入 supervisorState=dead', () => {
    const s = mkSession('dead-1');
    markDead(s);
    const status = readStatus(s);
    assert.equal(status.supervisorState, 'dead');
  });
});
