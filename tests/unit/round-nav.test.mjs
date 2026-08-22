import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRoundTitle, pickRound, shouldAdvance } from '../../src/render/round-nav.mjs';

test('pickRound 固定 URL 优先，跟随模式回退最新轮或第一轮', () => {
  assert.equal(pickRound('4', 9), 4);
  assert.equal(pickRound('', 9), 9);
  assert.equal(pickRound('', null), 1);
});

test('轮次标题和自动推进仅接受更高的整数轮次', () => {
  assert.equal(nextRoundTitle(5, '客户工作台'), '第 5 轮 — 客户工作台');
  assert.equal(nextRoundTitle(1, ''), '第 1 轮 — Vibe Coding工作台');
  assert.equal(shouldAdvance(3, 4), true);
  assert.equal(shouldAdvance(3, 3), false);
  assert.equal(shouldAdvance(null, 4), false);
  assert.equal(shouldAdvance(3, '4'), false);
});
