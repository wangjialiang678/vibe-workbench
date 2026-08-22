import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facetBadgeState, facetBadges, pickFacet } from '../../src/render/facet-state.mjs';

const groups = [{ section: '需求', blocks: [{ id: 'a' }] }, { section: 'UI 设计', blocks: [{ id: 'b' }] }, { section: '其他', blocks: [] }];
const stats = (blocks) => {
  if (!blocks.length) return { must: 0, optional: 0 };
  return blocks[0]?.id === 'a' ? { must: 1, optional: 0 } : { must: 0, optional: 2 };
};

test('pickFacet 深链优先，否则优先未答必须决策', () => {
  assert.equal(pickFacet(groups, 'UI 设计', {}, stats), 1);
  assert.equal(pickFacet(groups, '1', {}, stats), 1);
  assert.equal(pickFacet(groups, '不存在', {}, stats), 0);
  assert.equal(pickFacet([{ section: '空', blocks: [] }], '', {}, stats), 0);
});

test('facetBadgeState 与 facetBadges 计算数量和等级', () => {
  assert.deepEqual(facetBadgeState({ must: 2, optional: 3 }), { count: 5, level: 'must' });
  assert.deepEqual(facetBadgeState({ must: 0, optional: 1 }), { count: 1, level: 'optional' });
  assert.deepEqual(facetBadgeState({}), { count: 0, level: 'done' });
  assert.deepEqual(facetBadges(groups, {}, stats), [
    { count: 1, level: 'must' }, { count: 2, level: 'optional' }, { count: 0, level: 'done' },
  ]);
});
