import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DECISION_MAKER,
  decisionMakerSelectionValue,
  resolveDecisionMakers,
} from '../../src/protocol/decision-makers.mjs';
import { resolveSelfReportSelection } from '../../src/render/self-report-state.mjs';
import { acceptedSelfReport } from '../../src/server/auth.mjs';

test('决策人解析：空名册注入不带 token 的 owner/Michael', () => {
  const decisionMakers = resolveDecisionMakers([]);
  assert.deepEqual(decisionMakers, [{ id: 'owner', name: 'Michael', role: 'owner' }]);
  assert.equal(Object.hasOwn(decisionMakers[0], 'token'), false);
  assert.notEqual(decisionMakers[0], DEFAULT_DECISION_MAKER, '调用方不能改写冻结的默认常量');
});

test('决策人解析：非空名册原样返回，不混入 Michael', () => {
  const participants = [{ id: 'alice', name: '小艾' }];
  assert.equal(resolveDecisionMakers(participants), participants);
  assert.deepEqual(resolveDecisionMakers(participants), [{ id: 'alice', name: '小艾' }]);
});

test('默认 Michael 可被提交人解析并按 owner/Michael 落盘', () => {
  const decisionMakers = resolveDecisionMakers([]);
  const selected = resolveSelfReportSelection(
    decisionMakerSelectionValue(decisionMakers[0]),
    '',
    decisionMakers,
  );
  assert.deepEqual(selected, {
    explicit: true,
    mode: 'owner',
    label: 'Michael',
    report: { id: 'owner', name: 'Michael' },
  });
  assert.deepEqual(
    acceptedSelfReport(selected.report, { id: 'owner', role: 'owner' }, '/does/not/exist.json'),
    { id: 'owner', name: 'Michael' },
  );
});
