// 会话流与文档区的纯渲染函数。仅使用浏览器通用能力，便于 Node 单测。
import { mdToHtml } from './md.mjs';
export { documentsPanelHtml } from './documents-view.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeMarkdownLabel(value) {
  return String(value || '附件').replace(/[[\]\\]/g, '\\$&');
}

function safeAssetUrl(value) {
  const raw = String(value ?? '');
  return /^(?:\/assets\/|https?:\/\/)/.test(raw) ? raw : '#';
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 生成单条会话流 HTML；viewerId 用于区分自己的消息。 */
export function streamEntryHtml(entry, { viewerId = '' } = {}) {
  if (!entry || typeof entry !== 'object') return '';
  const id = escapeHtml(entry.id);
  const kind = entry.kind;
  const author = entry.author || {};
  const text = mdToHtml(String(entry.text ?? ''));
  const at = timeLabel(entry.at);

  if (kind === 'receipt') {
    const round = Number(entry.refs?.round);
    const roundAttr = Number.isInteger(round) && round > 0 ? ` data-round="${round}"` : '';
    return `<article class="stream-entry stream-entry--system stream-entry--receipt" data-entry-id="${id}"${roundAttr}>
  <button class="stream-system-pill" type="button"${roundAttr}>${escapeHtml(entry.text)}</button>
</article>`;
  }

  if (kind === 'progress') {
    return `<article class="stream-entry stream-entry--system stream-entry--progress" data-entry-id="${id}">
  <div class="stream-progress-text">${text}</div>
</article>`;
  }

  if (kind !== 'message') return '';

  const isSelf = Boolean(viewerId) && String(author.id) === String(viewerId);
  const isAi = author.role === 'ai';
  const side = isSelf ? 'right' : 'left';
  const name = !isSelf && !isAi
    ? `<div class="stream-author">${escapeHtml(author.name || author.id || '参与者')}</div>`
    : '';
  const meta = at ? `<time class="stream-time">${escapeHtml(at)}</time>` : '';
  return `<article class="stream-entry stream-entry--message stream-entry--${side}${isSelf ? ' stream-entry--self' : ''}${isAi ? ' stream-entry--ai' : ''}" data-entry-id="${id}">
  <div class="stream-message-wrap">${name}<div class="stream-bubble">${text}</div>${meta}</div>
</article>`;
}

/** 最新轮 receipt 下方的小型决策入口；其他情况不生成。 */
export function decisionChipHtml(entry, { latestRound, pendingCount } = {}) {
  const round = Number(entry?.refs?.round);
  if (entry?.kind !== 'receipt'
    || !Number.isInteger(round)
    || round !== Number(latestRound)
    || !Number.isInteger(pendingCount)
    || pendingCount < 1) return '';
  return `<button class="stream-decision-chip" type="button" data-open-decision data-round="${round}">
  <span>第 ${round} 轮有 ${pendingCount} 个决策待你确认</span><span aria-hidden="true">→</span>
</button>`;
}

/** 从完整流里选择最新轮的最后一条 receipt，确保同轮始终只有一个决策芯片。 */
export function decisionChipForLatestReceipt(entries = [], options = {}) {
  const latestRound = Number(options.latestRound);
  let receipt = null;
  for (const entry of entries) {
    if (entry?.kind === 'receipt' && Number(entry.refs?.round) === latestRound) receipt = entry;
  }
  if (!receipt) return null;
  const html = decisionChipHtml(receipt, options);
  return html ? { entryId: String(receipt.id), html } : null;
}

/** 分栏宽度纯函数：保存值在每次视口变化后都按当前可用空间重新夹取。 */
export function clampStreamPanelWidth(value, viewportWidth) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const max = Math.max(288, Math.min(560, width - 520));
  return Math.min(max, Math.max(288, Number(value) || width * .33));
}

/** 慢网发送完成时，仅在输入框仍是原文的情况下清空，保护用户随后输入的新内容。 */
export function composerValueAfterSend(currentValue, sentValue) {
  return String(currentValue ?? '') === String(sentValue ?? '') ? '' : String(currentValue ?? '');
}

