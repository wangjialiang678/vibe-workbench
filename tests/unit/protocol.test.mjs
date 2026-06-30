import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, validateBlock, validateFeedback, blockFingerprint } from '../../src/protocol/schema.mjs';
import { computeDiff, filterChanged, removedBlocks, diffSanity } from '../../src/protocol/diff.mjs';
import { routeBlocks, decisionStats, unansweredDecisions, submitSummary } from '../../src/protocol/attention.mjs';
import { displayState, errorRetryable, badgeFor } from '../../src/protocol/status.mjs';

// ---------- schema ----------
test('validateContent: valid', () => {
  const c = { session: 's1', round: 1, blocks: [{ id: 'a', type: 'markdown', body: 'x' }] };
  assert.equal(validateContent(c).ok, true);
});

test('validateContent: bad round + dup id + bad type', () => {
  const c = { session: 's1', round: 0, blocks: [{ id: 'a', type: 'nope' }, { id: 'a', type: 'markdown' }] };
  const r = validateContent(c);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('round')));
  assert.ok(r.errors.some((e) => e.includes('duplicate')));
  assert.ok(r.errors.some((e) => e.includes('invalid')));
});

test('validateBlock: choice options + recommendation match', () => {
  assert.equal(validateBlock({ id: 'c', type: 'choice', options: [] }).ok, false);
  assert.equal(validateBlock({ id: 'c', type: 'choice', options: [{ id: 'o1' }], hasRecommendation: true, recommendation: 'oX' }).ok, false);
  assert.equal(validateBlock({ id: 'c', type: 'choice', options: [{ id: 'o1' }], hasRecommendation: true, recommendation: 'o1' }).ok, true);
});

test('validateFeedback', () => {
  assert.equal(validateFeedback({ session: 's', round: 1, items: [{ blockId: 'a', type: 'verdict', value: '赞成' }] }).ok, true);
  assert.equal(validateFeedback({ session: 's', round: 1, items: [{ type: 'bad' }] }).ok, false);
});

test('fingerprint stable + sensitive', () => {
  const b1 = { id: 'a', type: 'markdown', body: 'hi' };
  const b2 = { id: 'a', type: 'markdown', body: 'hi', importance: 'high' }; // 非指纹字段不影响
  const b3 = { id: 'a', type: 'markdown', body: 'bye' };
  assert.equal(blockFingerprint(b1), blockFingerprint(b2));
  assert.notEqual(blockFingerprint(b1), blockFingerprint(b3));
});

// ---------- diff ----------
test('computeDiff: new/changed/unchanged + changedFields/_prev', () => {
  const prev = [{ id: 'a', type: 'markdown', body: 'x' }, { id: 'b', type: 'markdown', body: 'y' }];
  const cur = [{ id: 'a', type: 'markdown', body: 'x' }, { id: 'b', type: 'markdown', body: 'y2' }, { id: 'c', type: 'markdown', body: 'z' }];
  const d = computeDiff(cur, prev);
  assert.equal(d.find((b) => b.id === 'a')._change, 'unchanged');
  const bChanged = d.find((b) => b.id === 'b');
  assert.equal(bChanged._change, 'changed');
  assert.deepEqual(bChanged._changedFields, ['body']);
  assert.equal(bChanged._prev.body, 'y');
  assert.equal(d.find((b) => b.id === 'c')._change, 'new');
});

test('computeDiff: no prev → all new; removedBlocks; filterChanged', () => {
  assert.equal(computeDiff([{ id: 'a', type: 'markdown' }])[0]._change, 'new');
  const cur = [{ id: 'a', type: 'markdown' }];
  const prev = [{ id: 'a', type: 'markdown' }, { id: 'z', type: 'markdown' }];
  assert.deepEqual(removedBlocks(cur, prev).map((b) => b.id), ['z']);
  const filtered = filterChanged(computeDiff([{ id: 'a', type: 'markdown', body: 'x' }], [{ id: 'a', type: 'markdown', body: 'x' }]));
  assert.equal(filtered.length, 0);
});

