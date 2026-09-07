import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMetricsForFeedback } from '../../src/server/card-metrics.mjs';

test('card-metrics 写入推荐偏离与盲判采集状态', () => {
  const [metric] = cardMetricsForFeedback({ blocks: [{ id: 'b-x', type: 'choice', mode: 'blind', judgmentKind: 'preference', recommendation: 'a' }] }, {
    submittedAt: '2026-09-07T00:03:00.000Z',
    items: [{ blockId: 'b-x', type: 'select', value: 'b', prediction: '会更快', premises: '', openedAt: '2026-09-07T00:00:00.000Z' }],
  });
  assert.equal(metric.changedFromRecommendation, true);
  assert.equal(metric.predictionProvided, true);
  assert.equal(metric.premisesProvided, false);
  assert.equal(metric.dwellMs, 180000);
});
