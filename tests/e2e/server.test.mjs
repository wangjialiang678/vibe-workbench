// E2E tests for src/server/server.mjs
// TDD: tests written first, then implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

// We import workspace helpers to set up fixture data
// These are already tested contracts.
let writeJSON, readJSON, writeStatus, paths, writeText, removeFile, exists;
let startServer;
let rewriteEmbedHtml;
let safeTokenEqual;
let requiresPageToken;
let postWebhookEvent;
let server;
let port;
let tmpDir;
let session;
const savedServerEnv = {};

// Setup: create temp workspace, start server on ephemeral port
before(async () => {
  for (const key of ['WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) {
    savedServerEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Create temp dir for workspace
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'));
  process.env.WB_WORKSPACE = tmpDir;

  // Now import (dynamic, so env var is picked up)
  const ws = await import('../../src/workspace.mjs');
  writeJSON = ws.writeJSON;
  readJSON = ws.readJSON;
  writeStatus = ws.writeStatus;
  paths = ws.paths;
  writeText = ws.writeText;
  removeFile = ws.removeFile;
  exists = ws.exists;

  const srv = await import('../../src/server/server.mjs');
  startServer = srv.startServer;
  rewriteEmbedHtml = srv.rewriteEmbedHtml;
  safeTokenEqual = srv.safeTokenEqual;
  requiresPageToken = srv.requiresPageToken;
  postWebhookEvent = srv.postWebhookEvent;

  server = startServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  port = server.address().port;

  session = 'ses_test01';
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const key of ['WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) {
    if (savedServerEnv[key] == null) delete process.env[key];
    else process.env[key] = savedServerEnv[key];
  }
});

function url(p) {
  return `http://localhost:${port}${p}`;
}

function roundContent(session, extra = {}) {
  return {
    session,
    title: '远程轮次',
    blocks: [{ id: 'remote-note', type: 'markdown', body: '云端是唯一事实源' }],
    ...extra,
  };
}

function incompleteChoice(id = 'incomplete-choice') {
  return {
    id,
    type: 'choice',
    needsDecision: true,
    hasRecommendation: true,
    recommendation: 'safe',
    options: [
      { id: 'safe', label: '稳妥方案' },
      { id: 'fast', label: '快速方案' },
    ],
  };
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

test('GET /api/projects 返回项目目录并隐藏服务器仓库路径', async () => {
  const projects = await import('../../src/projects.mjs');
  projects.writeProjectRegistry({
    version: 1,
    projects: [{
      id: 'server-project',
      displayName: '服务端项目',
      repoPath: '/srv/private/project',
      primarySession: 'server-project-main',
      previewMode: 'live',
    }],
  });
  writeJSON(paths.content('server-project-main', 1, { exactSession: true }), {
    session: 'server-project-main',
    round: 1,
    title: '产品主线',
    blocks: [],
  });
  projects.updateSessionMetadata('server-project-main', {
    title: '服务端产品主线',
    projectId: 'server-project',
    status: 'active',
  });

  const res = await fetch(url('/api/projects'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.projects[0].id, 'server-project');
  assert.equal(body.sessions.find((item) => item.id === 'server-project-main').projectId, 'server-project');
  assert.doesNotMatch(JSON.stringify(body), /\/srv\/private/);
});

test('GET /api/session-context 只向管理员 worker 返回注册仓库路径', async () => {
  assert.equal((await fetch(url('/api/session-context?session=server-project-main'))).status, 403);
  const alice = {
    id: 'alice-projects',
    name: '小艾',
    token: 'alice-project-token',
    createdAt: '2026-07-23T00:00:00.000Z',
  };
  await withIdentityServer(
    { ownerToken: 'owner-project-token', participants: [alice] },
    async ({ port: authPort }) => {
      const endpoint = `http://127.0.0.1:${authPort}/api/session-context?session=server-project-main`;
      assert.equal((await fetch(endpoint)).status, 403);
      assert.equal((await fetch(endpoint, {
        headers: { 'x-workbench-token': alice.token },
      })).status, 403);
      assert.equal((await fetch(
        `http://127.0.0.1:${authPort}/api/session-context?session=missing-project-session`,
        { headers: { 'x-workbench-token': 'owner-project-token' } },
      )).status, 404);

      const response = await fetch(endpoint, {
        headers: { 'x-workbench-token': 'owner-project-token' },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.context.primaryProject.id, 'server-project');
      assert.equal(body.context.primaryProject.repoPath, '/srv/private/project');
    },
  );
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

test('POST /api/feedback 拒绝非法 session 名称', async () => {
  const res = await fetch(url('/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: '../escape', round: 1, items: [] }),
  });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /session|会话/i);
});

// ---- 远程会话写入 / feedback 轮询 ----

test('POST /api/rounds 首轮写入内容、未归属 warning 与默认会话元数据', async () => {
  const s = 'remote.session-01';
  const legacyContent = path.join(tmpDir, 'remote_session-01', 'round-1', 'content.json');
  fs.mkdirSync(path.dirname(legacyContent), { recursive: true });
  fs.writeFileSync(legacyContent, JSON.stringify({ session: 'remote_session-01', round: 1, blocks: [] }));
  const res = await fetch(url('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(roundContent(s)),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual({ ok: body.ok, session: body.session, round: body.round }, { ok: true, session: s, round: 1 });
  assert.equal(body.warning, '未归属项目的新会话，建议先在项目下创建或使用规范命名');
  assert.equal(new URL(body.url).searchParams.get('session'), s);
  assert.equal(readJSON(paths.content(s, 1)).title, '远程轮次');
  const metadata = readJSON(paths.session(s, { exactSession: true }));
  assert.equal(metadata.session, s);
  assert.equal(metadata.title, '远程轮次');
  assert.equal(metadata.kind, 'work');
  assert.equal(metadata.status, 'active');
  assert.equal(Object.hasOwn(metadata, 'projectId'), false);
  assert.match(fs.readFileSync(paths.contentMd(s, 1), 'utf8'), /云端是唯一事实源/);
  assert.equal(readJSON(paths.status(s)).state, 'rendered');
  assert.equal(fs.existsSync(path.join(tmpDir, s, 'round-1', 'content.json')), true, '点号 session 应按原名落盘');
  assert.equal(JSON.parse(fs.readFileSync(legacyContent, 'utf8')).session, 'remote_session-01', '远程精确 session 不得覆盖旧版同名映射目录');
});

test('POST /api/rounds 忽略客户端 round 并由服务端连续编号', async () => {
  const s = 'remote-round-server-owned';
  const first = roundContent(s, { round: 99 });
  const firstRes = await fetch(url('/api/rounds'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(first),
  });
  assert.equal(firstRes.status, 200);
  const firstBody = await firstRes.json();
  assert.equal(firstBody.round, 1);
  assert.equal(firstBody.warning, '未归属项目的新会话，建议先在项目下创建或使用规范命名');

  const second = roundContent(s, {
    round: 1,
    title: '第二轮标题不覆盖出生元数据',
    blocks: [{ id: 'second', type: 'markdown', body: '服务端分配第二轮' }],
  });
  const res = await fetch(url('/api/rounds'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(second),
  });

  assert.equal(res.status, 200);
  const secondBody = await res.json();
  assert.equal(secondBody.round, 2);
  assert.equal(secondBody.warning, undefined);
  assert.equal(readJSON(paths.content(s, 1)).round, 1);
  assert.equal(readJSON(paths.content(s, 1)).blocks[0].id, 'remote-note');
  assert.equal(readJSON(paths.content(s, 2)).round, 2);
  assert.equal(readJSON(paths.content(s, 2)).blocks[0].id, 'second');
  assert.equal(readJSON(paths.session(s, { exactSession: true })).title, '远程轮次');
});

test('POST /api/rounds 注册项目会话首轮自动写入项目归属且不 warning', async () => {
  const projects = await import('../../src/projects.mjs');
  const previousRegistry = projects.readProjectRegistry();
  const s = 'registered-project-main';
  try {
    projects.writeProjectRegistry({
      version: 1,
      projects: [{
        id: 'registered-project',
        displayName: '已注册项目',
        primarySession: s,
      }],
    });

    const res = await fetch(url('/api/rounds'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roundContent(s, { title: '已注册项目主线' })),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.warning, undefined);
    const metadata = readJSON(paths.session(s, { exactSession: true }));
    assert.equal(metadata.projectId, 'registered-project');
    assert.equal(metadata.title, '已注册项目主线');
    assert.equal(metadata.kind, 'work');
    assert.equal(metadata.status, 'active');
  } finally {
    projects.writeProjectRegistry(previousRegistry);
  }
});

test('POST /api/rounds 已有 session.json.projectId 的项目子会话首轮不 warning', async () => {
  const projects = await import('../../src/projects.mjs');
  const previousRegistry = projects.readProjectRegistry();
  const s = 'registered-project-child';
  try {
    projects.writeProjectRegistry({
      version: 1,
      projects: [{
        id: 'registered-parent',
        displayName: '已注册父项目',
        primarySession: 'registered-parent-main',
      }],
    });
    projects.updateSessionMetadata(s, {
      title: '创建时标题',
      projectId: 'registered-parent',
      kind: 'review',
      status: 'active',
    });

    const res = await fetch(url('/api/rounds'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roundContent(s, { title: '首轮内容标题' })),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.warning, undefined);
    const metadata = readJSON(paths.session(s, { exactSession: true }));
    assert.equal(metadata.projectId, 'registered-parent');
    assert.equal(metadata.title, '首轮内容标题');
    assert.equal(metadata.kind, 'work');
    assert.equal(metadata.status, 'active');
  } finally {
    projects.writeProjectRegistry(previousRegistry);
  }
});

test('POST /api/rounds 同 session 并发请求获得连续且不同的服务端轮次', async () => {
  const s = 'remote-round-concurrent';
  const post = (id) => fetch(url('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(roundContent(s, {
      round: 88,
      blocks: [{ id, type: 'markdown', body: `并发请求 ${id}` }],
    })),
  });

  const responses = await Promise.all([post('concurrent-a'), post('concurrent-b')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(bodies.map((body) => body.round).sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(
    [readJSON(paths.content(s, 1)).round, readJSON(paths.content(s, 2)).round],
    [1, 2],
  );
});

test('POST /api/rounds 在口令门开启时拒绝无 token 请求', async () => {
  const s = 'remote-auth-denied';
  await withTokenServer('round-token', async (authPort) => {
    const res = await fetch(`http://127.0.0.1:${authPort}/api/rounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roundContent(s)),
    });
    assert.equal(res.status, 403);
  });
  assert.equal(exists(paths.content(s, 1)), false);
});

test('POST /api/rounds body 超过 2 MiB 返回 413 且不落盘', async () => {
  const s = 'remote-too-large';
  const oversized = roundContent(s, {
    blocks: [{ id: 'large', type: 'markdown', body: 'x'.repeat(2 * 1024 * 1024) }],
  });
  const res = await fetch(url('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(oversized),
  });

  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /2\s*MB|过大|上限/i);
  assert.equal(exists(paths.content(s, 1)), false);
});

test('POST /api/rounds 拒绝非法 session 与无效 content', async () => {
  const invalidSession = await fetch(url('/api/rounds'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roundContent('../escape')),
  });
  assert.equal(invalidSession.status, 400);
  assert.match((await invalidSession.json()).error, /session/i);

  const tooLongSession = 's'.repeat(81);
  const tooLong = await fetch(url('/api/rounds'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(roundContent(tooLongSession)),
  });
  assert.equal(tooLong.status, 400);
  assert.match((await tooLong.json()).error, /80/);

  const invalidContent = await fetch(url('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: 'invalid-content', round: 0, blocks: 'not-an-array' }),
  });
  assert.equal(invalidContent.status, 400);
  assert.match((await invalidContent.json()).error, /validateContent|内容校验|blocks/i);

  const ignoredUnsafeRound = await fetch(url('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: 'unsafe-round', round: Number.MAX_SAFE_INTEGER + 1, blocks: [] }),
  });
  assert.equal(ignoredUnsafeRound.status, 200);
  assert.equal((await ignoredUnsafeRound.json()).round, 1);
});

test('POST /api/rounds 决策不完整默认拒绝，allowIncomplete=1 时放行', async () => {
  const rejectedSession = 'remote-lint-rejected';
  const rejected = await fetch(url('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: rejectedSession, blocks: [incompleteChoice()] }),
  });
  assert.equal(rejected.status, 400);
  const rejectedBody = await rejected.json();
  assert.match(rejectedBody.error, /决策块|background/);
  assert.equal(exists(paths.content(rejectedSession, 1)), false);

  const bypassedSession = 'remote-lint-bypassed';
  const bypassed = await fetch(url('/api/rounds?allowIncomplete=1'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: bypassedSession, blocks: [incompleteChoice('bypassed-choice')] }),
  });
  assert.equal(bypassed.status, 200);
  const bypassedBody = await bypassed.json();
  assert.equal(bypassedBody.lintBypassed, true);
  assert.equal(exists(paths.content(bypassedSession, 1)), true);
});

test('GET /api/feedback pending 与命中均返回 HTTP 200', async () => {
  const s = 'remote-feedback-poll';
  const pending = await fetch(url(`/api/feedback?session=${s}&round=1`));
  assert.equal(pending.status, 200);
  assert.deepEqual(await pending.json(), { ok: false, pending: true });

  const feedback = { session: s, round: 1, items: [{ blockId: 'remote-note', type: 'verdict', value: 'approve' }] };
  writeJSON(paths.feedback(s, 1), feedback);
  const hit = await fetch(url(`/api/feedback?session=${s}&round=1`));
  assert.equal(hit.status, 200);
  assert.deepEqual(await hit.json(), { ok: true, feedback, byParticipant: [], conflicts: [] });
});

test('GET /api/feedback 对非法 session/round 返回 400', async () => {
  for (const query of ['session=../escape&round=1', 'session=valid&round=0', 'session=valid&round=1x']) {
    const res = await fetch(url(`/api/feedback?${query}`));
    assert.equal(res.status, 400, query);
    assert.match((await res.json()).error, /session|round/i);
  }
});

test('远程精确 session 的 status/content/feedback 读取不串到 legacySafe 目录', async () => {
  const s = 'remote.exact-reads';
  const legacyDir = path.join(tmpDir, 'remote_exact-reads');
  fs.mkdirSync(path.join(legacyDir, 'round-1'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'status.json'), JSON.stringify({ session: s, round: 9, state: 'error' }));
  fs.writeFileSync(path.join(legacyDir, 'round-1', 'content.json'), JSON.stringify({
    session: s,
    round: 1,
    title: 'legacy-content',
    blocks: [{ id: 'legacy', type: 'markdown', body: '旧映射目录' }],
  }));
  fs.writeFileSync(path.join(legacyDir, 'round-1', 'feedback.json'), JSON.stringify({
    session: s,
    round: 1,
    items: [{ blockId: 'legacy', type: 'verdict', value: 'legacy' }],
  }));

  const presented = await fetch(url('/api/rounds'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(roundContent(s, { title: 'exact-content' })),
  });
  assert.equal(presented.status, 200);
  const exactFeedback = {
    session: s,
    round: 1,
    items: [{ blockId: 'remote-note', type: 'verdict', value: 'exact' }],
  };
  writeJSON(paths.feedback(s, 1, { exactSession: true }), exactFeedback);

  const [statusRes, contentRes, feedbackRes] = await Promise.all([
    fetch(url(`/api/status?session=${encodeURIComponent(s)}`)),
    fetch(url(`/api/content?session=${encodeURIComponent(s)}&round=1`)),
    fetch(url(`/api/feedback?session=${encodeURIComponent(s)}&round=1`)),
  ]);
  const statusBody = await statusRes.json();
  const contentBody = await contentRes.json();
  const feedbackBody = await feedbackRes.json();

  assert.equal(statusBody.status.round, 1);
  assert.equal(statusBody.status.state, 'rendered');
  assert.equal(contentBody.title, 'exact-content');
  assert.equal(contentBody.blocks[0].id, 'remote-note');
  assert.deepEqual(feedbackBody, { ok: true, feedback: exactFeedback, byParticipant: [], conflicts: [] });
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
  assert.equal(body.workerOnline, false);
  assert.equal(body.workerLabel, null);
});

// ---- GET /api/status: no session → ok:true, status:null, display:unknown ----
test('GET /api/status with unknown session → status:null, display:unknown', async () => {
  const res = await fetch(url('/api/status?session=ses_nonexistent_xyz'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, null);
  assert.equal(body.display, 'unknown');
  assert.equal(body.workerOnline, false);
  assert.equal(body.workerLabel, null);
});

test('POST /api/worker-heartbeat 只允许口令门内管理员，90 秒后 status 如实离线', async () => {
  const localDenied = await fetch(url('/api/worker-heartbeat'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ at: new Date().toISOString(), label: '不应写入' }),
  });
  assert.equal(localDenied.status, 403, '未开启口令门时也不得写 worker 心跳');

  const alice = {
    id: 'alice',
    name: '小艾',
    token: 'alice-worker-token',
    createdAt: '2026-07-23T00:00:00.000Z',
  };
  await withIdentityServer({ ownerToken: 'owner-worker-token', participants: [alice] }, async ({ port: authPort }) => {
    const base = `http://127.0.0.1:${authPort}`;
    const endpoint = `${base}/api/worker-heartbeat`;
    const missing = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ at: new Date().toISOString() }),
    });
    assert.equal(missing.status, 403);

    const participant = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workbench-token': alice.token,
      },
      body: JSON.stringify({ at: new Date().toISOString(), label: '参与者伪造 worker' }),
    });
    assert.equal(participant.status, 403);

    const expiredHeartbeat = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workbench-token': 'owner-worker-token',
      },
      body: JSON.stringify({
        at: new Date(Date.now() - 91_000).toISOString(),
        label: '云端 Codex · sol xhigh',
      }),
    });
    assert.equal(expiredHeartbeat.status, 200);

    const expiredStatus = await fetch(`${base}/api/status?session=missing-session`, {
      headers: { 'x-workbench-token': 'owner-worker-token' },
    }).then((response) => response.json());
    assert.equal(expiredStatus.workerOnline, false);
    assert.equal(expiredStatus.workerLabel, '云端 Codex · sol xhigh');

    const freshHeartbeat = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workbench-token': 'owner-worker-token',
      },
      body: JSON.stringify({
        at: new Date().toISOString(),
        label: '云端 Codex · sol xhigh',
      }),
    });
    assert.equal(freshHeartbeat.status, 200);

    const freshStatus = await fetch(`${base}/api/status?session=missing-session`, {
      headers: { 'x-workbench-token': 'owner-worker-token' },
    }).then((response) => response.json());
    assert.equal(freshStatus.workerOnline, true);
    assert.equal(freshStatus.workerLabel, '云端 Codex · sol xhigh');
  });
});