/** 上传成功后，把附件转成可直接发送的 Markdown 消息。 */
export function attachmentMessageMarkdown({ url, name, type } = {}) {
  const href = safeAssetUrl(url);
  const label = escapeMarkdownLabel(name);
  return String(type || '').startsWith('image/')
    ? `![${label}](${href})`
    : `[${label}](${href})`;
}

/**
 * 计算固定定位浮层的位置。默认放 pin 右下；接近边缘时翻到左侧或上方。
 * 三组参数均为 CSS 像素，返回值可直接写入 style.left/top。
 */
export function pinPopoverPosition(
  pin,
  viewport,
  popover,
  { gap = 14, margin = 12, verticalOffset = 12 } = {},
) {
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  const popoverWidth = Math.max(0, Number(popover?.width) || 0);
  const popoverHeight = Math.max(0, Number(popover?.height) || 0);
  const pinX = Number(pin?.x) || 0;
  const pinY = Number(pin?.y) || 0;

  let horizontal = 'right';
  let left = pinX + gap;
  if (left + popoverWidth > viewportWidth - margin) {
    horizontal = 'left';
    left = pinX - popoverWidth - gap;
  }
  left = Math.min(
    Math.max(margin, left),
    Math.max(margin, viewportWidth - popoverWidth - margin),
  );

  let vertical = 'below';
  let top = pinY - verticalOffset;
  if (top + popoverHeight > viewportHeight - margin) {
    vertical = 'above';
    top = pinY - popoverHeight - verticalOffset;
  }
  top = Math.min(
    Math.max(margin, top),
    Math.max(margin, viewportHeight - popoverHeight - margin),
  );

  return { left, top, horizontal, vertical };
}

/**
 * 把百分比 pin 换算为容器内浮层坐标。
 * visibleBounds 是视口可见区映射到容器后的边界；滚动时仍返回容器坐标。
 */
export function containerPinPopoverPosition(
  container,
  pin,
  popover,
  { visibleBounds, ...positionOptions } = {},
) {
  const width = Math.max(0, Number(container?.width) || 0);
  const height = Math.max(0, Number(container?.height) || 0);
  const xPct = Math.min(100, Math.max(0, Number(pin?.xPct) || 0));
  const yPct = Math.min(100, Math.max(0, Number(pin?.yPct) || 0));

  const leftBound = Math.min(width, Math.max(0, Number(visibleBounds?.left) || 0));
  const topBound = Math.min(height, Math.max(0, Number(visibleBounds?.top) || 0));
  const rawRight = Number(visibleBounds?.right);
  const rawBottom = Number(visibleBounds?.bottom);
  const rightBound = Math.max(
    leftBound,
    Math.min(width, Number.isFinite(rawRight) ? rawRight : width),
  );
  const bottomBound = Math.max(
    topBound,
    Math.min(height, Number.isFinite(rawBottom) ? rawBottom : height),
  );

  const position = pinPopoverPosition(
    {
      x: (xPct / 100) * width - leftBound,
      y: (yPct / 100) * height - topBound,
    },
    {
      width: rightBound - leftBound,
      height: bottomBound - topBound,
    },
    popover,
    positionOptions,
  );

  return {
    ...position,
    left: position.left + leftBound,
    top: position.top + topBound,
  };
}

/** 从内容字段与会话消息里找出可访问的 /assets/ 链接。 */
export function collectAssetLinks(contents = [], entries = []) {
  const found = new Map();
  const visit = (value) => {
    if (typeof value === 'string') {
      const matches = value.match(/\/assets\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+/g) || [];
      for (const url of matches) {
        const clean = url.replace(/[).,\]}]+$/, '');
        found.set(clean, clean.split('/').filter(Boolean).slice(2).join('/'));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  contents.forEach(visit);
  entries.forEach((entry) => visit(entry?.text));
  return [...found].map(([url, label]) => ({ url, label }));
}
