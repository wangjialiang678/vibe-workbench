import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); delete process.env.WB_WORKSPACE; });
function workspace() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-storage-')); roots.push(root); process.env.WB_WORKSPACE = root; return root; }
function content(round = 1) { return { round, blocks: [{ id: 'b', type: 'markdown', body: 'x' }] }; }

test('storage createRound 同轮第二次永远抛 ROUND_EXISTS', async () => {
  workspace();
  const storage = await import('../../src/storage/index.mjs');
  storage.createRound('same-round', content());
  assert.throws(() => storage.createRound('same-round', content()), (error) => error?.code === 'ROUND_EXISTS');
});

test('CLI present 与 HTTP rounds 的共享用例各自拒绝同轮二次写入', async () => {
  workspace();
  const { cmdRender } = await import('../../bin/workbench.mjs');
  await cmdRender('cli-conflict', content());
  await assert.rejects(() => cmdRender('cli-conflict', content()), (error) => error?.code === 'ROUND_EXISTS');

  const { presentRound } = await import('../../src/core/present.mjs');
  presentRound('http-conflict', content(), { exactSession: true });
  assert.throws(() => presentRound('http-conflict', content(), { exactSession: true }), (error) => error?.code === 'ROUND_EXISTS');
});

test('storage appendFeedback 并发 20 笔时历史件零丢失且主件为最后完成的一笔', async () => {
  const root = workspace();
  const storage = await import('../../src/storage/index.mjs');
  storage.createRound('feedback-race', content());
  const writes = Array.from({ length: 20 }, (_, index) => Promise.resolve().then(() => storage.appendFeedback('feedback-race', 1, { index }, { identitySlug: `u${index}` })));
  const results = await Promise.all(writes);
  const history = path.join(root, 'feedback-race', 'round-1', 'feedback-history');
  const names = fs.readdirSync(history);
  assert.equal(names.length, 20);
  assert.equal(new Set(names).size, 20);
  assert.deepEqual(storage.readFeedback('feedback-race', 1), results.at(-1));
});

test('storage 写盘失败保留原始 errno 供 adapter 分类', async () => {
  const root = workspace();
  const storage = await import('../../src/storage/index.mjs');
  fs.writeFileSync(path.join(root, 'broken'), 'not a directory');
  assert.throws(() => storage.createRound('broken', content()), (error) => error?.code === 'EEXIST');
});
