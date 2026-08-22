// tests/unit/agent-resolve.test.mjs — listener 与 agent-exec 共用 agent 配置解析
import test from 'node:test';
import assert from 'node:assert/strict';

import { configuredAgentName as agentExecConfiguredAgentName } from '../../src/loop/agent-exec.mjs';
import { configuredAgentName as listenerConfiguredAgentName } from '../../src/loop/listener.mjs';

for (const [name, env, expected] of [
  ['env 未设', {}, ''],
  ['合法 agent', { WORKBENCH_AGENT: '  CoDeX  ' }, 'codex'],
  ['非法 agent', { WORKBENCH_AGENT: 'other' }, 'other'],
]) {
  test(`agent 配置：${name}时 listener 与 agent-exec 结果一致`, () => {
    assert.equal(agentExecConfiguredAgentName(env), expected);
    assert.equal(listenerConfiguredAgentName(env), expected);
  });
}

// 真正要锁住的不变量：listener 不许再自己读环境变量。
// 上面那三条比较的是同一个函数（listener 只是转发导出），证明不了「没有第二份实现」。
test('listener.mjs 不得再直接读 WORKBENCH_AGENT', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.resolve(dir, '../../src/loop/listener.mjs'), 'utf8');
  assert.ok(
    !src.includes('WORKBENCH_AGENT'),
    'listener.mjs 应通过 agent-exec 的 configuredAgentName() 取值，不要再自己读环境变量',
  );
});