test('GET /api/status error 态合并该轮 error.json 到嵌套 status.error', async () => {
  const s = 'ses_status_error01';
  const r = 2;
  writeStatus(s, { state: 'error', round: r, error: null });
  writeJSON(paths.error(s, r), {
    kind: 'api',
    message: 'upstream failed',
    userMessage: 'AI 服务暂时不可用，请稍后重试。',
    suggestedAction: '稍后点击重试',
    retryable: true,
  });

  const res = await fetch(url(`/api/status?session=${s}`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.display, 'error');
  assert.equal(body.status.error.kind, 'api');
  assert.equal(body.status.error.userMessage, 'AI 服务暂时不可用，请稍后重试。');
  assert.equal(body.status.error.retryable, true);

  const stored = JSON.parse(fs.readFileSync(paths.status(s), 'utf8'));
  assert.equal(stored.error, null, 'API 合并不得改写落盘 status.json');
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
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
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
    if (req.url.startsWith('/page')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head></head><body><form method="post" action="/decide"></form></body></html>');
      return;
    }
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

test('rewriteEmbedHtml: 鉴权 token 进入 form/fetch/XHR 共用的代理基址', () => {
  const token = 'embed /? 中文';
  const out = rewriteEmbedHtml(
    '<html><head></head><body><form action="/decide"></form></body></html>',
    'http://127.0.0.1:8123/page',
    'http://127.0.0.1:8099',
    token,
  );
  const proxyBase = `http://127.0.0.1:8099/api/proxy?token=${encodeURIComponent(token)}&url=`;
  assert.ok(out.includes(proxyBase), `注入页内的代理基址应携 token: ${out}`);
  assert.ok(out.includes(`action="${proxyBase}`), 'form action 应携 token');
});

// ---- 会话资产自托管 /assets/<session>/... （去掉对外部服务的依赖）----

test('GET /assets/<session>/<file>：供 session 自带的静态资产（如高保真 UI 稿）', async () => {
  const dir = path.join(tmpDir, session, 'assets', 'ui');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'b-home.html'), '<html><head><title>主界面</title></head><body>hi</body></html>');

  const res = await fetch(url(`/assets/${session}/ui/b-home.html`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
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

// ---- HTTP 鉴权与监听地址安全边界 ----

async function withTokenServer(token, fn) {
  const previous = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_TOKEN = token;
  const authServer = startServer(0);
  await new Promise((resolve) => authServer.once('listening', resolve));
  try {
    await fn(authServer.address().port);
  } finally {
    await new Promise((resolve) => authServer.close(resolve));
    if (previous == null) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = previous;
  }
}

async function withIdentityServer({ ownerToken = 'owner-secret', participants = [] } = {}, fn) {
  const previous = process.env.WORKBENCH_TOKEN;
  if (ownerToken) process.env.WORKBENCH_TOKEN = ownerToken;
  else delete process.env.WORKBENCH_TOKEN;
  const rosterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-roster-e2e-'));
  const participantsFile = path.join(rosterDir, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, JSON.stringify(participants, null, 2));
  const authServer = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => authServer.once('listening', resolve));
  try {
    await fn({ port: authServer.address().port, participantsFile });
  } finally {
    await new Promise((resolve) => authServer.close(resolve));
    fs.rmSync(rosterDir, { recursive: true, force: true });
    if (previous == null) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = previous;
  }
}

test('safeTokenEqual：固定长度归一后比较 token', () => {
  assert.equal(typeof safeTokenEqual, 'function', 'server 应导出纯 token 比较函数');
  assert.equal(safeTokenEqual('alpha', 'alpha'), true);
  assert.equal(safeTokenEqual('alpha', 'alphb'), false);
  assert.equal(safeTokenEqual('', ''), false);
  assert.equal(safeTokenEqual('', 'alpha'), false);
  assert.equal(safeTokenEqual('alpha', ''), false);
  assert.equal(safeTokenEqual(undefined, 'alpha'), false);
  assert.equal(safeTokenEqual('alpha', null), false);
  assert.equal(safeTokenEqual(123, '123'), false);
  assert.equal(safeTokenEqual('alpha', { value: 'alpha' }), false);
});

test('requiresPageToken：render 下 HTML/目录/无扩展页面受保护，静态资源豁免', () => {
  assert.equal(typeof requiresPageToken, 'function');
  for (const pathname of ['/', '/render', '/render/', '/render/index.html', '/render/reports/detail.html', '/render/reports/', '/render/reports/detail', '/render/foo.json', '/render/foo.map']) {
    assert.equal(requiresPageToken(pathname), true, `${pathname} 应视为页面入口`);
  }
  for (const pathname of ['/render/app.mjs', '/render/theme.css', '/render/logo.png', '/assets/s/ui/page.html']) {
    assert.equal(requiresPageToken(pathname), false, `${pathname} 应视为静态/会话资产`);
  }
});

test('startServer：非本机 host 且无 WORKBENCH_TOKEN 时同步拒绝启动', () => {
  const previous = process.env.WORKBENCH_TOKEN;
  delete process.env.WORKBENCH_TOKEN;
  let unexpectedServer;
  try {
    assert.throws(
      () => { unexpectedServer = startServer(0, '0.0.0.0'); },
      /令牌|WORKBENCH_TOKEN/,
    );
  } finally {
    unexpectedServer?.close();
    if (previous != null) process.env.WORKBENCH_TOKEN = previous;
  }
});

test('WORKBENCH_TOKEN：页面入口与 API 拒绝缺失或错误 token', async () => {
  await withTokenServer('correct-token', async (authPort) => {
    const base = `http://127.0.0.1:${authPort}`;
    for (const pathname of ['/', '/render', '/render/', '/render/index.html', '/api/health']) {
      const res = await fetch(base + pathname, { redirect: 'manual' });
      assert.equal(res.status, 403, `${pathname} 缺 token 应返回 403`);
      assert.match(await res.text(), /令牌|token/i, `${pathname} 应返回中文令牌提示`);
    }

    const wrong = await fetch(`${base}/api/health?token=wrong`);
    assert.equal(wrong.status, 403);
  });
});

test('WORKBENCH_TOKEN：未来新增的 render HTML 子路径也先鉴权', async () => {
  await withTokenServer('nested-page-token', async (authPort) => {
    const base = `http://127.0.0.1:${authPort}`;
    const denied = await fetch(`${base}/render/reports/detail.html`);
    assert.equal(denied.status, 403);
    const authorized = await fetch(`${base}/render/reports/detail.html?token=nested-page-token`);
    assert.equal(authorized.status, 404, '鉴权通过后才进入静态文件查找');
  });
});

test('WORKBENCH_TOKEN：页面 query、API query/header 放行，根路径重定向透传 token', async () => {
  const token = 'secret /? & token';
  await withTokenServer(token, async (authPort) => {
    const base = `http://127.0.0.1:${authPort}`;
    const encoded = encodeURIComponent(token);

    const root = await fetch(`${base}/?token=${encoded}`, { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), `/render/index.html?token=${encoded}`);

    const renderDir = await fetch(`${base}/render/?token=${encoded}`);
    assert.equal(renderDir.status, 200, '/render/ 携带 query token 应直接放行');
    assert.equal(renderDir.headers.get('referrer-policy'), 'no-referrer');

    const byQuery = await fetch(`${base}/api/health?token=${encoded}`);
    assert.equal(byQuery.status, 200);

    const byHeader = await fetch(`${base}/api/health`, {
      headers: { 'x-workbench-token': token },
    });
    assert.equal(byHeader.status, 200);

    const staticJs = await fetch(`${base}/render/app.mjs`);
    assert.equal(staticJs.status, 200, '页面加载所需静态 JS 可豁免 token');
  });
});

test('参与者 token 放行页面/API，解析实名身份且根跳转不泄漏管理员口令', async () => {
  const alice = {
    id: 'alice', name: '小艾', token: 'alice-personal-token', createdAt: '2026-07-23T00:00:00.000Z',
  };
  await withIdentityServer({ participants: [alice] }, async ({ port: authPort }) => {
    const base = `http://127.0.0.1:${authPort}`;
    const root = await fetch(`${base}/?token=${encodeURIComponent(alice.token)}`, { redirect: 'manual' });
    assert.equal(root.status, 302);
    const location = root.headers.get('location');
    assert.equal(new URL(location, base).searchParams.get('token'), alice.token);
    assert.equal(location.includes('owner-secret'), false);

    assert.equal((await fetch(`${base}/render/?token=${alice.token}`)).status, 200);
    assert.equal((await fetch(`${base}/api/health`, {
      headers: { 'x-workbench-token': alice.token },
    })).status, 200);
    assert.equal((await fetch(`${base}/api/health?token=wrong`)).status, 403);

    const sessionId = 'participant-identity';
    writeJSON(paths.content(sessionId, 1, { exactSession: true }), { session: sessionId, round: 1, blocks: [] });
    writeStatus(sessionId, { state: 'rendered', round: 1 });
    const posted = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workbench-token': alice.token },
      body: JSON.stringify({ session: sessionId, round: 1, items: [] }),
    });
    assert.equal(posted.status, 200);
    const saved = readJSON(path.join(path.dirname(paths.feedback(sessionId, 1, { exactSession: true })), 'feedback-alice.json'));
    assert.deepEqual(saved.submittedBy, { id: 'alice', name: '小艾' });
  });
});

test('参与者 token 不能创建新一轮：POST /api/rounds 仅限管理员', async () => {
  const alice = {
    id: 'alice', name: '小艾', token: 'alice-personal-token', createdAt: '2026-07-23T00:00:00.000Z',
  };
  await withIdentityServer({ participants: [alice] }, async ({ port: authPort }) => {
    const base = `http://127.0.0.1:${authPort}`;
    const denied = await fetch(`${base}/api/rounds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workbench-token': alice.token },
      body: JSON.stringify({ session: 'participant-no-rounds', title: 't', blocks: [] }),
    });
    assert.equal(denied.status, 403);
    assert.match((await denied.json()).error, /管理员/);

    const allowed = await fetch(`${base}/api/rounds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workbench-token': 'owner-secret' },
      body: JSON.stringify({ session: 'owner-can-round', title: 't', blocks: [] }),
    });
    assert.equal(allowed.status, 200);
  });
});

test('参与者管理 API：仅管理员可 add/list/delete，列表脱敏且吊销立即失效', async () => {
  const alice = {
    id: 'alice', name: '小艾', token: 'alice-existing-token', createdAt: '2026-07-23T00:00:00.000Z',
  };
  await withIdentityServer({ participants: [alice] }, async ({ port: authPort }) => {
    const base = `http://127.0.0.1:${authPort}`;
    const ownerHeaders = { 'content-type': 'application/json', 'x-workbench-token': 'owner-secret' };
    const createdRes = await fetch(`${base}/api/participants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ id: 'bob', name: '小波' }),
    });
    assert.equal(createdRes.status, 201);
    const created = await createdRes.json();
    assert.equal(created.ok, true);
    assert.deepEqual({ id: created.participant.id, name: created.participant.name }, { id: 'bob', name: '小波' });
    assert.equal(Object.hasOwn(created.participant, 'token'), false);
    const bobUrl = new URL(created.url);
    assert.equal(bobUrl.origin, base);
    assert.equal(bobUrl.pathname, '/render/');
    const bobToken = bobUrl.searchParams.get('token');
    assert.match(bobToken, /^[a-f0-9]{32}$/);

    const listedRes = await fetch(`${base}/api/participants`, {
      headers: { 'x-workbench-token': 'owner-secret' },
    });
    assert.equal(listedRes.status, 200);
    const listed = await listedRes.json();
    assert.deepEqual(listed.participants.map(({ id, name }) => ({ id, name })), [
      { id: 'alice', name: '小艾' },
      { id: 'bob', name: '小波' },
    ]);
    assert.equal(JSON.stringify(listed).includes(alice.token), false);
    assert.equal(JSON.stringify(listed).includes(bobToken), false);

    const denied = await fetch(`${base}/api/participants`, {
      headers: { 'x-workbench-token': alice.token },
    });
    assert.equal(denied.status, 403);

    const revoked = await fetch(`${base}/api/participants/bob`, {
      method: 'DELETE',
      headers: { 'x-workbench-token': 'owner-secret' },
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { ok: true, id: 'bob' });
    assert.equal((await fetch(`${base}/api/health?token=${bobToken}`)).status, 403);
  });

  await withIdentityServer({ ownerToken: '', participants: [alice] }, async ({ port: authPort }) => {
    const base = `http://127.0.0.1:${authPort}`;
    assert.equal((await fetch(`${base}/api/participants?token=${alice.token}`)).status, 403);
    assert.equal((await fetch(`${base}/api/participants`)).status, 403);
  });
});

test('逐人反馈：独立落盘、首份兼容唤醒、owner 优先合并并检测 select 分歧', async () => {
  const participants = [
    { id: 'alice', name: '小艾', token: 'alice-feedback-token', createdAt: '2026-07-23T00:00:00.000Z' },
    { id: 'bob', name: '小波', token: 'bob-feedback-token', createdAt: '2026-07-23T00:00:01.000Z' },
  ];
  await withIdentityServer({ participants }, async ({ port: authPort }) => {
    const base = `http://127.0.0.1:${authPort}`;
    const sessionId = 'multi-feedback';
    writeJSON(paths.content(sessionId, 1, { exactSession: true }), { session: sessionId, round: 1, blocks: [] });
    writeStatus(sessionId, { state: 'rendered', round: 1 });
    const submit = (token, value, comment = '') => fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workbench-token': token },
      body: JSON.stringify({
        session: sessionId,
        round: 1,
        items: [{ blockId: 'decision-x', type: 'select', value, comment }],
      }),
    });

    assert.equal((await submit(participants[0].token, 'safe', '稳妥')).status, 200);
    const dir = path.dirname(paths.feedback(sessionId, 1, { exactSession: true }));
    const aliceSaved = readJSON(path.join(dir, 'feedback-alice.json'));
    assert.deepEqual(aliceSaved.submittedBy, { id: 'alice', name: '小艾' });
    assert.deepEqual(readJSON(path.join(dir, 'feedback.json')).submittedBy, { id: 'alice', name: '小艾' });
    assert.equal(readJSON(paths.status(sessionId)).state, 'submitted');

    assert.equal((await submit(participants[1].token, 'fast', '更快')).status, 200);
    const bobSaved = readJSON(path.join(dir, 'feedback-bob.json'));
    assert.deepEqual(bobSaved.submittedBy, { id: 'bob', name: '小波' });

    const participantView = await fetch(`${base}/api/feedback?session=${sessionId}&round=1`, {
      headers: { 'x-workbench-token': participants[0].token },
    }).then((res) => res.json());
    assert.equal(participantView.feedback.submittedBy.id, 'alice');
    assert.deepEqual(participantView.byParticipant.map((entry) => entry.id), ['alice', 'bob']);
    assert.deepEqual(participantView.byParticipant.map((entry) => entry.name), ['小艾', '小波']);
    assert.deepEqual(participantView.conflicts, [{
      blockId: 'decision-x',
      choices: [
        { participant: '小艾', value: 'safe' },
        { participant: '小波', value: 'fast' },
      ],
    }]);

    const ownerFeedback = {
      session: sessionId,
      round: 1,
      items: [{ blockId: 'decision-x', type: 'select', value: 'owner-final' }],
    };
    const ownerPost = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workbench-token': 'owner-secret' },
      body: JSON.stringify(ownerFeedback),
    });
    assert.equal(ownerPost.status, 200);
    const ownerView = await fetch(`${base}/api/feedback?session=${sessionId}&round=1`, {
      headers: { 'x-workbench-token': 'owner-secret' },
    }).then((res) => res.json());
    assert.deepEqual(ownerView.feedback.submittedBy, { id: 'owner', name: '管理员' });
    assert.equal(ownerView.feedback.items[0].value, 'owner-final');
    assert.deepEqual(ownerView.byParticipant.map((entry) => entry.id), ['alice', 'bob']);
    assert.deepEqual(ownerView.conflicts[0].choices, [
      { participant: '管理员', value: 'owner-final' },
      { participant: '小艾', value: 'safe' },
      { participant: '小波', value: 'fast' },
    ]);
  });
});

