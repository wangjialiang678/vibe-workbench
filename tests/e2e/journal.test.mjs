import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let root;
let storage;
let listener;
let server;
let baseUrl;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-journal-e2e-'));
  process.env.WB_WORKSPACE = root;
  storage = await import('../../src/storage/index.mjs');
  listener = await import('../../src/loop/listener.mjs');
  const { startServer } = await import('../../src/server/server.mjs');
  server = startServer(0, '127.0.0.1', { env: { ...process.env, WORKBENCH_TOKEN: 'journal-owner' } });
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.WB_WORKSPACE;
});

test('完整生命周期追加脱敏 journal，并保留 HTTP requestId', async () => {
  const session = 'journal-lifecycle';
  const secret = 'journal-secret-must-not-persist';
  const headers = { 'content-type': 'application/json', 'x-workbench-token': 'journal-owner' };
  const present = await fetch(`${baseUrl}/api/rounds`, {
    method: 'POST', headers,
    body: JSON.stringify({
      session,
      title: secret,
      blocks: [{ id: 'note', type: 'markdown', body: secret }],
    }),
  });
  assert.equal(present.status, 200);

  const feedback = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST', headers,
    body: JSON.stringify({ session, round: 1, summary: secret, items: [] }),
  });
  assert.equal(feedback.status, 200);

  const result = await listener.processRound(session, 1, {
    workerId: 'journal-worker',
    driver: async () => ({ text: 'handled' }),
  });
  assert.equal(result.status, 'responded');

  const raw = fs.readFileSync(storage.paths.journal(session, { exactSession: true }), 'utf8');
  const entries = raw.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(entries.map((entry) => entry.event), [
    'round.presented', 'feedback.submitted', 'round.claimed', 'round.responded',
  ]);
  for (const entry of entries) {
    assert.equal(typeof entry.ts, 'string');
    assert.ok(Number.isFinite(Date.parse(entry.ts)));
    assert.equal(entry.round, 1);
    assert.equal(typeof entry.actor, 'string');
    assert.ok(entry.actor.length > 0);
  }
  assert.match(entries[0].requestId, /^[a-f0-9]{12}$/);
  assert.match(entries[1].requestId, /^[a-f0-9]{12}$/);
  assert.equal(entries[2].workerId, 'journal-worker');
  assert.equal(entries[3].workerId, 'journal-worker');
  assert.equal(raw.includes(secret), false, 'journal 不得复制正文、反馈或密钥样式内容');
});
