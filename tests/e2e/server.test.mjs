// E2E tests for src/server/server.mjs
// TDD: tests written first, then implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We import workspace helpers to set up fixture data
// These are already tested contracts.
let writeJSON, writeStatus, paths, writeText, removeFile, exists;
let startServer;
let rewriteEmbedHtml;
let server;
let port;
let tmpDir;
let session;

// Setup: create temp workspace, start server on ephemeral port
before(async () => {
  // Create temp dir for workspace
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'));
  process.env.WB_WORKSPACE = tmpDir;

  // Now import (dynamic, so env var is picked up)
  const ws = await import('../../src/workspace.mjs');
  writeJSON = ws.writeJSON;
  writeStatus = ws.writeStatus;
  paths = ws.paths;
  writeText = ws.writeText;
  removeFile = ws.removeFile;
  exists = ws.exists;

  const srv = await import('../../src/server/server.mjs');
  startServer = srv.startServer;
  rewriteEmbedHtml = srv.rewriteEmbedHtml;

  server = startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;

  session = 'ses_test01';
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function url(p) {
  return `http://localhost:${port}${p}`;
}

// ---- health ----
test('GET /api/health returns ok:true', async () => {
  const res = await fetch(url('/api/health'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(typeof body.ts === 'number' || typeof body.ts === 'string');
});

// ---- sessions ----
test('GET /api/sessions returns ok:true with sessions array', async () => {
  const res = await fetch(url('/api/sessions'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.sessions));
});

// ---- content with diff: round 1 (no prev) ----
test('GET /api/content?round=1 — all blocks _change===new when no prev', async () => {
  const s = session;
  const r = 1;
  const blocks = [
    { id: 'b-alpha', type: 'markdown', body: 'Hello world' },
    { id: 'b-beta', type: 'verdict', body: 'Approve?' },
  ];
  writeJSON(paths.content(s, r), { session: s, round: r, prevRound: 0, blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=${r}`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.blocks));
  assert.equal(body.blocks.length, 2);
  for (const b of body.blocks) {
    assert.equal(b._change, 'new', `expected _change=new on block ${b.id}`);
  }
  assert.ok(Array.isArray(body.removed));
  assert.equal(body.removed.length, 0);
  assert.ok(body.sanity && typeof body.sanity.suspect === 'boolean');
});

// ---- content with diff: round 2 (one changed, one removed, one new) ----
test('GET /api/content?round=2 — changed block has _change===changed; removed non-empty', async () => {
  const s = session;
  // round-1 blocks: b-alpha, b-beta
  const round1blocks = [
    { id: 'b-alpha', type: 'markdown', body: 'Hello world' },
    { id: 'b-beta', type: 'verdict', body: 'Approve?' },
  ];
  writeJSON(paths.content(s, 1), { session: s, round: 1, prevRound: 0, blocks: round1blocks });

  // round-2 blocks: b-alpha changed body, b-beta removed, b-gamma new
  const round2blocks = [
    { id: 'b-alpha', type: 'markdown', body: 'Hello world — updated!' },
    { id: 'b-gamma', type: 'markdown', body: 'Brand new block' },
  ];
  writeJSON(paths.content(s, 2), { session: s, round: 2, prevRound: 1, blocks: round2blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=2`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.blocks));

  const alpha = body.blocks.find((b) => b.id === 'b-alpha');
  const gamma = body.blocks.find((b) => b.id === 'b-gamma');
  assert.ok(alpha, 'b-alpha should be in result');
  assert.equal(alpha._change, 'changed', 'b-alpha body changed so _change should be changed');
  assert.ok(gamma, 'b-gamma should be in result');
  assert.equal(gamma._change, 'new', 'b-gamma is new');

  // b-beta was in round-1 but not round-2 → should be in removed
  assert.ok(Array.isArray(body.removed));
  const removedIds = body.removed.map((b) => b.id);
  assert.ok(removedIds.includes('b-beta'), 'b-beta should appear in removed');
});

// ---- content 404 for missing round ----
test('GET /api/content?round=999 returns 404', async () => {
  const res = await fetch(url(`/api/content?session=${session}&round=999`));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.ok, false);
});

// ---- POST feedback: happy path ----
test('POST /api/feedback writes feedback.json and sets status=submitted', async () => {
  const s = 'ses_fb01';
  const r = 1;
  // Ensure session dir + content exists (so workspace is initialized)
  writeJSON(paths.content(s, r), { session: s, round: r, prevRound: 0, blocks: [] });
  // Set status to rendered (not claimed)
  writeStatus(s, { state: 'rendered', round: r });

  const fb = {
    session: s,
    round: r,
    items: [
      { blockId: 'b-x', type: 'verdict', value: 'approve', comment: '' },
    ],
    summary: 'Looks good',
  };

  const res = await fetch(url('/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fb),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);

  // feedback.json must be on disk
  const saved = JSON.parse(fs.readFileSync(paths.feedback(s, r), 'utf8'));
  assert.equal(saved.session, s);
  assert.equal(saved.round, r);

  // status must be submitted
  const st = JSON.parse(fs.readFileSync(paths.status(s), 'utf8'));
  assert.equal(st.state, 'submitted');
});

// ---- POST feedback: 409 when status=claimed ----
test('POST /api/feedback returns 409 when status=claimed', async () => {
  const s = 'ses_claimed01';
  const r = 1;
  writeJSON(paths.content(s, r), { session: s, round: r, prevRound: 0, blocks: [] });
  writeStatus(s, { state: 'claimed', round: r });

  const fb = {
    session: s,
    round: r,
    items: [],
    summary: '',
  };

  const res = await fetch(url('/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fb),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'claimed');
});

// ---- GET /api/status: claimed + fresh heartbeat → display=processing ----
test('GET /api/status with claimed + fresh heartbeat → display=processing', async () => {
  const s = 'ses_status01';
  // heartbeatAt = now
  writeStatus(s, {
    state: 'claimed',
    round: 1,
    heartbeatAt: new Date().toISOString(),
  });

  const res = await fetch(url(`/api/status?session=${s}`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.status, 'status field should be present');
  assert.equal(body.display, 'processing', `expected processing, got ${body.display}`);
});

// ---- GET /api/status: no session → ok:true, status:null, display:unknown ----
test('GET /api/status with unknown session → status:null, display:unknown', async () => {
  const res = await fetch(url('/api/status?session=ses_nonexistent_xyz'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, null);
  assert.equal(body.display, 'unknown');
});

// ---- POST /api/retry: clears ack, clears error, sets state=submitted ----
test('POST /api/retry removes ack and error files and sets state=submitted', async () => {
  const s = 'ses_retry01';
  const r = 1;
  writeJSON(paths.content(s, r), { session: s, round: r, prevRound: 0, blocks: [] });
  // Pre-create ack + error
  writeJSON(paths.ack(s, r), { claimedAt: new Date().toISOString(), pid: 12345 });
  writeJSON(paths.error(s, r), { message: 'boom', at: new Date().toISOString() });
  writeStatus(s, { state: 'error', round: r });

  const res = await fetch(url(`/api/retry?session=${s}&round=${r}`), { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  // ack must be gone
  assert.equal(exists(paths.ack(s, r)), false, 'ack.json should be removed after retry');
  // error must be gone
  assert.equal(exists(paths.error(s, r)), false, 'error.json should be removed after retry');
  // status must be submitted
  const st = JSON.parse(fs.readFileSync(paths.status(s), 'utf8'));
  assert.equal(st.state, 'submitted');
});

// ---- Static file serving: redirect / → /render/index.html ----
test('GET / redirects to /render/index.html', async () => {
  const res = await fetch(url('/'), { redirect: 'manual' });
  assert.ok(res.status === 302 || res.status === 301);
  const loc = res.headers.get('location');
  assert.ok(loc && loc.includes('/render/index.html'), `unexpected location: ${loc}`);
});

// ---- CORS headers present ----
test('API responses include CORS headers', async () => {
  const res = await fetch(url('/api/health'));
  const cors = res.headers.get('access-control-allow-origin');
  assert.ok(cors === '*' || cors != null, 'CORS header should be present');
});

// ---- rewriteEmbedHtml unit test (exported pure function) ----
test('rewriteEmbedHtml: injects <base> inside <head> and title remains', () => {
  const input = '<html><head><title>t</title></head><body>x</body></html>';
  const targetUrl = 'https://h.com/p/a.html';
  const out = rewriteEmbedHtml(input, targetUrl);
  // base tag must be present
  assert.ok(out.includes(`<base href="${targetUrl}">`), `expected base href in: ${out}`);
  // base must appear before </head>
  const basePos = out.indexOf(`<base href="${targetUrl}">`);
  const headClosePos = out.indexOf('</head>');
  assert.ok(basePos < headClosePos, `base (${basePos}) must be inside head (before </head> at ${headClosePos})`);
  // base must appear after <head>
  const headOpenPos = out.indexOf('<head>');
  assert.ok(basePos > headOpenPos, `base (${basePos}) must be after <head> (${headOpenPos})`);
  // title must still be present
  assert.ok(out.includes('<title>t</title>'), `expected title to remain in: ${out}`);
});

test('rewriteEmbedHtml: removes X-Frame-Options meta tag', () => {
  const input = '<html><head><meta http-equiv="X-Frame-Options" content="DENY"><title>t</title></head><body></body></html>';
  const out = rewriteEmbedHtml(input, 'https://example.com/');
  assert.ok(!out.includes('X-Frame-Options'), `X-Frame-Options meta must be removed, got: ${out}`);
  assert.ok(out.includes('<title>t</title>'), `title must remain`);
});

test('rewriteEmbedHtml: inserts <base> at document start when no <head>', () => {
  const input = '<body>no head here</body>';
  const out = rewriteEmbedHtml(input, 'https://example.com/path/');
  assert.ok(out.startsWith('<base href="https://example.com/path/">'), `expected base at start, got: ${out}`);
});

// ---- 改动 E: _respondedToPrev 注入（DESIGN §4）----

test('GET /api/content?round=2 — _respondedToPrev=true when block was in prev feedback', async () => {
  const s = 'ses_resp01';

  // round-1 blocks
  const round1blocks = [
    { id: 'blk-responded', type: 'verdict', body: 'Q1', needsDecision: true },
    { id: 'blk-silent', type: 'markdown', body: 'context' },
  ];
  writeJSON(paths.content(s, 1), { session: s, round: 1, prevRound: 0, blocks: round1blocks });

  // round-1 feedback: user responded to blk-responded only
  writeJSON(paths.feedback(s, 1), {
    session: s,
    round: 1,
    submittedAt: new Date().toISOString(),
    items: [{ blockId: 'blk-responded', type: 'verdict', value: '赞成' }],
  });

  // round-2 blocks: blk-responded is unchanged, blk-silent is unchanged, blk-new is new
  const round2blocks = [
    { id: 'blk-responded', type: 'verdict', body: 'Q1', needsDecision: true },
    { id: 'blk-silent', type: 'markdown', body: 'context' },
    { id: 'blk-new', type: 'markdown', body: 'new content' },
  ];
  writeJSON(paths.content(s, 2), { session: s, round: 2, prevRound: 1, blocks: round2blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=2`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.blocks));

  const responded = body.blocks.find((b) => b.id === 'blk-responded');
  const silent = body.blocks.find((b) => b.id === 'blk-silent');
  const newBlk = body.blocks.find((b) => b.id === 'blk-new');

  assert.ok(responded, 'blk-responded should be in result');
  assert.equal(responded._respondedToPrev, true, 'blk-responded should have _respondedToPrev=true');

  assert.ok(silent, 'blk-silent should be in result');
  assert.ok(!silent._respondedToPrev, 'blk-silent was not in prev feedback → _respondedToPrev falsy');

  assert.ok(newBlk, 'blk-new should be in result');
  assert.equal(newBlk._change, 'new', 'blk-new is new');
  assert.ok(!newBlk._respondedToPrev, 'blk-new not in prev feedback → no _respondedToPrev');
});

test('GET /api/content — null guard: 上轮 feedback 缺失时不注入 _respondedToPrev（无报错）', async () => {
  const s = 'ses_nullfb01';

  // round-1 content exists but NO feedback file
  const round1blocks = [{ id: 'b1', type: 'verdict', body: 'Q' }];
  writeJSON(paths.content(s, 1), { session: s, round: 1, prevRound: 0, blocks: round1blocks });
  // Deliberately do NOT write feedback for round 1

  // round-2
  const round2blocks = [{ id: 'b1', type: 'verdict', body: 'Q updated' }];
  writeJSON(paths.content(s, 2), { session: s, round: 2, prevRound: 1, blocks: round2blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=2`));
  assert.equal(res.status, 200, 'should not error when prev feedback is missing');
  const body = await res.json();
  assert.ok(Array.isArray(body.blocks));
  const b1 = body.blocks.find((b) => b.id === 'b1');
  assert.ok(b1, 'b1 should be in result');
  assert.ok(!b1._respondedToPrev, 'no _respondedToPrev when prev feedback is missing (null guard)');
});

test('GET /api/content?round=1 — 首轮无前轮 feedback，无 _respondedToPrev（null guard 首轮）', async () => {
  const s = 'ses_r1guard';
  const round1blocks = [{ id: 'ga', type: 'markdown', body: 'hello' }];
  writeJSON(paths.content(s, 1), { session: s, round: 1, prevRound: 0, blocks: round1blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=1`));
  assert.equal(res.status, 200);
  const body = await res.json();
  const ga = body.blocks.find((b) => b.id === 'ga');
  assert.ok(ga);
  assert.ok(!ga._respondedToPrev, '首轮不应有 _respondedToPrev');
  assert.equal(ga._change, 'new', '首轮块均为 new');
});

// ---- 改动 C: _decidedInPrev 注入（DESIGN §4 批次2）----

test('GET /api/content round=2 — _decidedInPrev=true: 上轮有反馈 + 本轮 unchanged', async () => {
  const s = 'ses_decided01';

  // round-1 blocks
  const round1blocks = [
    { id: 'blk-decided', type: 'verdict', body: 'Q', needsDecision: true },
    { id: 'blk-new-r2', type: 'markdown', body: 'old context' },
  ];
  writeJSON(paths.content(s, 1), { session: s, round: 1, prevRound: 0, blocks: round1blocks });

  // round-1 feedback: user gave feedback on blk-decided
  writeJSON(paths.feedback(s, 1), {
    session: s, round: 1,
    submittedAt: new Date().toISOString(),
    items: [{ blockId: 'blk-decided', type: 'verdict', value: '赞成' }],
  });

  // round-2: blk-decided unchanged (same body), blk-new-r2 changed, blk-extra new
  const round2blocks = [
    { id: 'blk-decided', type: 'verdict', body: 'Q', needsDecision: true },   // unchanged
    { id: 'blk-new-r2', type: 'markdown', body: 'new context updated' },       // changed
    { id: 'blk-extra', type: 'markdown', body: 'brand new' },                  // new
  ];
  writeJSON(paths.content(s, 2), { session: s, round: 2, prevRound: 1, blocks: round2blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=2`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.blocks));

  const decided = body.blocks.find((b) => b.id === 'blk-decided');
  const changed = body.blocks.find((b) => b.id === 'blk-new-r2');
  const extra = body.blocks.find((b) => b.id === 'blk-extra');

  assert.ok(decided, 'blk-decided should be present');
  assert.equal(decided._change, 'unchanged', 'blk-decided body same → unchanged');
  assert.equal(decided._decidedInPrev, true, '上轮有反馈 + 本轮 unchanged → _decidedInPrev=true');
  assert.equal(decided._respondedToPrev, true, '上轮有反馈 → _respondedToPrev=true also');

  assert.ok(changed, 'blk-new-r2 should be present');
  assert.equal(changed._change, 'changed', 'blk-new-r2 body changed');
  assert.ok(!changed._decidedInPrev, 'changed block → no _decidedInPrev (not unchanged)');

  assert.ok(extra, 'blk-extra should be present');
  assert.equal(extra._change, 'new', 'blk-extra is new');
  assert.ok(!extra._decidedInPrev, 'new block → no _decidedInPrev');
});

test('GET /api/content — 改动C null guard: 前轮 feedback 缺失 → 不注入 _decidedInPrev，不报错', async () => {
  const s = 'ses_decided_null01';

  const round1blocks = [
    { id: 'bx', type: 'verdict', body: 'Q', needsDecision: true },
  ];
  writeJSON(paths.content(s, 1), { session: s, round: 1, prevRound: 0, blocks: round1blocks });
  // 故意不写 feedback

  const round2blocks = [
    { id: 'bx', type: 'verdict', body: 'Q', needsDecision: true },  // unchanged
  ];
  writeJSON(paths.content(s, 2), { session: s, round: 2, prevRound: 1, blocks: round2blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=2`));
  assert.equal(res.status, 200, 'null guard: 前轮 feedback 缺失时不报错');
  const body = await res.json();
  const bx = body.blocks.find((b) => b.id === 'bx');
  assert.ok(bx, 'bx should be present');
  assert.equal(bx._change, 'unchanged', 'bx is unchanged');
  assert.ok(!bx._decidedInPrev, '无前轮 feedback → 不注入 _decidedInPrev');
  assert.ok(!bx._respondedToPrev, '无前轮 feedback → 不注入 _respondedToPrev');
});

test('GET /api/content — 上轮无反馈的 unchanged 块不得 _decidedInPrev', async () => {
  const s = 'ses_decided02';

  const round1blocks = [
    { id: 'blk-a', type: 'verdict', body: 'Q', needsDecision: true },
    { id: 'blk-b', type: 'markdown', body: 'ctx' },
  ];
  writeJSON(paths.content(s, 1), { session: s, round: 1, prevRound: 0, blocks: round1blocks });

  // feedback 只给了 blk-a，blk-b 没有反馈
  writeJSON(paths.feedback(s, 1), {
    session: s, round: 1,
    submittedAt: new Date().toISOString(),
    items: [{ blockId: 'blk-a', type: 'verdict', value: '赞成' }],
  });

  const round2blocks = [
    { id: 'blk-a', type: 'verdict', body: 'Q', needsDecision: true },  // unchanged + decided
    { id: 'blk-b', type: 'markdown', body: 'ctx' },                     // unchanged but NOT in feedback
  ];
  writeJSON(paths.content(s, 2), { session: s, round: 2, prevRound: 1, blocks: round2blocks });

  const res = await fetch(url(`/api/content?session=${s}&round=2`));
  assert.equal(res.status, 200);
  const body = await res.json();

  const blkA = body.blocks.find((b) => b.id === 'blk-a');
  const blkB = body.blocks.find((b) => b.id === 'blk-b');

  assert.equal(blkA._decidedInPrev, true, 'blk-a 上轮有反馈 + unchanged → _decidedInPrev=true');
  assert.ok(!blkB._decidedInPrev, 'blk-b 上轮无反馈 → 不得 _decidedInPrev（即使 unchanged）');
});

// ---- P0：embed 代理转发 POST（iteration-brief 2026-07-13，实证 bug 回归）----

async function startEcho() {
  const { createServer } = await import('node:http');
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/deny')) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '口令无效' }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        method: req.method,
        contentType: req.headers['content-type'] ?? null,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
  });
  srv.listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { srv, port: srv.address().port };
}

test('POST /api/proxy: 表单字段经代理无损到达目标（口令不再丢失）', async () => {
  const { srv, port: ep } = await startEcho();
  try {
    const target = `http://127.0.0.1:${ep}/decide`;
    const form = 'token=secret123&choice=approve&note=%E5%90%8C%E6%84%8F';
    const res = await fetch(url(`/api/proxy?url=${encodeURIComponent(target)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    assert.equal(res.status, 200);
    const echoed = await res.json();
    assert.equal(echoed.method, 'POST', 'method 应透传');
    assert.match(echoed.contentType, /x-www-form-urlencoded/);
    assert.equal(echoed.body, form, '表单字段必须无损到达（口令字段不得丢失）');
  } finally { srv.close(); }
});

test('POST /api/proxy: JSON body 与 Content-Type 透传', async () => {
  const { srv, port: ep } = await startEcho();
  try {
    const target = `http://127.0.0.1:${ep}/api/x`;
    const payload = JSON.stringify({ token: 'k', ok: true });
    const res = await fetch(url(`/api/proxy?url=${encodeURIComponent(target)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const echoed = await res.json();
    assert.equal(echoed.method, 'POST');
    assert.match(echoed.contentType, /application\/json/);
    assert.equal(echoed.body, payload);
  } finally { srv.close(); }
});

test('/api/proxy: 非 HTML 响应原样回传，目标状态码保真（403 不被吞成 200）', async () => {
  const { srv, port: ep } = await startEcho();
  try {
    const target = `http://127.0.0.1:${ep}/deny`;
    const res = await fetch(url(`/api/proxy?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 403, '目标真实状态码应透传');
    const body = await res.json();
    assert.equal(body.error, '口令无效');
  } finally { srv.close(); }
});

test('rewriteEmbedHtml: 表单 action 改写回代理通道 + 注入 fetch/XHR 补丁', () => {
  const html = '<html><head></head><body><form method="post" action="/decide"><input name="token"></form></body></html>';
  const out = rewriteEmbedHtml(html, 'http://127.0.0.1:8123/decisions', 'http://127.0.0.1:8099');
  assert.ok(out.includes('action="http://127.0.0.1:8099/api/proxy?url='), `form action 应指向代理: ${out}`);
  assert.ok(out.includes(encodeURIComponent('http://127.0.0.1:8123/decide')), '应保留解析后的绝对目标');
  assert.ok(out.includes('XMLHttpRequest.prototype.open'), '应注入 fetch/XHR 补丁');
});

// ---- 会话资产自托管 /assets/<session>/... （去掉对外部服务的依赖）----

test('GET /assets/<session>/<file>：供 session 自带的静态资产（如高保真 UI 稿）', async () => {
  const dir = path.join(tmpDir, session, 'assets', 'ui');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'b-home.html'), '<html><head><title>主界面</title></head><body>hi</body></html>');

  const res = await fetch(url(`/assets/${session}/ui/b-home.html`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  assert.match(await res.text(), /主界面/);
});

test('GET /assets：路径穿越与非法 session 名被挡', async () => {
  const trav = await fetch(url(`/assets/${session}/ui/../../../../../etc/passwd`));
  assert.ok(trav.status === 403 || trav.status === 404, `穿越应被拒，实得 ${trav.status}`);

  const bad = await fetch(url('/assets/..%2F..%2Fetc/passwd'));
  assert.ok(bad.status === 403 || bad.status === 404, `非法 session 名应被拒，实得 ${bad.status}`);

  const missing = await fetch(url(`/assets/${session}/ui/nope.html`));
  assert.equal(missing.status, 404);
});
