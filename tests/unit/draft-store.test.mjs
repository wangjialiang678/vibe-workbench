import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, isSubmitted, markSubmitted, mergeDraft, readDraft, submittedAt, writeDraft } from '../../src/render/draft-store.mjs';

test('draftKey 保持会话、轮次与反馈命名空间', () => {
  assert.equal(draftKey('design/demo', 3), 'wb:design/demo:3:fb');
});

test('mergeDraft 原地合并草稿 patch', () => {
  const draft = { blockA: { verdict: '赞成' } };
  assert.equal(mergeDraft(draft, { blockB: { text: '补充' } }), draft);
  assert.deepEqual(draft, { blockA: { verdict: '赞成' }, blockB: { text: '补充' } });
});

test('readDraft/writeDraft 通过注入 storage 存取，并容错畸形 JSON', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  writeDraft(storage, 'draft', { blockA: { text: '你好' } });
  assert.deepEqual(readDraft(storage, 'draft'), { blockA: { text: '你好' } });
  values.set('bad', '{');
  assert.deepEqual(readDraft(storage, 'bad'), {});
  assert.deepEqual(readDraft(storage, 'missing'), {});
});

test('markSubmitted/isSubmitted 保存提交时间，后续编辑自动回到未提交草稿', () => {
  const draft = { blockA: { text: '已交内容' } };
  const marked = markSubmitted(draft, '2026-08-31T08:00:00.000Z');
  assert.notEqual(marked, draft);
  assert.equal(isSubmitted(draft), false);
  assert.equal(isSubmitted(marked), true);
  assert.equal(submittedAt(marked), '2026-08-31T08:00:00.000Z');

  mergeDraft(marked, { blockA: { text: '新修改' } });
  assert.equal(isSubmitted(marked), false);
  assert.equal(submittedAt(marked), null);
});
