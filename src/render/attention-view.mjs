// 注意力分区视图。纯函数，返回 HTML 字符串。
// 使用 routeBlocks / decisionStats（protocol/attention.mjs）分四区渲染。
import { routeBlocks, decisionStats } from '../protocol/attention.mjs';
import { blockHtml } from './blocks.mjs';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 顶部状态条：决策进度
function statusBar(stats, blocks) {
  if (stats.needsDecision === 0) {
    // 退化态：全默认
    return `<div class="status-bar status-bar--nodecision" role="status">
  <span class="status-icon">✅</span>
  <span class="status-text">无需你决策，确认即可</span>
</div>`;
  }
  return `<div class="status-bar" role="status">
  <span class="status-icon">◆</span>
  <span class="status-text">需你决策 <strong>${stats.needsDecision}</strong> 项（其中 <strong>${stats.noRecommendation}</strong> 项无预设）</span>
  <progress class="decision-progress" value="0" max="${stats.needsDecision}" aria-label="决策进度"></progress>
  <a href="#zone-a" class="status-jump">跳到待决策</a>
</div>`;
}

// 渲染单个分区的 blocks 列表
function renderBlockList(blocks) {
  return blocks.map((b) => blockHtml(b)).join('\n');
}

// zoneCFyi 标题摘要：列出各 block 的 default 值
function fyiSummary(blocks) {
  if (blocks.length === 0) return '';
  const items = blocks.map((b) => {
    const val = b.default != null ? escHtml(String(b.default)) : '（无默认值）';
    const title = b.title ? escHtml(b.title) : escHtml(b.id ?? '');
    return `${title}: ${val}`;
  }).join(' · ');
  return `默认已设好（${blocks.length} 项）· ${items}`;
}

// 主导出：diffedBlocks（已带 _change）→ 完整四区 HTML
export function renderZones(diffedBlocks) {
  const blocks = diffedBlocks ?? [];
  const zones = routeBlocks(blocks);
  const stats = decisionStats(blocks);

  const parts = [];

  // 顶部状态条
  parts.push(statusBar(stats, blocks));

  // 叙述/图表内容（AI 的思考）：顶部可见，绝不折叠
  if (zones.zoneContext && zones.zoneContext.length > 0) {
    parts.push(`<section class="zone zone-context" aria-label="AI 的思考">
  <div class="zone-blocks">${renderBlockList(zones.zoneContext)}</div>
</section>`);
  }

  // 区 A：需你定·无预设（◆ 形状图标）
  if (zones.zoneA.length > 0) {
    parts.push(`<section id="zone-a" class="zone zone-a" aria-label="需你定·无预设">
  <header class="zone-header">
    <span class="zone-icon" aria-hidden="true">◆</span>
    <h2 class="zone-title">需你定·无预设</h2>
  </header>
  <div class="zone-blocks">${renderBlockList(zones.zoneA)}</div>
</section>`);
  }

  // 区 B：需你定·有推荐（◇ 形状图标）
  if (zones.zoneB.length > 0) {
    parts.push(`<section id="zone-b" class="zone zone-b" aria-label="需你定·有推荐">
  <header class="zone-header">
    <span class="zone-icon" aria-hidden="true">◇</span>
    <h2 class="zone-title">需你定·有推荐</h2>
  </header>
  <div class="zone-blocks">${renderBlockList(zones.zoneB)}</div>
</section>`);
  }

  // 区 C-Review：默认采用·建议过目（半展开，逐条带 default 预览）
  if (zones.zoneCReview.length > 0) {
    const reviewItems = zones.zoneCReview.map((b) => {
      const defPreview = b.default != null
        ? `<div class="default-preview">默认值：<code>${escHtml(String(b.default))}</code></div>`
        : '';
      return `${blockHtml(b)}\n${defPreview}`;
    }).join('\n');
    parts.push(`<section id="zone-c-review" class="zone zone-c-review" aria-label="默认采用·建议过目">
  <header class="zone-header">
    <span class="zone-icon" aria-hidden="true">◆</span>
    <h2 class="zone-title">默认采用·建议过目</h2>
  </header>
  <div class="zone-blocks">${reviewItems}</div>
</section>`);
  }

  // 区 C-FYI：折叠（仅有内容时渲染）
  if (zones.zoneCFyi.length > 0) {
    const summary = fyiSummary(zones.zoneCFyi);
    parts.push(`<details id="zone-c-fyi" class="zone zone-c-fyi">
  <summary class="zone-fyi-summary">已为你设好默认（${zones.zoneCFyi.length} 项）· ${escHtml(summary.replace(/^已为你设好.*·\s*/, ''))}</summary>
  <div class="zone-blocks">${renderBlockList(zones.zoneCFyi)}</div>
</details>`);
  }

  // 沉降区（zoneSettled）：本轮无变化 / 上轮已决 → 默认折叠，不在主区打扰用户（§4 改动 A'，C6）
  if (zones.zoneSettled && zones.zoneSettled.length > 0) {
    const n = zones.zoneSettled.length;
    parts.push(`<details id="zone-settled" class="zone zone-settled">
  <summary class="zone-settled-summary">本轮无变化 · ${n} 项（点开查看）</summary>
  <div class="zone-blocks">${renderBlockList(zones.zoneSettled)}</div>
</details>`);
  }

  return parts.join('\n');
}
