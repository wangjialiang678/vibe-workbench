// templates/dev-review.mjs — 研发评审模板（DESIGN §10 + §1.3 + §5）
// 零依赖、ESM、纯函数工厂
// 复刻 prd-studio 能力：PRD 条目(verdict) + 架构图/断言/方案(diagram/verdict/choice)
//                     + 测试场景(verdict) + Gherkin 测试用例(code)

// ── §5.1 去技术黑话写作指南（AI 产出时遵循）──────────────────────────────────
// 1. verdict/choice 的 title 用「问句」（"删掉这个功能还是补需求？"），不用命令句。
// 2. body ≤2 句：说清"什么情况、什么后果"，不说原因/实现。
//    ✗ "系统弹出确认对话框，用户确认后执行删除，不可恢复"
//    ✓ "删除后无法恢复。确定要删除这条记录吗？"
// 3. options/recommendation 用「动词+名词」，消灭 Yes/No/OK/确定/取消：
//    ✗ "确认 / 取消"  ✓ "永久删除 / 返回"
// 4. 不可逆操作必须在 body 中显式写"不可撤销"或"无法恢复"。
// 5. 可逆操作不必确认，用 Undo Toast；不可逆才上确认。
// ── §5.2 场景化宏观测试设计指南（testScenarios/testCases 时遵循）────────────
// 1. testScenarios[].name 用场景名（"管理员快速定位用户"），不是步骤序号。
// 2. testScenarios[].expect 用旅程叙事 + 用户意图 + 期望结果，不是操作流程罗列。
//    ✗ "进后台→点用户管理→输入用户名→点搜索→列表展示"
//    ✓ "管理员知道目标邮箱，希望 30 秒内定位并改权限，无需找技术支持。"
// 3. testCases[].gherkin 用 BDD Given/When/Then，业务价值导向，不含 UI 细节：
//    Scenario: 管理员快速定位并修改用户权限
//      Given 管理员已登录后台，知道目标用户邮箱
//      When  管理员搜索该邮箱并修改权限
//      Then  权限变更立即生效，目标用户下次登录受新权限约束

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
 * devReview({
 *   prdItems       = [],   // { key, title, body, importance? }
 *   archDiagrams   = [],   // { key, title, mermaid, rationale }
 *   archAssertions = [],   // { key, title, body, importance? } → verdict block（§1.3 面④）
 *   archAlternatives = [], // { key, title, body, options[], recommendation?, importance? }
 *                          //   → choice block（options[].label = 方案名，recommendation = chosen id）
 *   testScenarios  = [],   // { key, name, expect }
 *   testCases      = [],   // { key, name, gherkin } → code block(lang:'gherkin')
 * }) -> Block[]
 *
 * Block 顺序：
 *   1. verdict 块 b-prd-<slug(key)>（每个 prdItem，§1.3 面①）
 *   2. diagram 块 b-arch-<slug(key)>（每个 archDiagram，§1.3 面④）
 *   3. verdict 块 b-assert-<slug(key)>（每个 archAssertion，§1.3 面④）
 *   4. choice  块 b-alt-<slug(key)>（每个 archAlternative，§1.3 面④）
 *   5. verdict 块 b-test-<slug(key)>（每个 testScenario，§1.3 面⑤）
 *   6. code    块 b-case-<slug(key)>（每个 testCase，lang:'gherkin'，§1.3 面⑤）
 */
export default function devReview({
  prdItems       = [],
  archDiagrams   = [],
  archAssertions = [],
  archAlternatives = [],
  testScenarios  = [],
  testCases      = [],
} = {}) {
  const blocks = [];

  // 1. PRD 条目 → verdict 块（需评审，needsDecision=true）
  // §5.1：title 用问句，body ≤2 句后果描述，options 动词+名词
  for (const { key, title, body, importance = 'normal' } of prdItems) {
    blocks.push({
      id: 'b-prd-' + slug(key),
      section: '需求',
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
      section: '架构',
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

  // 3. 架构断言 → verdict 块（需评审：断言成立/异议？）
  // §1.3 面④：assertion → verdict block；body 用"断言不成立会怎样"白话后果描述
  for (const { key, title, body, importance = 'normal' } of archAssertions) {
    blocks.push({
      id: 'b-assert-' + slug(key),
      section: '架构',
      type: 'verdict',
      title: title ?? null,
      body: body ?? null,
      needsDecision: true,
      hasRecommendation: false,
      recommendation: null,
      importance,
    });
  }

  // 4. 架构备选方案 → choice 块（§1.3 面④：alternatives → choice，recommendation=chosen）
  // §5.1：options[].label 用动词+名词（"采用微服务 / 保持单体"）
  for (const { key, title, body, options = [], recommendation = null, importance = 'normal' } of archAlternatives) {
    const hasRec = recommendation != null && options.some((o) => o.id === recommendation);
    blocks.push({
      id: 'b-alt-' + slug(key),
      section: '架构',
      type: 'choice',
      title: title ?? null,
      body: body ?? null,
      options,
      recommendation: hasRec ? recommendation : null,
      hasRecommendation: hasRec,
      needsDecision: true,
      importance,
    });
  }

  // 5. 测试场景 → verdict 块（需评审通过/异议）
  // §5.2：name 用场景名，expect 用旅程叙事
  for (const { key, name, expect } of testScenarios) {
    blocks.push({
      id: 'b-test-' + slug(key),
      section: '测试',
      type: 'verdict',
      title: name ?? null,
      body: expect ?? null,
      needsDecision: true,
      hasRecommendation: false,
      recommendation: null,
      importance: 'normal',
    });
  }

  // 6. Gherkin 测试用例 → code 块（lang:'gherkin'，§1.3 面⑤）
  // §5.2：Given/When/Then，业务价值导向，不含 UI 细节
  for (const { key, name, gherkin } of testCases) {
    blocks.push({
      id: 'b-case-' + slug(key),
      section: '测试',
      type: 'code',
      title: name ?? null,
      body: gherkin ?? '',
      lang: 'gherkin',
      needsDecision: false,
      hasRecommendation: false,
      recommendation: null,
      importance: 'normal',
    });
  }

  return blocks;
}
