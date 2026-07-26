// 控制塔的纯数据与可读文案契约。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  controlProjectCardHtml,
  filterAndPaginateTimeline,
  humanTimelineSentence,
  normalizeControlTowerEvent,
  statusLabel,
} from '../../src/control-tower.mjs';
import { normalizeProjectRegistry } from '../../src/projects.mjs';

test('项目注册表保存控制塔层级、状态地址和口令环境变量名称，但不保存口令值', () => {
  const registry = normalizeProjectRegistry({
    version: 1,
    projects: [{
      id: 'ai-video', displayName: 'AI 视频剪辑',
      controlTower: {
        level: 2,
        statusUrl: 'https://loop.example.test/api/status',
        tokenEnv: 'VIBELOOP_ADMIN_TOKEN_VIDEO',
        links: { tickets: 'https://loop.example.test/tickets' },
      },
    }],
  });
  assert.deepEqual(registry.projects[0].controlTower, {
    level: 2,
    statusUrl: 'https://loop.example.test/api/status',
    tokenEnv: 'VIBELOOP_ADMIN_TOKEN_VIDEO',
    links: { tickets: 'https://loop.example.test/tickets' },
  });
});

test('状态词以人话显示，并保留必要的技术含义', () => {
  assert.equal(statusLabel('pending'), '待处理');
  assert.equal(statusLabel('claimed'), '已认领');
  assert.equal(statusLabel('awaiting_human'), '等你拍板');
  assert.equal(statusLabel('fix_failed'), '修复失败');
  assert.equal(statusLabel('merged'), '已合入主线');
  assert.equal(statusLabel('unknown'), '未知');
});

test('时间线条目保留审计五要素，并生成可以直接读懂的句子', () => {
  const event = normalizeControlTowerEvent({
    id: 'ticket-fixed',
    at: '2026-07-26T04:03:00.000Z',
    actor: { id: 'cloud-codex', name: '云端 Codex', kind: 'ai' },
    location: { projectId: 'ai-video', projectName: 'AI 视频剪辑', ticketId: 't-export' },
    action: { type: 'ticket.fixed', label: '修好了工单 t-export（导出失败）' },
    result: { status: 'merged', summary: '已排队等合入主线', url: 'https://example.test/pr/7' },
    raw: { event: 'ticket.fixed', ticket: 't-export' },
  });

  assert.deepEqual(Object.keys(event).filter((key) => ['at', 'actor', 'location', 'action', 'result'].includes(key)), [
    'at', 'actor', 'location', 'action', 'result',
  ]);
  assert.match(humanTimelineSentence(event), /云端 Codex 在 AI 视频剪辑 修好了工单 t-export（导出失败），已排队等合入主线/);
});

test('时间线可按项目、执行者、类型、时间窗筛选并分页', () => {
  const entries = [
    normalizeControlTowerEvent({
      id: 'newer', at: '2026-07-26T05:00:00.000Z',
      actor: { id: 'cloud-codex', name: '云端 Codex', kind: 'ai' },
      location: { projectId: 'ai-video', projectName: 'AI 视频剪辑' },
      action: { type: 'ticket.fixed', label: '修好了导出' },
      result: { status: 'merged', summary: '已合入主线' }, raw: { id: 'newer' },
    }),
    normalizeControlTowerEvent({
      id: 'older', at: '2026-07-25T05:00:00.000Z',
      actor: { id: 'local-mac', name: '创始人 Mac', kind: 'worker' },
      location: { projectId: 'paper-edit', projectName: 'Paper Edit' },
      action: { type: 'inbox.claimed', label: '认领了待处理任务' },
      result: { status: 'claimed', summary: '正在处理' }, raw: { id: 'older' },
    }),
  ];

  const filtered = filterAndPaginateTimeline(entries, {
    project: 'ai-video', executor: 'cloud-codex', type: 'ticket.fixed', window: '24h',
    now: '2026-07-26T06:00:00.000Z', page: 1, pageSize: 1,
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, 'newer');

  const paged = filterAndPaginateTimeline(entries, { window: 'all', page: 2, pageSize: 1 });
  assert.equal(paged.total, 2);
  assert.equal(paged.items[0].id, 'older');
});

test('L0 项目卡不显示工单区，未取到 loop 状态会明确显示', () => {
  const l0 = controlProjectCardHtml({
    id: 'idea', displayName: '新想法', level: 0, loop: { availability: 'not-applicable' },
    executor: { label: '云端常驻 Codex（干活的机器）' }, links: {},
  });
  assert.doesNotMatch(l0, /control-project-work-items/);

  const unavailable = controlProjectCardHtml({
    id: 'video', displayName: 'AI 视频剪辑', level: 2,
    loop: { availability: 'unavailable', message: '取不到' },
    executor: { label: '云端常驻 Codex（干活的机器）' }, links: {},
  });
  assert.match(unavailable, /取不到/);
  assert.match(unavailable, /工单/);
});

test('项目卡转义注册表文本，并拒绝不安全入口链接', () => {
  const html = controlProjectCardHtml({
    id: 'safe', displayName: '<img src=x onerror=alert(1)>', level: 0,
    loop: { availability: 'not-applicable' }, executor: { label: '本地 Mac（干活的机器）' },
    links: { session: 'javascript:alert(1)' },
  });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /javascript:/);
});
