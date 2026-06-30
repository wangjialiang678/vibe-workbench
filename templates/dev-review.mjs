// templates/dev-review.mjs — 研发评审模板（DESIGN §10）
// 零依赖、ESM、纯函数工厂
// 复刻 prd-studio 能力：PRD 条目(verdict) + 架构图(diagram) + 测试场景(verdict/markdown)

/**
 * slug(str) — 同 think-discuss 里的 slug，此处各自实现，避免跨文件耦合
 * 规则：小写、非字母数字转 '-'、去重连字符
 */
function slug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-');
}

/**
 * devReview({ prdItems=[], archDiagrams=[], testScenarios=[] }) -> Block[]
 *
 * Block 顺序：
 *   1. verdict 块 b-prd-<slug(key)>（每个 prdItem）
 *   2. diagram 块 b-arch-<slug(key)>（每个 archDiagram）
 *   3. verdict 块 b-test-<slug(key)>（每个 testScenario）
 */
export default function devReview({ prdItems = [], archDiagrams = [], testScenarios = [] } = {}) {
  const blocks = [];

  // 1. PRD 条目 → verdict 块（需评审，needsDecision=true）
  for (const { key, title, body, importance = 'normal' } of prdItems) {
    blocks.push({
      id: 'b-prd-' + slug(key),
      type: 'verdict',
      title: title ?? null,
      body: body ?? null,
      needsDecision: true,
      hasRecommendation: false,
      recommendation: null,
      importance,
    });
  }

  // 2. 架构图 → diagram 块
  for (const { key, title, mermaid, rationale } of archDiagrams) {
    blocks.push({
      id: 'b-arch-' + slug(key),
      type: 'diagram',
      title: title ?? null,
      body: mermaid,
      lang: 'mermaid',
      rationale: rationale ?? null,
      needsDecision: false,
      hasRecommendation: false,
      recommendation: null,
      importance: 'normal',
    });
  }

  // 3. 测试场景 → verdict 块（需评审通过/异议）
  for (const { key, name, expect } of testScenarios) {
    blocks.push({
      id: 'b-test-' + slug(key),
      type: 'verdict',
      title: name ?? null,
      body: expect ?? null,
      needsDecision: true,
      hasRecommendation: false,
      recommendation: null,
      importance: 'normal',
    });
  }

  return blocks;
}
