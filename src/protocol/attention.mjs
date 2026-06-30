// 注意力路由（DESIGN §4 + §13 P0-3）。浏览器安全（仅依赖 constants）。
import { IMPORTANCE_RANK } from './constants.mjs';

// 分区：zoneA 需决策·无推荐(最先) / zoneB 需决策·有推荐 / zoneCReview 已设默认·重要建议过目 / zoneCFyi 折叠
export function routeBlocks(blocks = []) {
  const withIdx = (blocks || []).map((b, i) => ({ b, i }));
  const rank = (x) => (IMPORTANCE_RANK[x.b.importance] ?? 1);
  const sortStable = (arr) => arr.slice().sort((a, c) => (rank(a) - rank(c)) || (a.i - c.i)).map((x) => x.b);

  const needs = withIdx.filter((x) => x.b.needsDecision);
  const fyi = withIdx.filter((x) => !x.b.needsDecision);

  return {
    zoneA: sortStable(needs.filter((x) => !x.b.hasRecommendation)),
    zoneB: sortStable(needs.filter((x) => x.b.hasRecommendation)),
    zoneCReview: sortStable(fyi.filter((x) => x.b.importance === 'high')),
    zoneCFyi: fyi.filter((x) => x.b.importance !== 'high').map((x) => x.b),
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
