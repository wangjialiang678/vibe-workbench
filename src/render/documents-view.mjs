// 云端文档库与历史轮次的纯渲染函数，保持无 DOM 依赖，便于 Node 单测。
import { mdToHtml } from './md.mjs';

export const DOCUMENT_CATEGORIES = Object.freeze([
  '需求',
  'PRD',
  '架构',
  'UI 设计',
  '交互设计',
  '测试',
  '其他',
]);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updatedAtLabel(value) {
  const text = String(value ?? '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : text;
}

function secondaryResourcesHtml(docsUrl, assets) {
  const designLink = docsUrl
    ? `<a class="document-resource-link" href="${escapeHtml(docsUrl)}" target="_blank" rel="noopener noreferrer">打开设计资产 <span aria-hidden="true">↗</span></a>`
    : '<span class="document-resource-empty">暂无设计资产外链</span>';
  const assetItems = assets.length
    ? assets.map((asset) => `<li><a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(asset.label || asset.url)}</a></li>`).join('')
    : '<li class="document-empty">尚未上传会话资产。</li>';

  return `<aside class="document-secondary-resources" aria-label="相关资源">
  ${designLink}
  <details class="document-assets-disclosure">
    <summary>会话资产 <span>${assets.length}</span></summary>
    <ul class="document-list document-assets">${assetItems}</ul>
  </details>
</aside>`;
}

function documentListHtml(documents) {
  const groups = DOCUMENT_CATEGORIES.map((category) => ({
    category,
    documents: documents
      .filter((document) => document?.category === category)
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))),
  })).filter((group) => group.documents.length > 0);

  if (!groups.length) {
    return `<section class="document-library document-library--empty">
  <p class="document-eyebrow">CLOUD LIBRARY</p>
  <h1>云端文档库</h1>
  <p class="document-empty">还没有发布文档。管理员可用 <code>workbench doc-publish</code> 发布最新版本。</p>
</section>`;
  }

  const groupHtml = groups.map(({ category, documents: items }) => `<section class="document-category" data-document-category="${escapeHtml(category)}">
  <div class="document-category-head"><h2>${escapeHtml(category)}</h2><span>${items.length}</span></div>
  <ul class="document-library-list">${items.map((document) => `<li>
    <button class="document-open" type="button" data-document-slug="${escapeHtml(document.slug)}" data-document-category="${escapeHtml(category)}">
      <span class="document-open-title">${escapeHtml(document.title || document.slug)}</span>
      <span class="document-open-meta">${escapeHtml(updatedAtLabel(document.updatedAt))}</span>
    </button>
  </li>`).join('')}</ul>
</section>`).join('');

  return `<section class="document-library">
  <header class="document-library-head">
    <div><p class="document-eyebrow">CLOUD LIBRARY</p><h1>云端文档库</h1></div>
    <span>${documents.length} 篇最新文档</span>
  </header>
  <div class="document-category-grid">${groupHtml}</div>
</section>`;
}

/** 文档区列表或单篇正文。单篇由同一面板渲染，返回时不跳页面。 */
export function documentsPanelHtml({
  docsUrl = '',
  assets = [],
  documents = [],
  selectedDocument = null,
} = {}) {
  if (selectedDocument) {
    return `<article class="document-reader" data-document-reader="${escapeHtml(selectedDocument.slug)}">
  <button class="document-back" type="button" data-document-back>← 返回文档库</button>
  <header class="document-reader-head">
    <p class="document-eyebrow">${escapeHtml(selectedDocument.category || '其他')}</p>
    <h1>${escapeHtml(selectedDocument.title || selectedDocument.slug || '未命名文档')}</h1>
    <time datetime="${escapeHtml(selectedDocument.updatedAt)}">更新于 ${escapeHtml(updatedAtLabel(selectedDocument.updatedAt))}</time>
  </header>
  <div class="document-body">${mdToHtml(String(selectedDocument.body ?? ''))}</div>
</article>`;
  }

  const safeAssets = Array.isArray(assets) ? assets : [];
  const safeDocuments = Array.isArray(documents) ? documents : [];
  return `<div class="documents-grid">
  ${secondaryResourcesHtml(docsUrl, safeAssets)}
  ${documentListHtml(safeDocuments)}
</div>`;
}

/** 决策区底部的历史轮次归档；不再属于文档库。 */
export function historyRoundsHtml(rounds = []) {
  const safeRounds = Array.isArray(rounds) ? rounds : [];
  const items = safeRounds.length
    ? safeRounds.slice().sort((a, b) => Number(b.round) - Number(a.round)).map((round) => `<li>
      <a href="${escapeHtml(round.url)}" data-history-round="${escapeHtml(round.round)}">
        <strong>第 ${escapeHtml(round.round)} 轮</strong><span>${escapeHtml(round.title || '未命名轮次')}</span>
      </a>
    </li>`).join('')
    : '<li class="document-empty">暂无历史轮次。</li>';

  return `<div class="document-card-head"><h2>历史轮次</h2><span>${safeRounds.length}</span></div>
  <ul class="document-list document-rounds">${items}</ul>`;
}
