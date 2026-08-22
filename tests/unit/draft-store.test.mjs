import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, mergeDraft, readDraft, writeDraft } from '../../src/render/draft-store.mjs';

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