test('逐人反馈：相同 select/非 select 不报分歧，claimed 后参与者可补交且状态不倒退', async () => {
  const participants = [
    { id: 'alice', name: '小艾', token: 'alice-late-token', createdAt: '2026-07-23T00:00:00.000Z' },
    { id: 'bob', name: '小波', token: 'bob-late-token', createdAt: '2026-07-23T00:00:01.000Z' },
  ];
  await withIdentityServer({ participants }, async ({ port: authPort }) => {
    const base = `http://127.0.0.1:${authPort}`;
    const sessionId = 'late-feedback';
    writeJSON(paths.content(sessionId, 1, { exactSession: true }), { session: sessionId, round: 1, blocks: [] });
    writeStatus(sessionId, { state: 'rendered', round: 1 });
    const post = (token, items) => fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workbench-token': token },
      body: JSON.stringify({ session: sessionId, round: 1, items }),
    });

    assert.equal((await post(participants[0].token, [
      { blockId: 'same', type: 'select', value: 'a' },
      { blockId: 'notes', type: 'text', value: '甲' },
    ])).status, 200);
    writeStatus(sessionId, { state: 'claimed', round: 1 });
    assert.equal((await post(participants[1].token, [
      { blockId: 'same', type: 'select', value: 'a' },
      { blockId: 'notes', type: 'text', value: '乙' },
    ])).status, 200);
    assert.equal(readJSON(paths.status(sessionId)).state, 'claimed');

    const ownerLate = await post('owner-secret', [{ blockId: 'same', type: 'select', value: 'a' }]);
    assert.equal(ownerLate.status, 409, '旧 owner 单人流程的 claimed 防重入保持不变');
    const view = await fetch(`${base}/api/feedback?session=${sessionId}&round=1`, {
      headers: { 'x-workbench-token': 'owner-secret' },
    }).then((res) => res.json());
    assert.deepEqual(view.conflicts, []);
  });
});

