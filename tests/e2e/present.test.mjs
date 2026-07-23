// present / wait 一键命令（供 workbench skill 调用）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let tmp, clientTmp, ws, bin, server, port, remoteServer, remotePort;
const remoteToken = 'remote-test-token';
const savedEnv = {};
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/workbench.mjs');
const APP = path.resolve(__dirname, '../../src/render/app.mjs');

function completeChoice(id) {
  return {
    id,
    type: 'choice',
    title: '采用哪种发布方式？',
    needsDecision: true,
    hasRecommendation: true,
    recommendation: 'safe',
    background: '当前有两种发布方式，影响上线速度和回退成本。',
    why: '两种方式都能实现，但风险偏好需要由负责人决定。',
    recommendReason: '推荐稳妥发布，因为出现问题时可以立即回退。',
    options: [
      { id: 'safe', label: '稳妥发布', pros: ['可以快速回退'], cons: ['上线稍慢'] },
      { id: 'fast', label: '快速发布', pros: ['上线更快'], cons: ['回退步骤更多'] },
    ],
  };
}

function runPresentCli(session, content, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN, 'present', session, '-', '--port', String(port), ...extraArgs], {
      env: { ...process.env, WB_WORKSPACE: tmp, WORKBENCH_REMOTE_URL: '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(JSON.stringify(content));
    child.stdin.end();
  });
}

