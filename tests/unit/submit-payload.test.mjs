import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackItems, submitPayload } from '../../src/render/submit-payload.mjs';

test('feedbackItems 保留普通回答与各类复合反馈的顺序', () => {
  const items = feedbackItems({
    verdict: { verdict: '赞成', comment: '理由', comments: [{ quote: '原文', text: '批注' }], checklistItems: { i1: '异议' }, moves: { w1: { x: 0.1 } }, pins: [{ xPct: 20, yPct: 30, text: '图注' }] },
    commentOnly: { comment: '仅留言' },
    confirmed: { confirmed: true },
  });
  assert.deepEqual(items, [
    { blockId: 'verdict', type: 'verdict', value: '赞成', comment: '理由' },
    { blockId: 'verdict', type: 'pin', value: { quote: '原文' }, comment: '批注' },
    { blockId: 'verdict', type: 'select', value: 'i1:异议' },
    { blockId: 'verdict', type: 'move', value: { widgetId: 'w1', x: 0.1 } },
    { blockId: 'verdict', type: 'pin', value: { xPct: 20, yPct: 30 }, comment: '图注' },
    { blockId: 'commentOnly', type: 'comment', value: null, comment: '仅留言' },
    { blockId: 'confirmed', type: 'confirm', value: '保持原样', comment: undefined },
  ]);
});

test('submitPayload 只接收数据并规范化 round、会话留言和 selfReport', () => {
  assert.deepEqual(submitPayload({
    session: 'demo', round: '2', submittedAt: '2026-08-22T00:00:00.000Z', draft: {}, unanswered: ['b1'], sessionComment: '  留言  ', selfReport: { name: '小艾' },
  }), { session: 'demo', round: 2, submittedAt: '2026-08-22T00:00:00.000Z', items: [], unanswered: ['b1'], sessionComment: '留言', selfReport: { name: '小艾' } });
  assert.equal(submitPayload({ session: 'demo', round: 1, submittedAt: 'now', draft: {}, unanswered: [], sessionComment: '' }).sessionComment, null);
});
