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

test('inbox 是系统保留目录，不能作为 session 且不进入会话枚举', async () => {
  const ws = await import('../../src/workspace.mjs');
  fs.mkdirSync(path.join(tmp, 'inbox'), { recursive: true });

  assert.equal(ws.isValidSessionName('inbox'), false);
  assert.equal(ws.listSessions().includes('inbox'), false);
});

test('writeRound: 共享完成自动编号、双轨落盘与独占冲突保护', async () => {
  const ws = await import('../../src/workspace.mjs');
  const session = 'shared.round-1';
  const first = ws.writeRound(session, {
    title: '共享写入',
    blocks: [{ id: 'shared-block', type: 'markdown', body: '第一轮内容' }],
  }, { exactSession: true });

  assert.equal(first.round, 1);
  assert.equal(ws.readJSON(ws.paths.content(session, 1)).session, session);
  assert.match(ws.readText(ws.paths.contentMd(session, 1)), /第一轮内容/);
  assert.equal(ws.readStatus(session).state, 'rendered');
  assert.equal(fs.existsSync(path.join(tmp, session, 'round-1', 'content.json')), true, '合法的点号 session 应保留原名');

  assert.throws(
    () => ws.writeRound(session, {
      round: 1,
      blocks: [{ id: 'replacement', type: 'markdown', body: '不得覆盖' }],
    }, { allowOverwrite: false, exactSession: true }),
    (error) => error?.code === 'ROUND_EXISTS',
  );
  assert.equal(ws.readJSON(ws.paths.content(session, 1)).blocks[0].id, 'shared-block');
});

test('点号 session 默认继续读取旧版下划线目录，服务端可显式使用精确目录', async () => {
  const ws = await import('../../src/workspace.mjs');
  const session = 'legacy.session';
  const legacyDir = path.join(tmp, 'legacy_session');
  fs.mkdirSync(legacyDir, { recursive: true });

  assert.equal(ws.sessionDir(session), legacyDir);
  assert.equal(ws.sessionDir(session, { exactSession: true }), path.join(tmp, session));
});

test('独占写入中途失败会回收本次占位，允许同 round 重试', async () => {
  const ws = await import('../../src/workspace.mjs');
  const session = 'failed-round-cleanup';
  const cyclic = {};
  cyclic.self = cyclic;

  assert.throws(() => ws.writeRound(session, {
    round: 1,
    blocks: [{ id: 'cyclic', type: 'markdown', extra: cyclic }],
  }, { allowOverwrite: false }));
  assert.equal(fs.existsSync(ws.roundDir(session, 1)), false);

  const retried = ws.writeRound(session, {
    round: 1,
    blocks: [{ id: 'valid', type: 'markdown', body: '重试成功' }],
  }, { allowOverwrite: false });
  assert.equal(retried.round, 1);
});
