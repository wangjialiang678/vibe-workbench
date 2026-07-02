// present / wait 一键命令（供 workbench skill 调用）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp, ws, bin, server, port;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-present-'));
  process.env.WB_WORKSPACE = tmp;
  ws = await import('../../src/workspace.mjs');
  bin = await import('../../bin/workbench.mjs');
  const srv = await import('../../src/server/server.mjs');
  server = srv.startServer(0);
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  port = server.address().port;
});

after(() => {
  try { server.close(); } catch {}
  delete process.env.WB_WORKSPACE;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('cmdPresent: 确保 server（已运行→already）+ 渲染 + 返回 URL', async () => {
  const content = { session: 'p1', round: 1, blocks: [{ id: 'b1', type: 'markdown', body: 'hi' }] };
  const r = await bin.cmdPresent('p1', content, { port });
  assert.equal(r.ok, true);
  assert.equal(r.round, 1);
  assert.equal(r.server, 'already');
  assert.ok(r.url.includes(`:${port}/render/?session=p1`) && !r.url.includes('round='), `url 应不带 round（跟随最新）: ${r.url}`);
  assert.ok(r.urlPinned.includes('&round=1'), `urlPinned 应带 round: ${r.urlPinned}`);
  assert.equal(ws.readStatus('p1').state, 'rendered');
  const h = await fetch(`http://127.0.0.1:${port}/api/health`).then((x) => x.json());
  assert.equal(h.ok, true);
});

test('cmdPresent: 自动递增 round', async () => {
  await bin.cmdPresent('p1b', { session: 'p1b', round: 1, blocks: [{ id: 'b1', type: 'markdown', body: 'r1' }] }, { port });
  const r2 = await bin.cmdPresent('p1b', { session: 'p1b', blocks: [{ id: 'b1', type: 'markdown', body: 'r2' }] }, { port });
  assert.equal(r2.round, 2);
});

test('cmdWait: 反馈出现即返回其内容', async () => {
  ws.writeJSON(ws.paths.feedback('p2', 1), { session: 'p2', round: 1, items: [{ blockId: 'b1', type: 'verdict', value: '赞成' }] });
  const r = await bin.cmdWait('p2', 1, { timeoutMs: 1000, intervalMs: 10 });
  assert.equal(r.event, 'feedback');
  assert.equal(r.feedback.items[0].value, '赞成');
});

test('cmdWait: 超时返回 timeout', async () => {
  const r = await bin.cmdWait('p3', 1, { timeoutMs: 60, intervalMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.event, 'timeout');
});