function runRemoteCli(args, input = null, envExtra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN, ...args], {
      env: {
        ...process.env,
        WB_WORKSPACE: clientTmp,
        WORKBENCH_REMOTE_URL: `http://127.0.0.1:${remotePort}`,
        WORKBENCH_TOKEN: remoteToken,
        ...envExtra,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input != null) child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

before(async () => {
  for (const key of ['WORKBENCH_REMOTE_URL', 'WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-present-'));
  clientTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-remote-client-'));
  process.env.WB_WORKSPACE = tmp;
  ws = await import('../../src/workspace.mjs');
  bin = await import('../../bin/workbench.mjs');
  const srv = await import('../../src/server/server.mjs');
  server = srv.startServer(0);
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  port = server.address().port;

  process.env.WORKBENCH_TOKEN = remoteToken;
  remoteServer = srv.startServer(0, '127.0.0.1', {
    participantsFile: path.join(tmp, 'config', 'participants.json'),
  });
  await new Promise((r) => remoteServer.once('listening', r));
  remotePort = remoteServer.address().port;
  delete process.env.WORKBENCH_TOKEN;
});

after(async () => {
  try { await new Promise((resolve) => server.close(resolve)); } catch {}
  try { await new Promise((resolve) => remoteServer.close(resolve)); } catch {}
  delete process.env.WB_WORKSPACE;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(clientTmp, { recursive: true, force: true }); } catch {}
  for (const key of ['WORKBENCH_REMOTE_URL', 'WORKBENCH_TOKEN', 'WORKBENCH_EVENT_WEBHOOK']) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
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

test('cmdPresent: WORKBENCH_TOKEN 自动用于健康检查并附加到页面 URL', async () => {
  const previous = process.env.WORKBENCH_TOKEN;
  const token = 'present /? & 中文令牌';
  process.env.WORKBENCH_TOKEN = token;
  const srv = await import('../../src/server/server.mjs');
  const authServer = srv.startServer(0);
  await new Promise((resolve) => authServer.once('listening', resolve));
  const authPort = authServer.address().port;
  try {
    const result = await bin.cmdPresent(
      'p-token',
      { session: 'p-token', round: 1, blocks: [{ id: 'b1', type: 'markdown', body: 'token' }] },
      { port: authPort },
    );
    assert.equal(result.server, 'already', '带 token 的健康检查应识别已运行 server');
    assert.equal(new URL(result.url).searchParams.get('token'), token);
    assert.equal(new URL(result.urlPinned).searchParams.get('token'), token);
  } finally {
    await new Promise((resolve) => authServer.close(resolve));
    if (previous == null) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = previous;
  }
});

test('浏览器端从 location.search 读取 token，所有同源 API fetch 均经 token URL helper', () => {
  const source = fs.readFileSync(APP, 'utf8');
  assert.match(source, /params\.get\(['"]token['"]\)/);
  assert.match(source, /searchParams\.set\(['"]token['"]/);
  const rawApiFetches = [...source.matchAll(/fetch\(\s*([`'"])\/api\//g)];
  assert.equal(rawApiFetches.length, 0, '不得直接 fetch 裸 /api/* URL');
  assert.match(
    source,
    /querySelectorAll\([^\n]*iframe\[src\^=[^\n]*\/api\//,
    'renderZones 生成的 embed/prototype iframe 也必须补 token',
  );
  assert.match(
    source,
    /querySelectorAll\([^\n]*\[src\^=[^\n]*\/assets\//,
    '渲染结果中的 iframe/img 等 /assets/ 资源也必须补 token',
  );
});

test('present: needsDecision choice 缺 background 时拒绝渲染并列出块 id', async () => {
  const block = completeChoice('decision-missing-background');
  delete block.background;

  const result = await runPresentCli('p-incomplete', { blocks: [block] });

  assert.notEqual(result.code, 0);
  assert.ok(result.stderr.includes('decision-missing-background'), result.stderr);
  assert.ok(result.stderr.includes('background（背景）'), result.stderr);
  assert.equal(ws.exists(ws.paths.content('p-incomplete', 1)), false);
});

test('present: --allow-incomplete-decisions 放行并返回 lintBypassed:true', async () => {
  const block = completeChoice('decision-bypassed');
  delete block.background;

  const result = await runPresentCli(
    'p-bypassed',
    { blocks: [block] },
    ['--allow-incomplete-decisions'],
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).lintBypassed, true);
  assert.ok(result.stderr.includes('missing-background'), result.stderr);
  assert.equal(ws.exists(ws.paths.content('p-bypassed', 1)), true);
});

test('cmdPresent: 四段齐全的 needsDecision choice 正常通过', async () => {
  const result = await bin.cmdPresent('p-complete', { blocks: [completeChoice('decision-complete')] }, { port });

  assert.equal(result.ok, true);
  assert.equal(result.lintBypassed, undefined);
  assert.equal(ws.exists(ws.paths.content('p-complete', 1)), true);
});

test('cmdPresent: needsDecision:false 的简陋块不受完整性校验影响', async () => {
  const block = {
    id: 'informational-choice',
    type: 'choice',
    needsDecision: false,
    hasRecommendation: true,
    recommendation: 'a',
    options: [{ id: 'a', label: '仅供参考' }],
  };

  const result = await bin.cmdPresent('p-informational', { blocks: [block] }, { port });

  assert.equal(result.ok, true);
  assert.equal(result.lintBypassed, undefined);
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

test('CLI 远程 present：只写云端 workspace，返回带 token 的远程 URL', async () => {
  const session = 'remote-cli-present';
  const result = await runRemoteCli(
    ['present', session, '-', '--port', String(port)],
    { round: 99, title: '来自本地 CLI', blocks: [{ id: 'remote', type: 'markdown', body: '写到云端' }] },
  );

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual({ ok: output.ok, session: output.session, round: output.round }, { ok: true, session, round: 1 });
  assert.equal(output.server, 'remote');
  assert.equal(new URL(output.url).origin, `http://127.0.0.1:${remotePort}`);
  assert.equal(new URL(output.url).searchParams.get('token'), remoteToken);
  assert.equal(new URL(output.url).searchParams.has('round'), false);
  assert.equal(new URL(output.urlPinned).searchParams.get('round'), '1');
  assert.equal(ws.readJSON(ws.paths.content(session, 1)).title, '来自本地 CLI');
  assert.equal(ws.readJSON(ws.paths.content(session, 1)).round, 1, 'CLI 应采用服务端响应轮号，忽略输入 round');
  assert.equal(fs.existsSync(path.join(clientTmp, session, 'round-1', 'content.json')), false);
});

test('CLI 远程 participant add/list/revoke：走管理 API 且列表脱敏', async () => {
  const result = await runRemoteCli(['participant', 'add', 'remote-alice', '远程小艾']);
  assert.equal(result.code, 0, result.stderr);
  const added = JSON.parse(result.stdout);
  assert.equal(added.participant.id, 'remote-alice');
  assert.equal(Object.hasOwn(added.participant, 'token'), false);
  const invite = new URL(added.url);
  assert.equal(invite.origin, `http://127.0.0.1:${remotePort}`);
  assert.match(invite.searchParams.get('token'), /^[a-f0-9]{32}$/);

  const listedResult = await runRemoteCli(['participant', 'list']);
  assert.equal(listedResult.code, 0, listedResult.stderr);
  const listed = JSON.parse(listedResult.stdout);
  assert.equal(listed.participants.some(({ id }) => id === 'remote-alice'), true);
  assert.equal(JSON.stringify(listed).includes(invite.searchParams.get('token')), false);

  const revoked = await runRemoteCli(['participant', 'revoke', 'remote-alice']);
  assert.equal(revoked.code, 0, revoked.stderr);
  assert.deepEqual(JSON.parse(revoked.stdout), { ok: true, id: 'remote-alice' });
});

test('渲染页头部提供会话列表和设计资产入口，前端消费 sessions/meta.docsUrl', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../src/render/index.html'), 'utf8');
  const source = fs.readFileSync(APP, 'utf8');
  assert.match(html, /id=["']session-nav["']/);
  assert.match(html, /会话列表/);
  assert.match(html, /id=["']docs-link["']/);
  assert.match(source, /\/api\/sessions/);
  assert.match(source, /meta\?\.docsUrl|meta\.docsUrl/);
  assert.match(source, /docs-link/);
});

test('CLI 远程 present：--allow-incomplete-decisions 映射 query 并返回 lintBypassed', async () => {
  const session = 'remote-cli-bypass';
  const block = completeChoice('remote-bypassed-choice');
  delete block.background;
  const result = await runRemoteCli(
    ['present', session, '-', '--port', String(port), '--allow-incomplete-decisions'],
    { blocks: [block] },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).lintBypassed, true);
  assert.equal(ws.exists(ws.paths.content(session, 1)), true);
  assert.equal(fs.existsSync(path.join(clientTmp, session, 'round-1', 'content.json')), false);
});

test('CLI 远程 wait：通过 GET /api/feedback 命中云端反馈', async () => {
  const session = 'remote-cli-wait';
  const feedback = { session, round: 1, items: [{ blockId: 'remote', type: 'verdict', value: '赞成' }] };
  ws.writeJSON(ws.paths.feedback(session, 1), feedback);

  const result = await runRemoteCli(['wait', session, '1', '--timeout', '1']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, event: 'feedback', session, round: 1, feedback });
});

test('cmdWait 远程 pending 后按默认 3000ms 间隔再次轮询并命中', async () => {
  const session = 'remote-wait-pending-then-hit';
  const feedback = { session, round: 1, items: [{ blockId: 'remote', type: 'verdict', value: '继续' }] };
  const previousRemote = process.env.WORKBENCH_REMOTE_URL;
  const previousToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_REMOTE_URL = `http://127.0.0.1:${remotePort}`;
  process.env.WORKBENCH_TOKEN = remoteToken;
  const intervals = [];
  try {
    const result = await bin.cmdWait(session, 1, {
      timeoutMs: 10000,
      sleepFn: async (ms) => {
        intervals.push(ms);
        ws.writeJSON(ws.paths.feedback(session, 1), feedback);
      },
    });
    assert.deepEqual(intervals, [3000]);
    assert.deepEqual(result.feedback, feedback);
  } finally {
    if (previousRemote == null) delete process.env.WORKBENCH_REMOTE_URL;
    else process.env.WORKBENCH_REMOTE_URL = previousRemote;
    if (previousToken == null) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = previousToken;
  }
});

test('cmdWait 远程请求卡住时仍遵守总 timeout 并输出 timeout 事件', async () => {
  const hangingServer = http.createServer(() => {});
  hangingServer.listen(0, '127.0.0.1');
  await new Promise((resolve) => hangingServer.once('listening', resolve));
  const previousRemote = process.env.WORKBENCH_REMOTE_URL;
  const previousToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_REMOTE_URL = `http://127.0.0.1:${hangingServer.address().port}`;
  delete process.env.WORKBENCH_TOKEN;
  try {
    const startedAt = Date.now();
    const result = await bin.cmdWait('remote-hanging-wait', 1, { timeoutMs: 40 });
    assert.deepEqual(result, { ok: false, event: 'timeout', session: 'remote-hanging-wait', round: 1 });
    assert.ok(Date.now() - startedAt < 500, '远程 wait 不得被无响应连接无限卡住');
  } finally {
    if (previousRemote == null) delete process.env.WORKBENCH_REMOTE_URL;
    else process.env.WORKBENCH_REMOTE_URL = previousRemote;
    if (previousToken == null) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = previousToken;
    await new Promise((resolve) => hangingServer.close(resolve));
  }
});

test('CLI 远程网络错误输出中文可读报错且不回退本地写入', async () => {
  const session = 'remote-cli-network-error';
  const result = await runRemoteCli(
    ['present', session, '-', '--port', String(port)],
    { blocks: [{ id: 'remote', type: 'markdown', body: '不可本地兜底' }] },
    { WORKBENCH_REMOTE_URL: 'http://127.0.0.1:1' },
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /远程工作台请求失败/);
  assert.equal(fs.existsSync(path.join(clientTmp, session, 'round-1', 'content.json')), false);
  assert.equal(ws.exists(ws.paths.content(session, 1)), false);
});

test('CLI 远程返回 null JSON 时输出中文格式错误', async () => {
  const invalidServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('null');
  });
  invalidServer.listen(0, '127.0.0.1');
  await new Promise((resolve) => invalidServer.once('listening', resolve));
  try {
    const result = await runRemoteCli(
      ['present', 'remote-invalid-json-shape', '-', '--port', String(port)],
      { blocks: [{ id: 'remote', type: 'markdown', body: '格式校验' }] },
      { WORKBENCH_REMOTE_URL: `http://127.0.0.1:${invalidServer.address().port}` },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /远程工作台返回格式无效/);
    assert.doesNotMatch(result.stderr, /TypeError/);
  } finally {
    await new Promise((resolve) => invalidServer.close(resolve));
  }
});

test('CLI 远程 API 不跟随跨源重定向泄露 x-workbench-token', async () => {
  let leakedToken = null;
  const targetServer = http.createServer((req, res) => {
    leakedToken = req.headers['x-workbench-token'] || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, session: 'redirect-token', round: 1 }));
  });
  targetServer.listen(0, '127.0.0.1');
  await new Promise((resolve) => targetServer.once('listening', resolve));

  const redirectServer = http.createServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${targetServer.address().port}/stolen` });
    res.end();
  });
  redirectServer.listen(0, '127.0.0.1');
  await new Promise((resolve) => redirectServer.once('listening', resolve));

  try {
    const result = await runRemoteCli(
      ['present', 'redirect-token', '-', '--port', String(port)],
      { blocks: [{ id: 'remote', type: 'markdown', body: '禁止泄露口令' }] },
      { WORKBENCH_REMOTE_URL: `http://127.0.0.1:${redirectServer.address().port}` },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /远程工作台返回 302/);
    assert.equal(leakedToken, null);
  } finally {
    await new Promise((resolve) => redirectServer.close(resolve));
    await new Promise((resolve) => targetServer.close(resolve));
  }
});
