import test from 'node:test';
import assert from 'node:assert/strict';

import {
  submitButtonModel,
  submitStateAfterEdit,
  submitStateAfterFailure,
  submitStateAfterSuccess,
} from '../../src/render/submit-state.mjs';

test('提交成功后禁用按钮，后续编辑会开放“再次提交”', () => {
  assert.deepEqual(submitButtonModel('submitted'), { disabled: true, label: '已提交' });
  assert.equal(submitStateAfterEdit('submitted'), 'dirty');
  assert.deepEqual(submitButtonModel('dirty'), { disabled: false, label: '再次提交' });
});

test('请求进行中产生的新修改在成功后仍保持待补交', () => {
  assert.equal(submitStateAfterEdit('submitting'), 'submitting-dirty');
  assert.equal(submitStateAfterSuccess('submitting-dirty'), 'dirty');
});

test('提交失败恢复可点击状态，并保留补交语义', () => {
  assert.equal(submitStateAfterFailure('submitting', 'ready'), 'ready');
  assert.equal(submitStateAfterFailure('submitting', 'dirty'), 'dirty');
  assert.equal(submitStateAfterFailure('submitting-dirty', 'ready'), 'dirty');
});
