import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, validateBlock, validateFeedback, blockFingerprint } from '../../src/protocol/schema.mjs';
import { computeDiff, filterChanged, removedBlocks, diffSanity } from '../../src/protocol/diff.mjs';
import { routeBlocks, decisionStats, unansweredDecisions, submitSummary, roundDeltaStats } from '../../src/protocol/attention.mjs';
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

test('validateBlock: embed requires url', () => {
  // valid embed: has url
  assert.equal(validateBlock({ id: 'e1', type: 'embed', url: 'https://example.com' }).ok, true);
  // invalid embed: missing url
  assert.equal(validateBlock({ id: 'e2', type: 'embed' }).ok, false);
  // invalid embed: empty url
  assert.equal(validateBlock({ id: 'e3', type: 'embed', url: '' }).ok, false);
});

test('validateFeedback: accepts pin type with xPct/yPct value', () => {
  const fb = {
    session: 's',
    round: 1,
    items: [{ blockId: 'e1', type: 'pin', value: { xPct: 40, yPct: 60 }, comment: '这里有问题' }],
  };
  assert.equal(validateFeedback(fb).ok, true);
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
    { id: '6', type: 'markdown', needsDecision: false, importance: 'low' },                  // 无 default → 叙述内容(可见)
    { id: '7', type: 'markdown', needsDecision: false, importance: 'low', default: 'x' },    // 有 default → 折叠
  ];
  const z = routeBlocks(blocks);
  assert.deepEqual(z.zoneA.map((b) => b.id), ['4', '1']);       // high 先于 normal
  assert.deepEqual(z.zoneB.map((b) => b.id), ['2', '5']);       // high 先于 low
  assert.deepEqual(z.zoneContext.map((b) => b.id), ['6']);      // 纯叙述/图表：可见不折叠
  assert.deepEqual(z.zoneCReview.map((b) => b.id), ['3']);      // 重要默认建议过目
  assert.deepEqual(z.zoneCFyi.map((b) => b.id), ['7']);        // 普通默认折叠
});

// ---------- routeBlocks _change 分区单测（改动 A'，§4）----------

test('routeBlocks: unchanged blocks → zoneSettled, not zoneA/B/zoneContext', () => {
  const blocks = [
    { id: 'u1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'unchanged' },
    { id: 'u2', type: 'markdown', needsDecision: false, _change: 'unchanged' },
  ];
  const z = routeBlocks(blocks);
  assert.deepEqual(z.zoneSettled.map((b) => b.id), ['u1', 'u2'], 'unchanged → zoneSettled');
  assert.deepEqual(z.zoneA, [], 'zoneA empty for unchanged');
  assert.deepEqual(z.zoneContext, [], 'zoneContext empty for unchanged');
});

test('routeBlocks: new/changed blocks → 常显区 (zoneA/B/zoneContext), not zoneSettled', () => {
  const blocks = [
    { id: 'n1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'c1', type: 'choice', needsDecision: true, hasRecommendation: true, _change: 'changed',
      options: [{ id: 'o1' }], recommendation: 'o1' },
    { id: 'ctx1', type: 'markdown', needsDecision: false, _change: 'new' },
  ];
  const z = routeBlocks(blocks);
  assert.deepEqual(z.zoneSettled, [], 'zoneSettled empty for new/changed');
  assert.ok(z.zoneA.some((b) => b.id === 'n1'), 'new verdict → zoneA');
  assert.ok(z.zoneB.some((b) => b.id === 'c1'), 'changed choice with rec → zoneB');
  assert.ok(z.zoneContext.some((b) => b.id === 'ctx1'), 'new fyi markdown → zoneContext');
});

test('routeBlocks: 首轮全 new → zoneSettled 为空', () => {
  const blocks = [
    { id: 'a', type: 'verdict', needsDecision: true, _change: 'new' },
    { id: 'b', type: 'markdown', needsDecision: false, _change: 'new' },
  ];
  const z = routeBlocks(blocks);
  assert.deepEqual(z.zoneSettled, [], '首轮全 new 时 zoneSettled 应为空');
});

test('routeBlocks: _decidedInPrev=true → zoneSettled 即使无 _change 字段', () => {
  const blocks = [
    { id: 'dp1', type: 'verdict', needsDecision: true, _decidedInPrev: true },
  ];
  const z = routeBlocks(blocks);
  assert.ok(z.zoneSettled.some((b) => b.id === 'dp1'), '_decidedInPrev=true → zoneSettled');
  assert.deepEqual(z.zoneA, [], 'zoneA empty for _decidedInPrev');
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

// ---------- roundDeltaStats（改动 B，DESIGN §4）----------

test('roundDeltaStats: 正常多轮场景——totalDecision/newDecision/changedDecision/newFyi', () => {
  const blocks = [
    { id: 'd1', needsDecision: true, _change: 'new' },
    { id: 'd2', needsDecision: true, _change: 'changed' },
    { id: 'd3', needsDecision: true, _change: 'unchanged' },
    { id: 'f1', needsDecision: false, _change: 'new' },
    { id: 'f2', needsDecision: false, _change: 'changed' },
    { id: 'f3', needsDecision: false, _change: 'unchanged' },
  ];
  const s = roundDeltaStats(blocks);
  assert.equal(s.totalDecision, 3, 'totalDecision = all needsDecision blocks');
  assert.equal(s.newDecision, 1, 'newDecision = 1');
  assert.equal(s.changedDecision, 1, 'changedDecision = 1');
  assert.equal(s.newFyi, 1, 'newFyi = non-decision blocks with _change=new');
});

test('roundDeltaStats: 首轮全 new → newDecision === totalDecision, changedDecision === 0', () => {
  const blocks = [
    { id: 'a', needsDecision: true, _change: 'new' },
    { id: 'b', needsDecision: true, _change: 'new' },
    { id: 'c', needsDecision: false, _change: 'new' },
  ];
  const s = roundDeltaStats(blocks);
  assert.equal(s.totalDecision, 2);
  assert.equal(s.newDecision, 2, '首轮全 new: newDecision === totalDecision');
  assert.equal(s.changedDecision, 0, '首轮无 changed');
  assert.equal(s.newFyi, 1);
});

test('roundDeltaStats: 空数组不报错', () => {
  const s = roundDeltaStats([]);
  assert.equal(s.totalDecision, 0);
  assert.equal(s.newDecision, 0);
  assert.equal(s.changedDecision, 0);
  assert.equal(s.newFyi, 0);
});

test('roundDeltaStats: 仅统计 needsDecision 块的 new/changed；FYI 块的 changed 不计入 changedDecision', () => {
  const blocks = [
    { id: 'x1', needsDecision: false, _change: 'changed' }, // FYI changed，不算 changedDecision
    { id: 'x2', needsDecision: true, _change: 'changed' },  // decision changed
  ];
  const s = roundDeltaStats(blocks);
  assert.equal(s.totalDecision, 1);
  assert.equal(s.changedDecision, 1);
  assert.equal(s.newFyi, 0, 'FYI changed 不算 newFyi');
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
