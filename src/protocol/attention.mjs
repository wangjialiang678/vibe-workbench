// 注意力路由（DESIGN §4 + §13 P0-3）。浏览器安全（仅依赖 constants）。
import { IMPORTANCE_RANK } from './constants.mjs';

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
