// 控制塔 HTTP 鉴权、聚合、缓存与本地数据源的验收测试。
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let startServer;
let writeProjectRegistry;
let appendStreamEntry;
let enqueueInboxTask;
let workspace;
let tempDir;
const savedEnv = {};

before(async () => {
  for (const key of [
    'WB_WORKSPACE', 'WORKBENCH_TOKEN', 'VIBELOOP_ADMIN_TOKEN_VIDEO',
    'CONTROL_TOWER_WATCHDOG_FILE', 'CONTROL_TOWER_LOG_DIR',
  ]) savedEnv[key] = process.env[key];
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-control-tower-'));
  process.env.WB_WORKSPACE = tempDir;
  process.env.VIBELOOP_ADMIN_TOKEN_VIDEO = 'loop-secret-must-not-leak';
  delete process.env.CONTROL_TOWER_LOG_DIR;

  ({ startServer } = await import('../../src/server/server.mjs'));
  ({ writeProjectRegistry } = await import('../../src/projects.mjs'));
  ({ appendStreamEntry } = await import('../../src/stream.mjs'));
  ({ enqueueInboxTask } = await import('../../src/executor-inbox.mjs'));
  workspace = await import('../../src/workspace.mjs');
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

async function withServer({ ownerToken = 'control-owner', participants = [] } = {}, fn) {
  const oldToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_TOKEN = ownerToken;
  const rosterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-control-roster-'));
  const participantsFile = path.join(rosterDir, 'config', 'participants.json');
  fs.mkdirSync(path.dirname(participantsFile), { recursive: true });
  fs.writeFileSync(participantsFile, JSON.stringify(participants));
  const server = startServer(0, '127.0.0.1', { participantsFile });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(rosterDir, { recursive: true, force: true });
    if (oldToken == null) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = oldToken;
  }
}

async function withLoopStatus(statusCode, body, fn) {
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls += 1;
    assert.equal(request.url, '/api/status');
    assert.equal(request.headers['x-workbench-token'], 'loop-secret-must-not-leak');
    response.writeHead(statusCode, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/status`, () => calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function registerProjects(statusUrl) {
  writeProjectRegistry({
    version: 1,
    projects: [
      {
        id: 'ai-video', displayName: 'AI 视频剪辑', primarySession: 'video-main',
        executor: 'cloud-codex',
        controlTower: {
          level: 2, statusUrl, tokenEnv: 'VIBELOOP_ADMIN_TOKEN_VIDEO',
          links: { feedback: 'https://example.test/feedback', tickets: 'https://example.test/tickets' },
        },
      },
      {
        id: 'idea-lab', displayName: '想法实验室', primarySession: 'idea-main',
        controlTower: { level: 0, links: { session: '/render/?session=idea-main' } },
      },
    ],
  });
}

test('控制塔只向管理员开放；匿名和参与者均为 403', async () => {
  const alice = { id: 'alice', name: '小艾', token: 'participant-secret', createdAt: '2026-07-26T00:00:00.000Z' };
  await withServer({ participants: [alice] }, async (base) => {
    assert.equal((await fetch(`${base}/control`)).status, 403);
    assert.equal((await fetch(`${base}/control?token=${alice.token}`)).status, 403);
    assert.equal((await fetch(`${base}/api/control-tower`, {
      headers: { 'x-workbench-token': alice.token },
    })).status, 403);

    assert.equal((await fetch(`${base}/control?token=control-owner`)).status, 200);
    assert.equal((await fetch(`${base}/api/control-tower`, {
      headers: { 'x-workbench-token': 'control-owner' },
    })).status, 200);
  });
});

test('聚合失败明确显示取不到，且 loop 管理员口令不进入响应', async () => {
  await withLoopStatus(503, { error: 'maintenance' }, async (statusUrl) => {
    registerProjects(statusUrl);
    await withServer({}, async (base) => {
      const response = await fetch(`${base}/api/control-tower?window=all`, {
        headers: { 'x-workbench-token': 'control-owner' },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      const project = body.overview.find((item) => item.id === 'ai-video');
      assert.equal(project.loop.availability, 'unavailable');
      assert.equal(project.loop.message, '取不到');
      assert.equal(JSON.stringify(body).includes('loop-secret-must-not-leak'), false);
    });
  });
});

test('loop 状态地址重定向时不跟随，避免管理员口令被带到未知地址', async () => {
  let redirectedCalls = 0;
  let receivedToken = null;
  const target = http.createServer((request, response) => {
    redirectedCalls += 1;
    receivedToken = request.headers['x-workbench-token'] || null;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ tickets: { open: 0 } }));
  });
  target.listen(0, '127.0.0.1');
  await new Promise((resolve) => target.once('listening', resolve));
  const source = http.createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/api/status` });
    response.end();
  });
  source.listen(0, '127.0.0.1');
  await new Promise((resolve) => source.once('listening', resolve));
  try {
    registerProjects(`http://127.0.0.1:${source.address().port}/api/status`);
    await withServer({}, async (base) => {
      const body = await fetch(`${base}/api/control-tower`, {
        headers: { 'x-workbench-token': 'control-owner' },
      }).then((response) => response.json());
      assert.equal(body.overview.find((item) => item.id === 'ai-video').loop.availability, 'unavailable');
    });
    assert.equal(redirectedCalls, 0);
    assert.equal(receivedToken, null);
  } finally {
    await new Promise((resolve) => source.close(resolve));
    await new Promise((resolve) => target.close(resolve));
  }
});

