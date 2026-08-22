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
