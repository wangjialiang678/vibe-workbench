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