test('diffSanity flags possible reorg', () => {
  const cur = computeDiff([{ id: 'n1', type: 'markdown' }, { id: 'n2', type: 'markdown' }, { id: 'n3', type: 'markdown' }], []);
  const removed = [{ id: 'o1' }, { id: 'o2' }];
  assert.equal(diffSanity(cur, removed).suspect, true);
});

// ---------- attention ----------
test('routeBlocks: zones + importance order + stable + zoneC split', () => {
  const blocks = [
    { id: '1', type: 'verdict', needsDecision: true, hasRecommendation: false, importance: 'normal' },
    { id: '2', type: 'choice', needsDecision: true, hasRecommendation: true, importance: 'high' },
    { id: '3', type: 'markdown', needsDecision: false, importance: 'high', default: 'd' },
    { id: '4', type: 'verdict', needsDecision: true, hasRecommendation: false, importance: 'high' },
    { id: '5', type: 'choice', needsDecision: true, hasRecommendation: true, importance: 'low' },
    { id: '6', type: 'markdown', needsDecision: false, importance: 'low' },
  ];
  const z = routeBlocks(blocks);
  assert.deepEqual(z.zoneA.map((b) => b.id), ['4', '1']);       // high 先于 normal
  assert.deepEqual(z.zoneB.map((b) => b.id), ['2', '5']);       // high 先于 low
  assert.deepEqual(z.zoneCReview.map((b) => b.id), ['3']);      // 重要默认建议过目
  assert.deepEqual(z.zoneCFyi.map((b) => b.id), ['6']);        // 普通默认折叠
});

test('decisionStats / unansweredDecisions / submitSummary', () => {
  const blocks = [
    { id: '1', needsDecision: true, hasRecommendation: false },
    { id: '2', needsDecision: true, hasRecommendation: true },
    { id: '3', needsDecision: false, default: 'x', importance: 'high' },
  ];
  const s = decisionStats(blocks);
  assert.equal(s.needsDecision, 2);
  assert.equal(s.noRecommendation, 1);
  assert.deepEqual(unansweredDecisions(blocks, ['1']), ['2']);
  const sum = submitSummary(blocks, ['1']);
  assert.equal(sum.decided, 1);
  assert.deepEqual(sum.unanswered, ['2']);
  assert.equal(sum.acceptedDefaults, 1);
  assert.deepEqual(sum.importantDefaults, ['3']);
});

// ---------- status (P0-2 心跳联合判定) ----------
test('displayState: claimed + fresh heartbeat = processing (never false-offline)', () => {
  const now = 1_000_000;
  const fresh = new Date(now - 5000).toISOString();
  assert.equal(displayState({ state: 'claimed', heartbeatAt: fresh }, now), 'processing');
});

test('displayState: claimed + stale heartbeat = offline', () => {
  const now = 1_000_000;
  const stale = new Date(now - 60_000).toISOString();
  assert.equal(displayState({ state: 'claimed', heartbeatAt: stale }, now), 'offline');
});

test('displayState: submitted fresh vs stale; dead terminal; error/responded', () => {
  const now = 1_000_000;
  const fresh = new Date(now - 1000).toISOString();
  const stale = new Date(now - 60_000).toISOString();
  assert.equal(displayState({ state: 'submitted', heartbeatAt: fresh }, now), 'submitted');
  assert.equal(displayState({ state: 'submitted', heartbeatAt: stale }, now), 'offline');
  assert.equal(displayState({ state: 'claimed', heartbeatAt: fresh, supervisorState: 'dead' }, now), 'dead');
  assert.equal(displayState({ state: 'error' }, now), 'error');
  assert.equal(displayState({ state: 'responded' }, now), 'responded');
});

test('errorRetryable + badgeFor', () => {
  assert.equal(errorRetryable('driver'), false);
  assert.equal(errorRetryable('timeout'), true);
  assert.equal(badgeFor('offline').retry, true);
  assert.equal(badgeFor('processing').retry, 'force');
  assert.match(badgeFor('processing', { elapsedSec: 23 }).text, /23s/);
});
