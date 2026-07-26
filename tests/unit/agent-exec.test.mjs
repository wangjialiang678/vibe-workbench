// tests/unit/agent-exec.test.mjs — 三方本地 AI driver 的离线契约测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const agentModule = await import('../../src/loop/agent-exec.mjs').catch(() => ({}));
const {
  resolveAgent,
  resolveWorkBuddyBinary,
  runAgent,
} = agentModule;

const WORKBUDDY_APP_BIN = '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';

function requireExport(value, name) {
  assert.equal(typeof value, 'function', `${name} 应导出为函数`);
}

test('WorkBuddy 查找接受 Windows 约定的 Path 环境变量名', () => {
  requireExport(resolveWorkBuddyBinary, 'resolveWorkBuddyBinary');
  const binary = resolveWorkBuddyBinary({
    env: { Path: '/cross-platform/bin' },
    isExecutable(candidate) {
      return candidate === '/cross-platform/bin/codebuddy';
    },
  });

  assert.equal(binary, 'codebuddy');
});

function streamResult(sessionId, text) {
  return `${JSON.stringify({ type: 'result', session_id: sessionId, result: text })}\n`;
}

function scriptedSpawn(steps) {
  const calls = [];
  const children = [];

  const spawnImpl = (command, argv, options) => {
    const step = steps[calls.length];
    if (!step) throw new Error('不应该出现额外的 spawn 调用');
    if (step.throwError) throw step.throwError;

    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killedWith = [];
    child.kill = (signal) => {
      child.killedWith.push(signal);
      if (step.closeOnKill) child.emit('close', null, signal);
      return true;
    };

    calls.push({ command, argv, options });
    children.push(child);

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

  return { spawnImpl, calls, children };
}

async function withEnv(patch, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, Object.hasOwn(process.env, key) ? process.env[key] : undefined);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('claude：无 sessionId 时使用 stream-json argv 并解析输出', async () => {
  requireExport(runAgent, 'runAgent');
  const { spawnImpl, calls } = scriptedSpawn([
    { code: 0, stdout: streamResult('claude-new', 'Claude 回复') },
  ]);

  const result = await runAgent({ agent: 'claude', prompt: 'hello', spawnImpl });

  assert.equal(calls[0].command, 'claude');
  assert.deepEqual(calls[0].argv, [
    '-p', 'hello', '--output-format', 'stream-json', '--verbose',
  ]);
  assert.deepEqual(result, {
    sessionId: 'claude-new',
    text: 'Claude 回复',
    driverSource: 'subscription',
  });
});

test('claude：有 sessionId 时追加 --resume', async () => {
  requireExport(runAgent, 'runAgent');
  const { spawnImpl, calls } = scriptedSpawn([
    { code: 0, stdout: streamResult('claude-old', '继续回复') },
  ]);

  await runAgent({
    agent: 'claude',
    prompt: 'continue',
    sessionId: 'claude-old',
    spawnImpl,
  });

  assert.deepEqual(calls[0].argv, [
    '-p', 'continue', '--output-format', 'stream-json', '--verbose',
    '--resume', 'claude-old',
  ]);
});

test('workbuddy：无 sessionId 时复用兼容 argv 并解析 stream-json', async () => {
  requireExport(runAgent, 'runAgent');
  await withEnv({ WORKBENCH_WORKBUDDY_BIN: '/custom/codebuddy' }, async () => {
    const { spawnImpl, calls } = scriptedSpawn([
      { code: 0, stdout: streamResult('buddy-new', 'WorkBuddy 回复') },
    ]);

    const result = await runAgent({ agent: 'workbuddy', prompt: 'hello', spawnImpl });

    assert.equal(calls[0].command, '/custom/codebuddy');
    assert.deepEqual(calls[0].argv, [
      '-p', 'hello', '--output-format', 'stream-json', '--verbose',
    ]);
    assert.deepEqual(result, {
      sessionId: 'buddy-new',
      text: 'WorkBuddy 回复',
      driverSource: 'subscription',
    });
  });
});

test('workbuddy：有 sessionId 时追加 --resume', async () => {
  requireExport(runAgent, 'runAgent');
  await withEnv({ WORKBENCH_WORKBUDDY_BIN: '/custom/codebuddy' }, async () => {
    const { spawnImpl, calls } = scriptedSpawn([
      { code: 0, stdout: streamResult('buddy-old', '继续回复') },
    ]);

    await runAgent({
      agent: 'workbuddy',
      prompt: 'continue',
      sessionId: 'buddy-old',
      spawnImpl,
    });

    assert.deepEqual(calls[0].argv, [
      '-p', 'continue', '--output-format', 'stream-json', '--verbose',
      '--resume', 'buddy-old',
    ]);
  });
});

test('codex：无 sessionId 时使用 codex exec 并剥离元数据与 token 统计', async () => {
  requireExport(runAgent, 'runAgent');
  const stdout = [
    'Codex 回复',
    'session id: model-mentioned-id',
    '- 已完成',
  ].join('\n');
  const stderr = [
    'OpenAI Codex v0.144.1',
    '--------',
    'workdir: /tmp/demo',
    'model: gpt-test',
    'session id: 019c-session-new',
    '--------',
    'user',
    'hello',
    'tokens used',
    '1,024',
  ].join('\n');
  const { spawnImpl, calls } = scriptedSpawn([{ code: 0, stdout, stderr }]);

  const result = await runAgent({
    agent: 'codex',
    prompt: 'hello',
    cwd: '/tmp/demo',
    spawnImpl,
  });

  assert.equal(calls[0].command, 'codex');
  assert.deepEqual(calls[0].argv, [
    'exec', '-C', '/tmp/demo', '--skip-git-repo-check', 'hello',
  ]);
  assert.deepEqual(result, {
    sessionId: '019c-session-new',
    text: 'Codex 回复\n- 已完成',
    driverSource: 'subscription',
  });
});

test('codex：有 sessionId 时使用 exec resume 并保留续接 id', async () => {
  requireExport(runAgent, 'runAgent');
  const { spawnImpl, calls } = scriptedSpawn([
    { code: 0, stdout: 'assistant\n继续回复\ntotal tokens\n42' },
  ]);

  const result = await runAgent({
    agent: 'codex',
    prompt: 'continue',
    sessionId: '019c-session-old',
    cwd: '/tmp/demo',
    spawnImpl,
  });

  assert.deepEqual(calls[0].argv, [
    'exec', '-C', '/tmp/demo', '--skip-git-repo-check',
    'resume', '019c-session-old', 'continue',
  ]);
  assert.equal(result.sessionId, '019c-session-old');
  assert.equal(result.text, '继续回复');
});

test('共享执行内核：软超时发送 SIGTERM 并抛 timeout', async () => {
  requireExport(runAgent, 'runAgent');
  const { spawnImpl, children } = scriptedSpawn([{ closeOnKill: true }]);

  await assert.rejects(
    runAgent({ agent: 'codex', prompt: 'slow', timeoutMs: 5, spawnImpl }),
    (error) => {
      assert.equal(error.kind, 'timeout');
      assert.equal(error.driverSource, 'subscription');
      assert.equal(error.agent, 'codex');
      assert.match(error.message, /codex process timed out after 5ms/);
      return true;
    },
  );
  assert.deepEqual(children[0].killedWith, ['SIGTERM']);
});

test('三个适配器非零退出都抛 { kind, message }', async () => {
  requireExport(runAgent, 'runAgent');
  await withEnv({
    ANTHROPIC_API_KEY: undefined,
    WORKBENCH_WORKBUDDY_BIN: '/custom/codebuddy',
  }, async () => {
    for (const [agent, label] of [
      ['claude', 'claude'],
      ['workbuddy', 'workbuddy'],
      ['codex', 'codex'],
    ]) {
      const { spawnImpl } = scriptedSpawn([{ code: 7, stderr: '认证失败 trace=req-7' }]);
      await assert.rejects(
        runAgent({ agent, prompt: 'fail', spawnImpl }),
        (error) => {
          assert.equal(error.kind, 'driver');
          assert.equal(error.driverSource, 'subscription');
          assert.equal(error.agent, agent);
          assert.match(error.message, new RegExp(`${label} exited with code 7`));
          assert.match(error.message, /trace=req-7/);
          return true;
        },
      );
    }
  });
});

test('共享执行内核：错误信息会脱敏环境密钥与 sk token', async () => {
  requireExport(runAgent, 'runAgent');
  await withEnv({ OPENAI_API_KEY: 'openai-secret-value' }, async () => {
    const { spawnImpl } = scriptedSpawn([{
      code: 1,
      stderr: [
        'auth failed OPENAI_API_KEY=openai-secret-value',
        'raw=openai-secret-value',
        'token=sk-proj-AbC_123',
        'TOKEN=bare-secret-value',
        'trace=req-safe',
      ].join('\n'),
    }]);

    await assert.rejects(
      runAgent({ agent: 'codex', prompt: 'fail', spawnImpl }),
      (error) => {
        assert.match(error.message, /OPENAI_API_KEY=\*\*\*/);
        assert.match(error.message, /TOKEN=\*\*\*/);
        assert.match(error.message, /trace=req-safe/);
        assert.doesNotMatch(error.message, /openai-secret-value/);
        assert.doesNotMatch(error.message, /bare-secret-value/);
        assert.doesNotMatch(error.message, /sk-proj-AbC_123/);
        return true;
      },
    );
  });
});

test('agent 参数优先于 WORKBENCH_AGENT', async () => {
  requireExport(runAgent, 'runAgent');
  await withEnv({ WORKBENCH_AGENT: 'codex' }, async () => {
    const { spawnImpl, calls } = scriptedSpawn([
      { code: 0, stdout: streamResult('claude-explicit', 'ok') },
    ]);

    await runAgent({ agent: 'claude', prompt: 'hello', spawnImpl });

    assert.equal(calls[0].command, 'claude');
  });
});

test('WORKBENCH_AGENT 选择 workbuddy 并使用配置的二进制', async () => {
  requireExport(runAgent, 'runAgent');
  await withEnv({
    WORKBENCH_AGENT: 'workbuddy',
    WORKBENCH_WORKBUDDY_BIN: '/configured/codebuddy',
  }, async () => {
    const { spawnImpl, calls } = scriptedSpawn([
      { code: 0, stdout: streamResult('buddy-env', 'ok') },
    ]);

    await runAgent({ prompt: 'hello', spawnImpl });

    assert.equal(calls[0].command, '/configured/codebuddy');
  });
});

test('自动探测顺序为 PATH claude → workbuddy → PATH codex', () => {
  requireExport(resolveAgent, 'resolveAgent');
  const env = {
    PATH: '/test/bin',
    WORKBENCH_WORKBUDDY_BIN: '/configured/codebuddy',
  };

  assert.deepEqual(resolveAgent({
    env,
    commandAvailable: () => true,
    isExecutable: () => true,
  }), { agent: 'claude', binary: 'claude' });

  assert.deepEqual(resolveAgent({
    env,
    commandAvailable: (command) => command !== 'claude',
    isExecutable: () => true,
  }), { agent: 'workbuddy', binary: '/configured/codebuddy' });

  assert.deepEqual(resolveAgent({
    env: { PATH: '/test/bin' },
    commandAvailable: (command) => command === 'codex',
    isExecutable: () => false,
  }), { agent: 'codex', binary: 'codex' });
});

test('WorkBuddy 二进制解析优先级为环境变量 → PATH → App 固定路径', () => {
  requireExport(resolveWorkBuddyBinary, 'resolveWorkBuddyBinary');

  assert.equal(resolveWorkBuddyBinary({
    env: { WORKBENCH_WORKBUDDY_BIN: '/configured/codebuddy', PATH: '/test/bin' },
    commandAvailable: () => true,
    isExecutable: () => true,
  }), '/configured/codebuddy');

  assert.equal(resolveWorkBuddyBinary({
    env: { PATH: '/test/bin' },
    commandAvailable: (command) => command === 'codebuddy',
    isExecutable: () => true,
  }), 'codebuddy');

  assert.equal(resolveWorkBuddyBinary({
    env: { PATH: '/test/bin' },
    commandAvailable: () => false,
    isExecutable: (candidate) => candidate === WORKBUDDY_APP_BIN,
  }), WORKBUDDY_APP_BIN);
});

test('三者都不可用时抛 driver，并说明安装与配置方式', () => {
  requireExport(resolveAgent, 'resolveAgent');

  assert.throws(
    () => resolveAgent({
      env: { PATH: '/empty' },
      commandAvailable: () => false,
      isExecutable: () => false,
    }),
    (error) => {
      assert.equal(error.kind, 'driver');
      assert.match(error.message, /claude/);
      assert.match(error.message, /codebuddy/);
      assert.match(error.message, /codex/);
      assert.match(error.message, /WORKBENCH_AGENT/);
      return true;
    },
  );
});

test('非法 WORKBENCH_AGENT 值抛 driver 并列出合法值', () => {
  requireExport(resolveAgent, 'resolveAgent');

  assert.throws(
    () => resolveAgent({
      env: { WORKBENCH_AGENT: 'other' },
      commandAvailable: () => false,
      isExecutable: () => false,
    }),
    (error) => {
      assert.equal(error.kind, 'driver');
      assert.match(error.message, /claude.*workbuddy.*codex/);
      return true;
    },
  );
});