test('WORKBENCH_TOKEN：/assets/* 必须使用 query token，header 单独不能放行', async () => {
  const assetSession = 'ses_auth_asset01';
  const assetDir = path.join(tmpDir, assetSession, 'assets', 'ui');
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'screen.html'), '<html><body>protected asset</body></html>');

  await withTokenServer('asset-token', async (authPort) => {
    const assetUrl = `http://127.0.0.1:${authPort}/assets/${assetSession}/ui/screen.html`;
    const missing = await fetch(assetUrl);
    assert.equal(missing.status, 403);

    const headerOnly = await fetch(assetUrl, { headers: { 'x-workbench-token': 'asset-token' } });
    assert.equal(headerOnly.status, 403);

    const allowed = await fetch(`${assetUrl}?token=asset-token`);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('referrer-policy'), 'no-referrer');
    assert.match(await allowed.text(), /protected asset/);
  });
});

test('CORS 预检允许 x-workbench-token', async () => {
  await withTokenServer('cors-token', async (authPort) => {
    const res = await fetch(`http://127.0.0.1:${authPort}/api/health`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-headers') || '', /x-workbench-token/i);
  });
});

test('鉴权模式下 /api/proxy 返回的 HTML 会把 token 继续透传给二次代理请求', async () => {
  const token = 'nested&token 中文';
  const { srv, port: echoPort } = await startEcho();
  try {
    await withTokenServer(token, async (authPort) => {
      const target = `http://127.0.0.1:${echoPort}/page`;
      const res = await fetch(
        `http://127.0.0.1:${authPort}/api/proxy?token=${encodeURIComponent(token)}&url=${encodeURIComponent(target)}`,
      );
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      const proxyBase = `http://127.0.0.1:${authPort}/api/proxy?token=${encodeURIComponent(token)}&url=`;
      assert.ok(html.includes(proxyBase), `代理返回页应继续携 token: ${html}`);
      assert.ok(html.includes(`action="${proxyBase}`), '表单二次代理应携 token');
    });
  } finally {
    srv.close();
  }
});

// ---- 可选事件 webhook ----

test('postWebhookEvent：超时会 abort，失败只记录日志不向上抛出', async () => {
  let aborted = false;
  const errors = [];
  await postWebhookEvent('http://127.0.0.1:1/events', { event: 'round-presented' }, {
    timeoutMs: 20,
    fetchImpl: (_target, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      }, { once: true });
    }),
    logger: { error: (...args) => errors.push(args.join(' ')) },
  });

  assert.equal(aborted, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /webhook/i);
});

