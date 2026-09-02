// 注意力分区视图。纯函数，返回 HTML 字符串。
// 使用 routeBlocks / decisionStats（protocol/attention.mjs）分四区渲染。
import { routeBlocks, decisionStats, roundDeltaStats, pendingDecisionBlocks, hasSections, groupBySection, sectionPendingStats } from '../protocol/attention.mjs';
import { blockHtml } from './blocks.mjs';
import { batchSelectionGroups } from './batch-select.mjs';

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(str) {
  return escHtml(str).replace(/"/g, '&quot;');
}

// 顶部状态条：决策进度（改动 B，DESIGN §4）
// opts.round: 当前轮次（可选，用于首轮特判）
// opts.isFirstRound: 明确标记为首轮（所有 block._change==='new' 时降级文案）
function statusBar(stats, blocks, opts = {}) {
  // faceted(tab)模式下 #zone-a 锚点会因多面重复 id 失效，改由 tab 导航跳转 → 去掉锚点
  const jump = opts.faceted ? '' : '\n  <a href="#zone-a" class="status-jump">跳到待决策</a>';
  if (stats.needsDecision === 0) {
    // 退化态：全默认
    return `<div class="status-bar status-bar--nodecision" role="status">
  <span class="status-icon">✅</span>
  <span class="status-text">无需你决策，确认即可</span>
</div>`;
  }

  const delta = roundDeltaStats(blocks || []);
  // 进度分母：本轮待决策块数（needsDecision 且非 unchanged）——与"已填 m/X"同分母
  const pendN = pendingDecisionBlocks(blocks || []).length;

  // 首轮特判：round===1 或全部块均为 new 时 → 降级为"首轮 · N 项待确认"（不显示 delta，无信息量）
  const allNew = (blocks || []).length > 0 && (blocks || []).every((b) => b._change === 'new');
  const isFirstRound = opts.round === 1 || opts.isFirstRound || allNew;

  if (isFirstRound) {
    return `<div class="status-bar" role="status">
  <span class="status-icon">◆</span>
  <span class="status-text">首轮 · <strong>${pendN}</strong> 项待确认</span>
  <progress class="decision-progress" value="0" max="${pendN || 1}" aria-label="决策进度"></progress>
  <span class="decision-count" data-total="${pendN}">已填 0/${pendN}</span>${jump}
</div>`;
  }

  // 本轮所有需决策项均已沉降（历史已决/无变化）→ 无新决策，避免"本轮 0 项"歧义
  if (pendN === 0) {
    return `<div class="status-bar status-bar--nodecision" role="status">
  <span class="status-icon">✅</span>
  <span class="status-text">本轮无新决策项（历史决策已折叠），确认即可</span>
</div>`;
  }

  // "待你确认" = 本轮浮上来的(新增+改动)，不含已沉降的已决/无变化项（否则重新制造"虚高/重复"感）
  return `<div class="status-bar" role="status">
  <span class="status-icon">◆</span>
  <span class="status-text">本轮 <strong>${pendN}</strong> 项待你确认（新增 <strong>${delta.newDecision}</strong> · 改动 <strong>${delta.changedDecision}</strong>）</span>
  <progress class="decision-progress" value="0" max="${pendN}" aria-label="决策进度"></progress>
  <span class="decision-count" data-total="${pendN}">已填 0/${pendN}</span>${jump}
</div>`;
}

// 渲染单个分区的 blocks 列表
function batchBarHtml(group) {
  if (!group) return '';
  const buttons = group.options.map((option) => (
    `<button type="button" class="batch-select-btn" data-batch-group="${escAttr(group.id)}" data-batch-value="${escAttr(option.value)}">全部选〈${escHtml(option.label)}〉</button>`
  )).join('');
  return `<div class="batch-select-bar" role="group" aria-label="批量选择">
  <span class="batch-select-label">批量（仅填未作答）</span>
  <div class="batch-select-actions">${buttons}</div>
</div>`;
}

function renderBlockList(blocks, batchGroups = []) {
  return blocks.map((block) => {
    const group = batchGroups.find((candidate) => candidate.anchorBlockId === block.id);
    return `${batchBarHtml(group)}${blockHtml(block)}`;
  }).join('\n');
}

// zoneCFyi 标题摘要：列出各 block 的 "标题: 默认值"（已 HTML 转义，直接内插）
// 注：routeBlocks 已保证进入 zoneCFyi 的块 default != null（无需再判空）
function fyiSummary(blocks) {
  if (blocks.length === 0) return '';
  return blocks.map((b) => {
    const val = escHtml(String(b.default));
    const title = b.title ? escHtml(b.title) : escHtml(b.id ?? '');
    return `${title}: ${val}`;
  }).join(' · ');
}

// 渲染一组 blocks 的四区正文（不含全局状态条）——整页或单个 tab 面复用。
// sfx：id 后缀，tab 模式下各面用 -f<i> 避免 zone-a 等 id 重复；整页模式 sfx='' 保持原 id（向后兼容）。
function renderZoneBody(blocks, sfx = '', batchGroups = []) {
  const zones = routeBlocks(blocks || []);
  const parts = [];

  // 叙述/图表内容（AI 的思考）= 设计方案：顶部可见，绝不折叠
  if (zones.zoneContext && zones.zoneContext.length > 0) {
    parts.push(`<section class="zone zone-context" aria-label="AI 的思考">
  <div class="zone-blocks">${renderBlockList(zones.zoneContext, batchGroups)}</div>
</section>`);
  }

  // 区 A：需你定·无预设（◆ 形状图标）—— 必须确认，置于设计方案之后、其它决策之前
  if (zones.zoneA.length > 0) {
    parts.push(`<section id="zone-a${sfx}" class="zone zone-a" aria-label="需你定·无预设">
  <header class="zone-header">
    <span class="zone-icon" aria-hidden="true">◆</span>
    <h2 class="zone-title">需你定·无预设</h2>
  </header>
  <div class="zone-blocks">${renderBlockList(zones.zoneA, batchGroups)}</div>
</section>`);
  }

  // 区 B：需你定·有推荐（◇ 形状图标）
  if (zones.zoneB.length > 0) {
    parts.push(`<section id="zone-b${sfx}" class="zone zone-b" aria-label="需你定·有推荐">
  <header class="zone-header">
    <span class="zone-icon" aria-hidden="true">◇</span>
    <h2 class="zone-title">需你定·有推荐</h2>
  </header>
  <div class="zone-blocks">${renderBlockList(zones.zoneB, batchGroups)}</div>
</section>`);
  }

  // 区 C-Review：默认采用·建议过目（半展开，逐条带 default 预览）
  if (zones.zoneCReview.length > 0) {
    const reviewItems = zones.zoneCReview.map((b) => {
      const defPreview = b.default != null
        ? `<div class="default-preview">默认值：<code>${escHtml(String(b.default))}</code></div>`
        : '';
      const group = batchGroups.find((candidate) => candidate.anchorBlockId === b.id);
      return `${batchBarHtml(group)}${blockHtml(b)}\n${defPreview}`;
    }).join('\n');
    parts.push(`<section id="zone-c-review${sfx}" class="zone zone-c-review" aria-label="默认采用·建议过目">
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
    parts.push(`<details id="zone-c-fyi${sfx}" class="zone zone-c-fyi">
  <summary class="zone-fyi-summary">已为你设好默认（${zones.zoneCFyi.length} 项）· ${summary}</summary>
  <div class="zone-blocks">${renderBlockList(zones.zoneCFyi, batchGroups)}</div>
</details>`);
  }

  // 沉降区（zoneSettled）：本轮无变化 / 上轮已决 → 默认折叠（§4 改动 A'/D）
  if (zones.zoneSettled && zones.zoneSettled.length > 0) {
    const decidedN = zones.zoneSettled.filter((b) => b._decidedInPrev).length;
    const unchangedM = zones.zoneSettled.length - decidedN;
    let summaryParts = [];
    if (decidedN > 0) summaryParts.push(`已决 ${decidedN} 项（上轮已确认·本轮无变化）`);
    if (unchangedM > 0) summaryParts.push(`本轮无变化 ${unchangedM} 项`);
    const summaryText = summaryParts.join(' · ') + '（点开查看）';
    parts.push(`<details id="zone-settled${sfx}" class="zone zone-settled">
  <summary class="zone-settled-summary">${escHtml(summaryText)}</summary>
  <div class="zone-blocks">${renderBlockList(zones.zoneSettled, batchGroups)}</div>
</details>`);
  }

  return parts.join('\n');
}

// 默认激活的 tab：第一个"含未确认必须决策"的非空面；否则第一个非空面（静态用空草稿=全未确认）
function defaultActiveIndex(groups) {
  const withMust = groups.findIndex((g) => g.blocks.length && sectionPendingStats(g.blocks, {}).must > 0);
  if (withMust !== -1) return withMust;
  const firstNonEmpty = groups.findIndex((g) => g.blocks.length);
  return firstNonEmpty === -1 ? 0 : firstNonEmpty;
}

// tab 导航条：每面一个 tab；空面灰(disabled)；角标=未确认决策数（红=含必须、橙=只剩可接受、无=无决策/已清零）
function tabBar(groups, active) {
  const tabs = groups.map((g, i) => {
    const empty = g.blocks.length === 0;
    const totalDec = pendingDecisionBlocks(g.blocks).length;   // 该面决策总数
    const st = sectionPendingStats(g.blocks, {});              // 初始=全未确认
    const pending = st.must + st.optional;
    const badgeCls = st.must > 0 ? 'must' : (st.optional > 0 ? 'optional' : 'done');
    const badge = (!empty && totalDec > 0)
      ? `<span class="tab-badge tab-badge-${badgeCls}" data-facet="${i}" data-total="${totalDec}">${pending}</span>`
      : '';
    const cls = `tab${i === active ? ' tab-active' : ''}${empty ? ' tab-empty' : ''}`;
    const attrs = empty ? ' disabled aria-disabled="true"' : ` aria-selected="${i === active}"`;
    return `<button type="button" role="tab" class="${cls}" data-facet="${i}"${attrs}>
  <span class="tab-label">${escHtml(g.section)}</span>${badge}
</button>`;
  }).join('');
  return `<nav class="tab-nav" role="tablist" aria-label="分面导航">${tabs}</nav>`;
}

// 主导出：diffedBlocks（已带 _change）→ 完整 HTML。
// opts.round：首轮特判；opts.sections：显式类目顺序（覆盖 canonical）。存在 section 时启用 tab 分面导航。
export function renderZones(diffedBlocks, opts = {}) {
  const blocks = diffedBlocks ?? [];
  const stats = decisionStats(blocks);
  const faceted = hasSections(blocks, opts.sections);
  const batchGroups = opts.readonly ? [] : batchSelectionGroups(blocks);

  const parts = [];
  parts.push(statusBar(stats, blocks, { ...opts, faceted }));

  if (!faceted) {
    parts.push(renderZoneBody(blocks, '', batchGroups));
    return parts.join('\n');
  }

  // tab 分面模式
  const groups = groupBySection(blocks, opts.sections);
  const active = defaultActiveIndex(groups);
  parts.push(tabBar(groups, active));
  groups.forEach((g, i) => {
    const body = g.blocks.length
      ? renderZoneBody(g.blocks, `-f${i}`, batchGroups)
      : '<p class="facet-empty">本类目本轮暂无内容</p>';
    parts.push(`<section class="facet" role="tabpanel" data-facet="${i}" id="facet-${i}"${i === active ? '' : ' hidden'}>
  <div class="facet-body">${body}</div>
</section>`);
  });
  return parts.join('\n');
}
