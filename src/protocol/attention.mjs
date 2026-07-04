// 注意力路由（DESIGN §4 + §13 P0-3）。浏览器安全（仅依赖 constants）。
import { IMPORTANCE_RANK, DEFAULT_SECTIONS, MISC_SECTION } from './constants.mjs';

// 分区：zoneContext 叙述(可见) / zoneA 需决策·无推荐 / zoneB 需决策·有推荐 / zoneCReview 重要默认 / zoneCFyi 折叠默认 / zoneSettled 本轮无变化·已决(折叠沉降)
// 改动 A'（DESIGN §4）：_change 参与分区——unchanged 或上轮已决(_decidedInPrev) 的块默认降级到 zoneSettled 折叠；new/changed(或无 _change) 常显。
export function routeBlocks(blocks = []) {
  const withIdx = (blocks || []).map((b, i) => ({ b, i }));
  const rank = (x) => (IMPORTANCE_RANK[x.b.importance] ?? 1);
  const sortStable = (arr) => arr.slice().sort((a, c) => (rank(a) - rank(c)) || (a.i - c.i)).map((x) => x.b);
  const hasDefault = (x) => x.b.default != null; // 真正"已设默认"才进折叠/过目区
  const isStale = (x) => x.b._change === 'unchanged' || x.b._decidedInPrev === true; // 本轮无变化 / 上轮已决 → 沉降

  const fresh = withIdx.filter((x) => !isStale(x)); // new/changed/无_change → 常显
  const settled = withIdx.filter((x) => isStale(x)); // 折叠沉降
  const freshNeeds = fresh.filter((x) => x.b.needsDecision);
  const freshFyi = fresh.filter((x) => !x.b.needsDecision);

  return {
    // 无需决策且无默认 + 本轮新增/改动 = 纯叙述/图表内容（AI 的思考）→ 顶部可见
    zoneContext: freshFyi.filter((x) => !hasDefault(x)).map((x) => x.b),
    zoneA: sortStable(freshNeeds.filter((x) => !x.b.hasRecommendation)),
    zoneB: sortStable(freshNeeds.filter((x) => x.b.hasRecommendation)),
    zoneCReview: sortStable(freshFyi.filter((x) => hasDefault(x) && x.b.importance === 'high')),
    zoneCFyi: freshFyi.filter((x) => hasDefault(x) && x.b.importance !== 'high').map((x) => x.b),
    // 本轮无变化 / 上轮已决 → 折叠沉降区（保留原顺序；渲染时按 _decidedInPrev 区分"已决"vs"未变"）
    zoneSettled: settled.map((x) => x.b),
  };
}

export function decisionStats(blocks = []) {
  const needs = (blocks || []).filter((b) => b.needsDecision);
  const noRec = needs.filter((b) => !b.hasRecommendation);
  return { total: (blocks || []).length, needsDecision: needs.length, noRecommendation: noRec.length };
}

// 提交前盲签防护（DESIGN §13 P0-1）：needsDecision 但用户未操作的块 id
export function unansweredDecisions(blocks = [], answeredIds = []) {
  const answered = new Set(answeredIds);
  return (blocks || []).filter((b) => b.needsDecision && !answered.has(b.id)).map((b) => b.id);
}

// roundDeltaStats: 本轮增量统计（改动 B，DESIGN §4）
// blocks 为已带 _change 的 diffed blocks（/api/content 返回值）
export function roundDeltaStats(blocks = []) {
  const d = (blocks || []).filter((b) => b.needsDecision);
  return {
    totalDecision: d.length,
    newDecision: d.filter((b) => b._change === 'new').length,
    changedDecision: d.filter((b) => b._change === 'changed').length,
    newFyi: (blocks || []).filter((b) => !b.needsDecision && b._change === 'new').length,
  };
}

// 提交摘要：用于确认弹层文案
export function submitSummary(blocks = [], answeredIds = []) {
  const answered = new Set(answeredIds);
  const decided = (blocks || []).filter((b) => b.needsDecision && answered.has(b.id)).length;
  const unanswered = unansweredDecisions(blocks, answeredIds);
  const defaults = (blocks || []).filter((b) => !b.needsDecision && b.default != null);
  const importantDefaults = defaults.filter((b) => b.importance === 'high');
  return {
    decided,
    unanswered,
    acceptedDefaults: defaults.length,
    importantDefaults: importantDefaults.map((b) => b.id),
  };
}

