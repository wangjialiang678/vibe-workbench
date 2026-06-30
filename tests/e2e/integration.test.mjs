// 端到端集成：templates → bin 渲染 → server API → loop 异步唤醒（S1 往返 + S5 崩溃/重试恢复）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp, server, port, ws, bin, listener, thinkDiscuss;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-int-'));
  process.env.WB_WORKSPACE = tmp;
  ws = await import('../../src/workspace.mjs');
  bin = await import('../../bin/workbench.mjs');
  listener = await import('../../src/loop/listener.mjs');
  thinkDiscuss = (await import('../../templates/think-discuss.mjs')).default;
  const srv = await import('../../src/server/server.mjs');
  server = srv.startServer(0);
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  port = server.address().port;
});

after(() => {
  try { server && server.close(); } catch {}
  delete process.env.WB_WORKSPACE;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const GET = (p) => fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.json());
const POST = (p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function buildContent(session) {
  const blocks = thinkDiscuss({
    title: '集成测试一轮',
    thoughtMd: '# 思路\n这是一段思考。',
    decisions: [{ key: 'trigger', question: '触发模型?', options: [{ id: 'async', label: '异步唤醒' }, { id: 'poll', label: '阻塞轮询' }], recommend: 'async' }],
  });
  return { session, round: 1, prevRound: 0, title: '集成', blocks };
}

test('S1: think-discuss 一轮往返（render→content API→feedback→listener→responded）', async () => {
  const session = 's-happy';
  await bin.cmdRender(session, buildContent(session));
  assert.equal(ws.readStatus(session).state, 'rendered');

  const content = await GET(`/api/content?session=${session}&round=1`);
  assert.ok(content.blocks.every((b) => b._change === 'new'), '首轮全 new');
  const decBlock = content.blocks.find((b) => b.id === 'b-dec-trigger');
  assert.ok(decBlock, '决策块存在');

  const res = await POST('/api/feedback', { session, round: 1, items: [{ blockId: 'b-dec-trigger', type: 'select', value: 'async', comment: '同意异步' }] });
  assert.equal(res.status, 200);
  assert.equal(ws.readStatus(session).state, 'submitted');

  const processed = await listener.reconcile({ driver: async ({ prompt }) => ({ sessionId: 'sid-1', text: '收到反馈，进入下一轮。prompt 长度=' + prompt.length }) });
  assert.ok(processed.some((p) => p.session === session && p.status === 'responded'));
  assert.ok(ws.exists(ws.paths.response(session, 1)), 'response.md 落盘');
  assert.equal(ws.readStatus(session).state, 'responded');

  const st = await GET(`/api/status?session=${session}`);
  assert.equal(st.display, 'responded');
});

test('S5: 崩溃→error→retry→恢复', async () => {
  const session = 's-recover';
  await bin.cmdRender(session, buildContent(session));
  await POST('/api/feedback', { session, round: 1, items: [{ blockId: 'b-dec-trigger', type: 'select', value: 'async' }] });

  // 驱动抛错 → error.json + status error，listener 不抛
  await listener.reconcile({ driver: async () => { throw { kind: 'api', message: 'rate limited' }; } });
  assert.ok(ws.exists(ws.paths.error(session, 1)), 'error.json 落盘');
  assert.equal(ws.readStatus(session).state, 'error');

  // 网页重试 → 清 ack/error，回 submitted
  const retry = await POST(`/api/retry?session=${session}&round=1`, {});
  assert.equal(retry.status, 200);
  assert.equal(ws.exists(ws.paths.ack(session, 1)), false, 'ack 已清');
  assert.equal(ws.readStatus(session).state, 'submitted');

  // 恢复后重跑成功
  await listener.reconcile({ driver: async () => ({ sessionId: 'sid-2', text: '恢复后成功处理' }) });
  assert.equal(ws.readStatus(session).state, 'responded');
});

test('幂等：已处理的轮不重复处理', async () => {
  const session = 's-idem';
  await bin.cmdRender(session, buildContent(session));
  await POST('/api/feedback', { session, round: 1, items: [{ blockId: 'b-dec-trigger', type: 'select', value: 'poll' }] });
  let calls = 0;
  const driver = async () => { calls++; return { sessionId: 'sid', text: 'ok' }; };
  await listener.reconcile({ driver });
  await listener.reconcile({ driver });
  assert.equal(calls, 1, '只处理一次');
});

test('回归：静态目录请求 /render/ 回退到 index.html（不再 404）', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/render/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('<!DOCTYPE') || html.includes('<html'), '应返回 index.html 而非 404 JSON');
  const r2 = await fetch(`http://127.0.0.1:${port}/render/?session=x&round=1`);
  assert.equal(r2.status, 200, '带查询的目录请求也应 200');
});
