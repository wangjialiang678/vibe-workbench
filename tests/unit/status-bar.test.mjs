import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusBadgeHtml } from '../../src/render/status-bar.mjs';

const SDK_NOTICE = '（本次由 SDK 托底执行，走 API 计费）';

test('statusBadgeHtml 读取 API 响应的嵌套 status 并展示 SDK 托底标注', () => {
  const html = statusBadgeHtml({
    ok: true,
    status: { state: 'responded', driverSource: 'sdk-fallback' },
    display: 'responded',
  }, Date.parse('2026-07-23T00:00:00.000Z'));

  assert.ok(html.includes('data-state="responded"'));
  assert.ok(html.includes(SDK_NOTICE));
});

test('statusBadgeHtml 在 subscription 来源下不显示 SDK 托底标注', () => {
  const html = statusBadgeHtml({
    ok: true,
    status: { state: 'responded', driverSource: 'subscription' },
  });

  assert.ok(html.includes('data-state="responded"'));
  assert.equal(html.includes(SDK_NOTICE), false);
});

test('statusBadgeHtml 从嵌套 status 计算 processing 经过时间', () => {
  const now = Date.parse('2026-07-23T00:00:10.000Z');
  const html = statusBadgeHtml({
    ok: true,
    status: {
      state: 'claimed',
      claimedAt: '2026-07-23T00:00:05.000Z',
      heartbeatAt: '2026-07-23T00:00:10.000Z',
    },
  }, now);

  assert.ok(html.includes('data-state="processing"'));
  assert.ok(html.includes('已 5s'));
});

test('statusBadgeHtml 从嵌套 status.error 显示详情和可重试按钮', () => {
  const html = statusBadgeHtml({
    ok: true,
    status: {
      state: 'error',
      error: {
        kind: 'timeout',
        message: 'claude process timed out',
        userMessage: 'AI 处理超时，请稍后重试。',
        suggestedAction: '点击「重试」重新处理本轮。',
      },
    },
  });

  assert.ok(html.includes('AI 处理超时，请稍后重试。'));
  assert.ok(html.includes('点击「重试」重新处理本轮。'));
  assert.ok(html.includes('data-action="retry"'));
});

test('statusBadgeHtml 将 API 的 status:null 视为 unknown', () => {
  const html = statusBadgeHtml({ ok: true, status: null, display: 'unknown' });

  assert.ok(html.includes('data-state="unknown"'));
});
