// confirmModel（DESIGN §13 P0-1）：提交前确认模型——把 id 映射为含 title/importance 的对象
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmModel } from '../../src/protocol/attention.mjs';

const blocks = [
  { id: 'a1', title: '选架构', type: 'choice', needsDecision: true, hasRecommendation: false, importance: 'high' },
  { id: 'a2', title: '选风格', type: 'choice', needsDecision: true, hasRecommendation: true, importance: 'normal' },
  { id: 'd1', title: '端口', type: 'markdown', needsDecision: false, importance: 'high', default: '8099' },
  { id: 'd2', title: '日志级别', type: 'markdown', needsDecision: false, importance: 'normal', default: 'info' },
];

test('confirmModel: 无已答 → 全部决策未表态、重要默认逐条带 title', () => {
  const m = confirmModel(blocks, []);
  assert.equal(m.decided, 0);
  assert.equal(m.acceptedDefaults, 2);            // d1 + d2
  assert.equal(m.unanswered.length, 2);           // a1 + a2
  assert.deepEqual(m.unanswered.map((u) => u.id).sort(), ['a1', 'a2']);
  // 未表态项带 title 与 importance，供模态展开
  const a1 = m.unanswered.find((u) => u.id === 'a1');
  assert.equal(a1.title, '选架构');
  assert.equal(a1.importance, 'high');
  // 仅重要默认进 importantDefaults，且带 title + default 值
  assert.equal(m.importantDefaults.length, 1);
  assert.equal(m.importantDefaults[0].id, 'd1');
  assert.equal(m.importantDefaults[0].title, '端口');
  assert.equal(m.importantDefaults[0].default, '8099');
});

test('confirmModel: 部分已答 → decided 计入、unanswered 排除已答', () => {
  const m = confirmModel(blocks, ['a1']);
  assert.equal(m.decided, 1);
  assert.equal(m.unanswered.length, 1);
  assert.equal(m.unanswered[0].id, 'a2');
});

test('confirmModel: 全部已答 → 无未表态', () => {
  const m = confirmModel(blocks, ['a1', 'a2']);
  assert.equal(m.decided, 2);
  assert.equal(m.unanswered.length, 0);
});

test('confirmModel: 缺 title 时回退用 id', () => {
  const m = confirmModel([{ id: 'x9', needsDecision: true, hasRecommendation: false }], []);
  assert.equal(m.unanswered[0].title, 'x9');
});

test('confirmModel: 空输入不抛错', () => {
  const m = confirmModel([], []);
  assert.equal(m.decided, 0);
  assert.equal(m.acceptedDefaults, 0);
  assert.equal(m.unanswered.length, 0);
  assert.equal(m.importantDefaults.length, 0);
});