test('状态聚合缓存 20 秒，时间线支持筛选与分页并保留五要素', async () => {
  const now = new Date().toISOString();
  await withLoopStatus(200, {
    tickets: { open: 2, byStatus: { awaiting_human: 1, merged: 1 } },
    decisions: { open: 1, overdue: 1 },
    events: [
      {
        id: 'remote-1', at: now,
        actor: { id: 'cloud-codex', name: '云端 Codex', kind: 'ai' },
        action: { type: 'ticket.fixed', label: '修好了工单 t-export（导出失败）' },
        result: { status: 'merged', summary: '已排队等合入主线' },
        raw: { authorization: 'loop-secret-must-not-leak' },
      },
    ],
  }, async (statusUrl, calls) => {
    registerProjects(statusUrl);
    appendStreamEntry('video-main', {
      id: 'local-1', at: now, kind: 'progress', text: '已开始检查导出失败',
      author: { id: 'cloud-codex', name: '云端 Codex', role: 'ai' },
    }, { exactSession: true });
    enqueueInboxTask({
      executor: 'local-mac', session: 'video-main', type: 'manual', title: '检查导出失败', payload: { source: 'test' },
    });

    await withServer({}, async (base) => {
      const headers = { 'x-workbench-token': 'control-owner' };
      const first = await fetch(`${base}/api/control-tower?project=ai-video&type=ticket.fixed&page=1&pageSize=1`, { headers });
      assert.equal(first.status, 200);
      const initial = await first.json();
      assert.equal(initial.cache.hit, false);
      assert.equal(initial.timeline.total, 1);
      assert.equal(initial.timeline.items[0].id, 'remote-1');
      for (const key of ['at', 'actor', 'location', 'action', 'result']) {
        assert.ok(initial.timeline.items[0][key], `应包含审计五要素 ${key}`);
      }
      assert.equal(initial.overview.find((item) => item.id === 'ai-video').attentionCount, 2);
      assert.equal(Object.hasOwn(initial.overview.find((item) => item.id === 'idea-lab'), 'workItems'), false);
      assert.equal(initial.health.execution.localListener.state, '未知', '仅入队不等于本地监听器已经拉取');
      assert.equal(initial.health.logs.availability, 'unknown', '未配置日志目录时应明确未知');
      assert.equal(JSON.stringify(initial).includes('loop-secret-must-not-leak'), false, '远端意外回显的口令也不能进入控制塔');
      assert.ok(initial.timeline.facets.types.some((item) => item.value === 'conversation.progress'), '筛选项不能只来自当前分页');

      const second = await fetch(`${base}/api/control-tower?window=all&page=2&pageSize=1`, { headers });
      assert.equal(second.status, 200);
      const cached = await second.json();
      assert.equal(cached.cache.hit, true);
      assert.equal(calls(), 1, '缓存期内不应重复拉取 loop 状态');
      assert.equal(cached.timeline.page, 2);
      assert.equal(cached.timeline.items.length, 1);
    });
  });
});
