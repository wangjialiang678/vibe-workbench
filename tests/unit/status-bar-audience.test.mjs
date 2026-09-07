import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusBadgeHtml } from '../../src/render/status-bar.mjs';
import { status as statusRoute } from '../../src/server/routes/session.mjs';

const NOW = Date.parse('2026-09-07T06:58:10.000Z');

const internalCases = [
  {
    name: 'online',
    response: { ok: true, audience: 'internal', workerOnline: true, status: { state: 'submitted' } },
    expected: `<div class="status-badge status-worker-online" data-state="worker-online">
  <span class="status-icon" aria-hidden="true"></span>
  <span class="status-text">● 云端 AI 在线（消息与提交自动处理）</span>
  
  
  
</div>`,
  },
  {
    name: 'submitted',
    response: { ok: true, audience: 'internal', status: { state: 'submitted', heartbeatAt: '2026-09-07T06:58:10.000Z' } },
    expected: `<div class="status-badge status-submitted" data-state="submitted">
  <span class="status-icon" aria-hidden="true">🟢</span>
  <span class="status-text">已提交·待处理</span>
  
  
  
</div>`,
  },
  {
    name: 'offline',
    response: { ok: true, audience: 'internal', status: { state: 'submitted', heartbeatAt: '2026-09-07T05:00:00.000Z' } },
    expected: `<div class="status-badge status-offline" data-state="offline">
  <span class="status-icon" aria-hidden="true">🔴</span>
  <span class="status-text">AI 离线（提交已保存，恢复后自动处理）</span>
  
  <button class="retry-btn" data-action="retry">重试</button>
  
</div>`,
  },
  {
    name: 'processing',
    response: { ok: true, audience: 'internal', status: { state: 'claimed', claimedAt: '2026-09-07T06:58:05.000Z', heartbeatAt: '2026-09-07T06:58:10.000Z' } },
    expected: `<div class="status-badge status-processing" data-state="processing">
  <span class="status-icon" aria-hidden="true">🟡</span>
  <span class="status-text">AI 处理中（已 5s）·可关闭页面，回复后会变蓝</span>
  
  <button class="retry-btn retry-force" data-action="force-retry"
      onclick="if(confirm('强制重试可能导致重复处理，确认？'))this.closest('[data-session]')?.dispatchEvent(new CustomEvent('retry',{detail:{force:true},bubbles:true}))">强制重试</button>
  
</div>`,
  },
  {
    name: 'error',
    response: { ok: true, audience: 'internal', status: { state: 'error', error: { kind: 'timeout', message: 'worker failed', userMessage: '处理超时', suggestedAction: '请重试' } } },
    expected: `<div class="status-badge status-error" data-state="error">
  <span class="status-icon" aria-hidden="true">⚠️</span>
  <span class="status-text">出错</span>
  
  <button class="retry-btn" data-action="retry">重试</button>
  <div class="error-detail"><p class="error-msg">处理超时</p><p class="error-action">请重试</p><details class="error-raw"><summary>技术详情</summary><pre>worker failed</pre></details></div>
</div>`,
  },
];

test('internal（含缺省）状态栏输出保持旧版逐字节一致', () => {
  for (const { name, response, expected } of internalCases) {
    assert.equal(statusBadgeHtml(response, NOW), expected, name);
    const { audience, ...withoutAudience } = response;
    assert.equal(statusBadgeHtml(withoutAudience, NOW), expected, `${name} 缺省`);
  }
});

test('external 状态栏以中性文案呈现五种状态且不泄漏内部详情', () => {
  const cases = [
    [{ workerOnline: true, status: { state: 'submitted' } }, '已连接，提交会即时送达项目组'],
    [{ status: { state: 'submitted', heartbeatAt: '2026-09-07T06:58:10.000Z' } }, '提交已收到，项目组会在工作时间内处理'],
    [{ status: { state: 'submitted', heartbeatAt: '2026-09-07T05:00:00.000Z' } }, '提交已收到，项目组会在工作时间内处理'],
    [{ status: { state: 'claimed', heartbeatAt: '2026-09-07T06:58:10.000Z' } }, '提交已收到，正在处理'],
    [{ status: { state: 'error', driverSource: 'sdk-fallback', error: { kind: 'timeout', message: 'worker failed', userMessage: '云端 AI 超时', suggestedAction: '重试' } } }, '提交已安全保存，项目组已收到通知'],
  ];

  for (const [state, message] of cases) {
    const html = statusBadgeHtml({ ok: true, audience: 'external', ...state }, NOW);
    assert.ok(html.includes('✓'));
    assert.ok(html.includes(message));
    for (const forbidden of ['离线', '云端 AI', '重试', '技术详情', 'SDK 托底']) assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test('GET /api/status 返回 audience，缺省 internal、external 显式透传', () => {
  const previous = process.env.WB_AUDIENCE;
  const responses = [];
  const ctx = {
    urlPath: '/api/status',
    method: 'GET',
    rawUrl: '/api/status',
    runtimeState: { workerHeartbeat: null },
    parseQuery: () => ({}),
    json: (_res, _code, body) => responses.push(body),
  };

  try {
    delete process.env.WB_AUDIENCE;
    assert.equal(statusRoute(ctx), undefined);
    process.env.WB_AUDIENCE = 'external';
    assert.equal(statusRoute(ctx), undefined);
  } finally {
    if (previous === undefined) delete process.env.WB_AUDIENCE;
    else process.env.WB_AUDIENCE = previous;
  }

  assert.deepEqual(responses.map(({ audience }) => audience), ['internal', 'external']);
});
