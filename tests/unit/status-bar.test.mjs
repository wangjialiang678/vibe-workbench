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

test('statusBadgeHtml 在云端 worker 在线时优先显示绿色在线横幅并保留 SDK 标注', () => {
  const html = statusBadgeHtml({
    ok: true,
    workerOnline: true,
    workerLabel: '云端 Codex · sol xhigh',
    status: {
      state: 'claimed',
      heartbeatAt: '2026-07-23T00:00:00.000Z',
      driverSource: 'sdk-fallback',
    },
  }, Date.parse('2026-07-23T01:00:00.000Z'));

  assert.ok(html.includes('data-state="worker-online"'));
  assert.ok(html.includes('status-worker-online'));
  assert.ok(html.includes('● 云端 AI 在线（消息与提交自动处理）'));
  assert.ok(html.includes(SDK_NOTICE));
  assert.equal(html.includes('AI 离线'), false);
});

test('statusBadgeHtml 在云端 worker 离线时维持旧本地心跳判定和离线文案', () => {
  const html = statusBadgeHtml({
    ok: true,
    workerOnline: false,
    workerLabel: '云端 Codex · sol xhigh',
    status: {
      state: 'claimed',
      heartbeatAt: '2026-07-23T00:00:00.000Z',
    },
  }, Date.parse('2026-07-23T01:00:00.000Z'));

  assert.ok(html.includes('data-state="offline"'));
  assert.ok(html.includes('AI 离线（提交已保存，恢复后自动处理）'));
});