test('WORKBENCH_EVENT_WEBHOOK：轮次呈现与反馈提交后异步发送两个事件', async () => {
  const received = [];
  let resolveEvents;
  const bothEvents = new Promise((resolve) => { resolveEvents = resolve; });
  const webhookServer = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(204);
      res.end();
      if (received.length === 2) resolveEvents();
    });
  });
  webhookServer.listen(0, '127.0.0.1');
  await new Promise((resolve) => webhookServer.once('listening', resolve));

  const previous = process.env.WORKBENCH_EVENT_WEBHOOK;
  process.env.WORKBENCH_EVENT_WEBHOOK = `http://127.0.0.1:${webhookServer.address().port}/events`;
  const eventServer = startServer(0);
  await new Promise((resolve) => eventServer.once('listening', resolve));
  if (previous == null) delete process.env.WORKBENCH_EVENT_WEBHOOK;
  else process.env.WORKBENCH_EVENT_WEBHOOK = previous;

  const s = 'webhook-events';
  const base = `http://127.0.0.1:${eventServer.address().port}`;
  try {
    const presented = await fetch(`${base}/api/rounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roundContent(s, { title: 'Webhook 标题' })),
    });
    assert.equal(presented.status, 200);

    const submitted = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: s, round: 1, items: [] }),
    });
    assert.equal(submitted.status, 200);

    await Promise.race([
      bothEvents,
      new Promise((_, reject) => setTimeout(() => reject(new Error('等待 webhook 事件超时')), 1000)),
    ]);

    assert.deepEqual(received.map((item) => item.method), ['POST', 'POST']);
    assert.ok(received.every((item) => /application\/json/i.test(item.headers['content-type'] || '')));
    assert.deepEqual(received.map((item) => item.body.event), ['round-presented', 'feedback-submitted']);
    assert.deepEqual(received.map((item) => [item.body.session, item.body.round]), [[s, 1], [s, 1]]);
    assert.equal(received[0].body.title, 'Webhook 标题');
    assert.equal(received[1].body.title, undefined);
    assert.ok(received.every((item) => Number.isFinite(Date.parse(item.body.at))));
  } finally {
    await new Promise((resolve) => eventServer.close(resolve));
    await new Promise((resolve) => webhookServer.close(resolve));
  }
});