// 提交前确认模型（DESIGN §13 P0-1）：把 id 映射为含 title/importance 的对象，供模态就地展开复核/跳转
export function confirmModel(blocks = [], answeredIds = []) {
  const list = blocks || [];
  const byId = (id) => list.find((b) => b.id === id) || {};
  const answered = new Set(answeredIds);
  const decided = list.filter((b) => b.needsDecision && answered.has(b.id)).length;
  const defaults = list.filter((b) => !b.needsDecision && b.default != null);
  const toRef = (b) => ({ id: b.id, title: b.title || b.id, importance: b.importance || 'normal', section: b.section || null });
  const unansweredBlocks = list.filter((b) => b.needsDecision && !answered.has(b.id));
  // 拆两类：必须决策(无推荐) vs 可接受默认(有推荐)——提交时对"必须决策"未确定重点警示
  const unansweredMust = unansweredBlocks.filter((b) => !b.hasRecommendation).map(toRef);
  const unansweredOptional = unansweredBlocks.filter((b) => b.hasRecommendation).map(toRef);
  const unanswered = unansweredBlocks.map(toRef); // 兼容既有调用
  const importantDefaults = defaults
    .filter((b) => b.importance === 'high')
    .map((b) => ({ id: b.id, title: b.title || b.id, default: b.default }));
  return { decided, acceptedDefaults: defaults.length, unanswered, unansweredMust, unansweredOptional, importantDefaults };
}

// 本轮"待决策"块（DESIGN §13 P2 进度分母）：needsDecision 且非 unchanged（沉降/已决项不计入本轮进度）
export function pendingDecisionBlocks(blocks = []) {
  return (blocks || []).filter((b) => b.needsDecision && b._change !== 'unchanged');
}

// 单块是否已做出"决策"（非仅评论）——用于进度计数
function isDecisionFilled(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.verdict) return true;
  if (item.select != null && item.select !== '') return true;
  if (typeof item.text === 'string' && item.text.trim() !== '') return true;
  if (item.checklistItems && typeof item.checklistItems === 'object'
      && Object.keys(item.checklistItems).length > 0) return true;
  return false;
}

// 已完成决策计数（DESIGN §13 P2）：仅计已做出决策的待决策块（纯评论不计入）
export function countAnsweredDecisions(blocks = [], draft = {}) {
  const d = draft || {};
  return pendingDecisionBlocks(blocks).filter((b) => isDecisionFilled(d[b.id])).length;
}

// ── tab 分面导航（restore prd-studio 六面）────────────────────────────

// 是否启用 tab 模式：content 显式给了 sections，或任何块带 section
export function hasSections(blocks = [], sections = null) {
  if (Array.isArray(sections) && sections.length) return true;
  return (blocks || []).some((b) => typeof b.section === 'string' && b.section);
}

// 按类目分组。sectionOrder = canonical 顺序（DEFAULT_SECTIONS 或 content.sections）。
// 返回 [{section, blocks}]：canonical 面全保留（空=灰 tab）；自定义面（出现但不在 canonical）追加；无 section 块 → 「其他」（仅非空时出现）。
export function groupBySection(blocks = [], sectionOrder = DEFAULT_SECTIONS) {
  const list = blocks || [];
  const order = (Array.isArray(sectionOrder) && sectionOrder.length) ? sectionOrder.slice() : DEFAULT_SECTIONS.slice();
  const bySection = new Map();
  for (const name of order) bySection.set(name, []);
  const extra = []; // 出现但不在 canonical 的自定义面（保序）
  const misc = [];
  for (const b of list) {
    const s = (typeof b.section === 'string' && b.section) ? b.section : null;
    if (!s) { misc.push(b); continue; }
    if (bySection.has(s)) { bySection.get(s).push(b); continue; }
    let g = extra.find((x) => x.section === s);
    if (!g) { g = { section: s, blocks: [] }; extra.push(g); }
    g.blocks.push(b);
  }
  const groups = order.map((name) => ({ section: name, blocks: bySection.get(name) }));
  groups.push(...extra);
  if (misc.length) groups.push({ section: MISC_SECTION, blocks: misc });
  return groups;
}

// 某面未确认决策统计：must=必须(无推荐)、optional=可接受(有推荐)——驱动 tab 角标颜色与提交警示
export function sectionPendingStats(sectionBlocks = [], draft = {}) {
  const d = draft || {};
  const pend = pendingDecisionBlocks(sectionBlocks).filter((b) => !isDecisionFilled(d[b.id]));
  return {
    must: pend.filter((b) => !b.hasRecommendation).length,
    optional: pend.filter((b) => b.hasRecommendation).length,
  };
}
