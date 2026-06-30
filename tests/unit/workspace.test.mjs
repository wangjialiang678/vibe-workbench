import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ws-')); process.env.WB_WORKSPACE = tmp; });
after(() => { delete process.env.WB_WORKSPACE; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test('paths + json roundtrip + status merge', async () => {
  const ws = await import('../../src/workspace.mjs');
  ws.writeJSON(ws.paths.content('s1', 1), { session: 's1', round: 1, blocks: [] });
  assert.deepEqual(ws.readJSON(ws.paths.content('s1', 1)).round, 1);
  assert.equal(ws.exists(ws.paths.content('s1', 1)), true);

  ws.writeStatus('s1', { state: 'rendered', round: 1 });
  ws.writeStatus('s1', { state: 'submitted' });
  const st = ws.readStatus('s1');
  assert.equal(st.state, 'submitted');
  assert.equal(st.round, 1); // 合并保留
});

test('listSessions / listRounds / latestRound + removeFile', async () => {
  const ws = await import('../../src/workspace.mjs');
  ws.writeJSON(ws.paths.content('s2', 1), { x: 1 });
  ws.writeJSON(ws.paths.content('s2', 2), { x: 2 });
  assert.ok(ws.listSessions().includes('s2'));
  assert.deepEqual(ws.listRounds('s2'), [1, 2]);
  assert.equal(ws.latestRound('s2'), 2);
  ws.writeJSON(ws.paths.ack('s2', 1), { claimedAt: 'x' });
  assert.equal(ws.exists(ws.paths.ack('s2', 1)), true);
  ws.removeFile(ws.paths.ack('s2', 1));
  assert.equal(ws.exists(ws.paths.ack('s2', 1)), false);
});
