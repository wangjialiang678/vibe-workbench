// present / wait 一键命令（供 workbench skill 调用）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let tmp, ws, bin, server, port;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/workbench.mjs');

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
      env: { ...process.env, WB_WORKSPACE: tmp },
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
