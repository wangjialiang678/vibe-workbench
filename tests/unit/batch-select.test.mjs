import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  batchSelectionGroups,
  batchSelectionPatch,
  batchSelectionPatchFromAction,
  unansweredBatchTargets,
} from '../../src/render/batch-select.mjs';
import { renderZones } from '../../src/render/attention-view.mjs';

const OPTIONS = [
  { id: 'approve', label: '赞成', desc: '按当前方案继续' },
  { id: 'reject', label: '反对', desc: '退回调整' },
];

function choice(id, options = OPTIONS) {
  return { id, type: 'choice', needsDecision: true, _change: 'new', options };
}

test('同构组判定：同轮至少三个、选项完整且顺序相同的 choice 才成组', () => {
  const blocks = [
    choice('c1'),
    choice('c2', OPTIONS.map((option) => ({ ...option }))),
    choice('c3'),
    choice('different-copy', [
      { id: 'approve', label: '赞成', desc: '文案已变' },
      OPTIONS[1],
    ]),
    choice('different-order', [...OPTIONS].reverse()),
  ];
  const groups = batchSelectionGroups(blocks);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'choice');
  assert.deepEqual(groups[0].targets, [
    { blockId: 'c1' },
    { blockId: 'c2' },
    { blockId: 'c3' },
  ]);
  assert.equal(batchSelectionGroups(blocks.slice(0, 2)).length, 0);
});

test('checklist 三条起形成批量组，少于三条不形成', () => {
  const groups = batchSelectionGroups([
    {
      id: 'check-many', type: 'checklist', verdictLabels: ['赞成', '异议'],
      items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
    },
    {
      id: 'check-few', type: 'checklist', verdictLabels: ['赞成', '异议'],
      items: [{ id: 'i1' }, { id: 'i2' }],
    },
  ]);
  assert.deepEqual(groups.map((group) => group.id), ['checklist:check-many']);
  assert.deepEqual(groups[0].options, [
    { value: '赞成', label: '赞成' },
    { value: '异议', label: '异议' },
  ]);
});

test('批量 choice 只筛未作答项，保留已有逐条选择和同块批注', () => {
  const group = batchSelectionGroups([choice('c1'), choice('c2'), choice('c3')])[0];
  const draft = {
    c1: { select: 'reject', comment: '这一条单独反对' },
    c2: { comment: '先留批注' },
  };
  assert.deepEqual(unansweredBatchTargets(group, draft), [
    { blockId: 'c2' },
    { blockId: 'c3' },
  ]);
  assert.deepEqual(batchSelectionPatch(group, 'approve', draft), {
    c2: { comment: '先留批注', select: 'approve' },
    c3: { select: 'approve' },
  });
  assert.deepEqual(draft.c1, { select: 'reject', comment: '这一条单独反对' });
});

test('批量 checklist 不覆盖已选条目，并保留块上其它草稿字段', () => {
  const group = batchSelectionGroups([{
    id: 'check', type: 'checklist', verdictLabels: ['赞成', '异议'],
    items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
  }])[0];
  const draft = { check: { comment: '逐项核对', checklistItems: { i2: '异议' } } };
  assert.deepEqual(batchSelectionPatch(group, '赞成', draft), {
    check: {
      comment: '逐项核对',
      checklistItems: { i2: '异议', i1: '赞成', i3: '赞成' },
    },
  });
});

test('批量动作按按钮 dataset 定位组；历史只读态不渲染批量条', () => {
  const blocks = [choice('c1'), choice('c2'), choice('c3')];
  const groups = batchSelectionGroups(blocks);
  assert.deepEqual(batchSelectionPatchFromAction(groups, {
    batchGroup: 'choice:c1',
    batchValue: 'approve',
  }), {
    c1: { select: 'approve' },
    c2: { select: 'approve' },
    c3: { select: 'approve' },
  });
  assert.match(renderZones(blocks), /data-batch-group="choice:c1"/);
  assert.match(renderZones(blocks), /全部选〈赞成〉/);
  assert.doesNotMatch(renderZones(blocks, { readonly: true }), /batch-select-bar/);
});
