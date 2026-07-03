// countAnsweredDecisions / pendingDecisionBlocks（DESIGN §13 P2）：决策进度「已填 m/X」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countAnsweredDecisions, pendingDecisionBlocks } from '../../src/protocol/attention.mjs';

const blocks = [
  { id: 'a1', type: 'verdict', needsDecision: true, _change: 'new' },
  { id: 'a2', type: 'choice', needsDecision: true, _change: 'changed' },
  { id: 's1', type: 'choice', needsDecision: true, _change: 'unchanged' },   // 沉降：不计入分母
  { id: 'ctx', type: 'markdown', needsDecision: false, _change: 'new' },       // 非决策：不计入
];

test('pendingDecisionBlocks: 排除 unchanged 与非决策块', () => {
  const p = pendingDecisionBlocks(blocks).map((b) => b.id);
  assert.deepEqual(p.sort(), ['a1', 'a2']);
});

test('countAnsweredDecisions: 只计已做出决策的待决策块', () => {
  const draft = {
    a1: { verdict: '赞成' },       // 已决
    a2: {},                        // 未决
    s1: { select: 'o1' },          // 沉降块即使有值也不计入分母
  };
  assert.equal(countAnsweredDecisions(blocks, draft), 1);
});

test('countAnsweredDecisions: 纯评论不算已决', () => {
  const draft = { a1: { comment: '随便说两句' } };
  assert.equal(countAnsweredDecisions(blocks, draft), 0);
});

test('countAnsweredDecisions: 各决策类型（select/text/checklist）均计入', () => {
  assert.equal(countAnsweredDecisions(blocks, { a1: { select: 'o1' }, a2: { text: '改成这样' } }), 2);
  assert.equal(countAnsweredDecisions(blocks, { a1: { checklistItems: { i1: '赞成' } } }), 1);
  // 空 text / 空 checklist 不算
  assert.equal(countAnsweredDecisions(blocks, { a1: { text: '   ' } }), 0);
  assert.equal(countAnsweredDecisions(blocks, { a1: { checklistItems: {} } }), 0);
});

test('countAnsweredDecisions: 空草稿 = 0，不抛错', () => {
  assert.equal(countAnsweredDecisions(blocks, {}), 0);
  assert.equal(countAnsweredDecisions(blocks, undefined), 0);
  assert.equal(countAnsweredDecisions([], {}), 0);
});
