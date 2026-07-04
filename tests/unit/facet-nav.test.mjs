// tab 分面导航协议（DESIGN §15）：groupBySection / sectionPendingStats / hasSections / confirmModel 必须·可选拆分
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBySection, sectionPendingStats, hasSections, confirmModel } from '../../src/protocol/attention.mjs';
import { DEFAULT_SECTIONS } from '../../src/protocol/constants.mjs';

const blocks = [
  { id: 'r1', section: '需求', needsDecision: true, hasRecommendation: false },
  { id: 'a1', section: '架构', needsDecision: false },
  { id: 'a2', section: '架构', needsDecision: true, hasRecommendation: true },
  { id: 'x1', section: '自定义面', needsDecision: false },
  { id: 'm1', needsDecision: false },   // 无 section → 其他
];

test('groupBySection: canonical 顺序全保留（空面留作灰 tab）', () => {
  const groups = groupBySection(blocks);
  const names = groups.map((g) => g.section);
  // 前 6 个是 canonical，顺序一致
  assert.deepEqual(names.slice(0, DEFAULT_SECTIONS.length), DEFAULT_SECTIONS);
  // UI 设计 / 交互设计 无内容但仍在（空组）
  const ui = groups.find((g) => g.section === 'UI 设计');
  assert.equal(ui.blocks.length, 0);
});

test('groupBySection: 块归入对应面，自定义面追加，无 section → 其他', () => {
  const groups = groupBySection(blocks);
  assert.deepEqual(groups.find((g) => g.section === '需求').blocks.map((b) => b.id), ['r1']);
  assert.deepEqual(groups.find((g) => g.section === '架构').blocks.map((b) => b.id), ['a1', 'a2']);
  // 自定义面在 canonical 之后
  const idxCustom = groups.findIndex((g) => g.section === '自定义面');
  const idxMisc = groups.findIndex((g) => g.section === '其他');
  assert.ok(idxCustom >= DEFAULT_SECTIONS.length, '自定义面在 canonical 之后');
  assert.equal(groups[idxMisc].blocks.map((b) => b.id).join(''), 'm1');
  assert.ok(idxMisc > idxCustom, '其他 在最后');
});

test('groupBySection: 无「其他」块时不出现「其他」组', () => {
  const groups = groupBySection([{ id: 'q', section: '需求', needsDecision: false }]);
  assert.equal(groups.some((g) => g.section === '其他'), false);
});

test('groupBySection: content.sections 覆盖 canonical 顺序', () => {
  const groups = groupBySection(blocks, ['架构', '需求']);
  assert.equal(groups[0].section, '架构');
  assert.equal(groups[1].section, '需求');
});

test('sectionPendingStats: 空草稿 → 必须/可接受分别计数', () => {
  assert.deepEqual(sectionPendingStats([blocks[0]], {}), { must: 1, optional: 0 });   // r1 无推荐=必须
  assert.deepEqual(sectionPendingStats([blocks[1], blocks[2]], {}), { must: 0, optional: 1 }); // a2 有推荐=可接受
});

test('sectionPendingStats: 已答的决策不再计入', () => {
  assert.deepEqual(sectionPendingStats([blocks[0]], { r1: { verdict: '赞成' } }), { must: 0, optional: 0 });
});

test('hasSections: 有 section 或 content.sections → true；都无 → false', () => {
  assert.equal(hasSections(blocks), true);
  assert.equal(hasSections([{ id: 'p', needsDecision: true }]), false);
  assert.equal(hasSections([{ id: 'p' }], ['需求']), true);
});

test('confirmModel: 未表态拆成 必须(无推荐) / 可接受(有推荐)', () => {
  const cb = [
    { id: 'must1', needsDecision: true, hasRecommendation: false, title: '必答' },
    { id: 'opt1', needsDecision: true, hasRecommendation: true, title: '可接受' },
  ];
  const m0 = confirmModel(cb, []);
  assert.deepEqual(m0.unansweredMust.map((u) => u.id), ['must1']);
  assert.deepEqual(m0.unansweredOptional.map((u) => u.id), ['opt1']);
  assert.equal(m0.unanswered.length, 2);   // 兼容字段仍全量
  const m1 = confirmModel(cb, ['must1']);
  assert.equal(m1.unansweredMust.length, 0);
  assert.deepEqual(m1.unansweredOptional.map((u) => u.id), ['opt1']);
});
