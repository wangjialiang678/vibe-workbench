// templates/think-discuss.mjs — 思考共创模板（DESIGN §10）
// 零依赖、ESM、纯函数工厂

/**
 * slug(str) — 将任意字符串转为稳定 block id 后缀
 * 规则：小写、非字母数字转 '-'、去重连字符（但不 trim 尾部 '-'，保留原义）
 */
export function slug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    // collapse multiple consecutive hyphens into one
    .replace(/-{2,}/g, '-');
}

/**
 * thinkDiscuss({ title, thoughtMd, diagrams=[], decisions=[], doc=null }) -> Block[]
 *
 * Block 顺序：
 *   1. markdown 块 b-thought（思路正文）
 *   2. diagram 块 b-diag-<slug(key)>（每个 diagram）
 *   3. choice 或 verdict 块 b-dec-<slug(key)>（每个 decision）
 *   4. editable 块 b-doc（仅当 doc 非 null）
 */
export default function thinkDiscuss({ title, thoughtMd, diagrams = [], decisions = [], doc = null }) {
  const blocks = [];

  // 1. 思路正文 markdown 块
  blocks.push({
    id: 'b-thought',
    type: 'markdown',
    title: title ?? null,
    body: thoughtMd,
    needsDecision: false,
    hasRecommendation: false,
    recommendation: null,
    importance: 'normal',
  });

  // 2. 架构/时序图 diagram 块
  for (const { key, title: diagTitle, mermaid, rationale } of diagrams) {
    blocks.push({
      id: 'b-diag-' + slug(key),
      type: 'diagram',
      title: diagTitle ?? null,
      body: mermaid,
      lang: 'mermaid',
      rationale: rationale ?? null,
      needsDecision: false,
      hasRecommendation: false,
      recommendation: null,
      importance: 'normal',
    });
  }

  // 3. 决策块（choice 当有 options，否则 verdict）
  for (const { key, question, options, recommend, importance = 'normal' } of decisions) {
    const id = 'b-dec-' + slug(key);
    const hasRec = !!recommend;

    if (options && options.length > 0) {
      // choice 块
      blocks.push({
        id,
        type: 'choice',
        title: question,
        body: null,
        options,
        needsDecision: true,
        hasRecommendation: hasRec,
        recommendation: recommend ?? null,
        importance,
      });
    } else {
      // verdict 块（无选项）
      blocks.push({
        id,
        type: 'verdict',
        title: question,
        body: null,
        needsDecision: true,
        hasRecommendation: hasRec,
        recommendation: recommend ?? null,
        importance,
      });
    }
  }

  // 4. 可编辑文档块（可选）
  if (doc !== null) {
    blocks.push({
      id: 'b-doc',
      type: 'editable',
      title: null,
      body: null,
      value: doc,
      editable: true,
      needsDecision: false,
      hasRecommendation: false,
      recommendation: null,
      importance: 'normal',
    });
  }

  return blocks;
}
