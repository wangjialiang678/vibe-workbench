import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentsPanelHtml } from '../../src/render/stream-view.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderIndex = readFileSync(path.resolve(__dirname, '../../src/render/index.html'), 'utf8');

test('文档区按类目分组，只显示有文档的类目', () => {
  const html = documentsPanelHtml({
    documents: [
      { category: 'PRD', slug: 'checkout-v2', title: '结算页 PRD', updatedAt: '2026-07-23T08:00:00.000Z' },
      { category: '需求', slug: 'checkout', title: '结算页需求', updatedAt: '2026-07-23T07:00:00.000Z' },
      { category: 'PRD', slug: 'account', title: '账户 PRD', updatedAt: '2026-07-23T09:00:00.000Z' },
    ],
  });

  assert.match(html, /云端文档库/);
  assert.match(html, /data-document-category="需求"/);
  assert.match(html, /data-document-category="PRD"/);
  assert.match(html, /data-document-slug="checkout-v2"/);
  assert.doesNotMatch(html, /data-document-category="架构"/);
  assert.ok(html.indexOf('data-document-category="需求"') < html.indexOf('data-document-category="PRD"'));
});

test('文档区顶部保留设计外链与会话资产，并使用次要资源样式', () => {
  const html = documentsPanelHtml({
    docsUrl: 'https://example.com/design',
    assets: [{ label: 'uploads/shot.png', url: '/assets/demo/uploads/shot.png' }],
    documents: [{ category: 'UI 设计', slug: 'home', title: '首页设计', updatedAt: '2026-07-23T08:00:00.000Z' }],
  });

  assert.match(html, /document-secondary-resources/);
  assert.match(html, /打开设计资产/);
  assert.match(html, /uploads\/shot\.png/);
  assert.match(html, /document-library/);
});

test('单篇文档用 mdToHtml 渲染正文与图片，并提供返回列表入口', () => {
  const html = documentsPanelHtml({
    selectedDocument: {
      category: 'UI 设计',
      slug: 'home',
      title: '首页设计',
      updatedAt: '2026-07-23T08:00:00.000Z',
      body: '# 首页\n\n![首页截图](/assets/demo/uploads/home.png)',
    },
  });

  assert.match(html, /data-document-back/);
  assert.match(html, /<h1>首页<\/h1>/);
  assert.match(html, /class="md-image"/);
  assert.match(html, /src="\/assets\/demo\/uploads\/home\.png"/);
});

test('单篇文档把 Markdown 表格渲染为可横向滚动的语义化 HTML 表格', () => {
  const html = documentsPanelHtml({
    selectedDocument: {
      category: '需求',
      slug: 'platform',
      title: '平台需求',
      body: '| 层 | 项目 |\n| --- | --- |\n| L1 | 工作台 |',
    },
  });

  assert.match(html, /<div class="document-body">/);
  assert.match(html, /class="md-table-scroll"/);
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th>层<\/th><th>项目<\/th>/);
  assert.match(html, /<td>L1<\/td><td>工作台<\/td>/);
});

test('历史轮次从文档区移到决策区底部折叠区', () => {
  const decisionStart = renderIndex.indexOf('id="decision-panel"');
  const decisionEnd = renderIndex.indexOf('id="documents-panel"');
  const decisionHtml = renderIndex.slice(decisionStart, decisionEnd);
  const documentsHtml = renderIndex.slice(decisionEnd);

  assert.match(decisionHtml, /id="history-rounds-mount"/);
  assert.match(decisionHtml, /<details[^>]*class="[^"]*history-rounds/);
  assert.doesNotMatch(documentsHtml, /history-rounds-mount|document-rounds/);
});
