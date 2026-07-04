STATUS: DONE（2026-07-04，npm test 248 pass / 0 fail；Playwright 无头截图真机验证通过）

# 计划：工作台 tab 分面导航（prd-studio 式，真·切换 + 防漏看角标）

## 用户规格（原话要点）
1. 和 prd-studio 一样的 **tab 导航**（真·切换、切一个看一个）——体验更好。
2. **默认放上所有类目**；这次没有该类目 → 该 tab **变灰**（不可点）。
3. 每个 tab 放 **数字角标 = 未确认决策数**；用户每确认一个，数字减一。（防漏看）
4. **必须确认 vs 可不确认 用不同颜色**标注；**必须确认放最上面，然后是待确认**。
5. **每个 tab 内：先放设计方案，再放待确认/决策内容。**

## 设计（落实到实现）
- **canonical tab 集**（默认，全部常显、空则灰）：`需求 / 架构 / UI 设计 / 交互设计 / 测试 / 风险`；有无归类块时追加「其他」。可用 `content.sections` 覆盖。
- **块可选字段 `section: string`**（无需改 schema，validateBlock 宽容）。faceted/tab 模式在"存在 section 或 content.sections"时激活；否则维持现状（向后兼容，老 session 不变）。
- **tab 内顺序 = 现有 `renderZoneBody` 顺序**：zoneContext(设计方案：markdown/diagram/prototype) → zoneA(必须确认·红) → zoneB(待确认·可接受·橙) → zoneCReview/zoneCFyi(已设默认) → zoneSettled。**正好满足规格 4+5，直接复用。**
- **角标**（防漏看核心）：每 tab = 该面未确认决策数。颜色：含未确认"必须确认(needsDecision & !hasRecommendation)" → 红；只剩"可接受(has rec)" → 橙；清零 → 无角标/灰勾。用户确认后 `updateDecisionProgress` 里同步递减。
- **真·tab 切换**：点 tab → 显示该面 `.facet`，隐藏其它；空 tab 灰、不可点。默认激活=第一个"有未确认必答项"的非空 tab，否则第一个非空 tab。
- **防盲签（隐藏式 tab 的安全网）**：① 每 tab 角标常显未确认数（切走也知道哪面欠）；② 顶部全局进度「已填 m/X」跨所有面；③ 提交确认弹层（§13 P0-1）列**跨所有面**未表态项，点击**自动切到所在 tab** 再滚动高亮。→ 隐藏但不可能盲签。
- **提交时必须决策警示（用户新增要求）**：把未表态拆成 **必须决策(needsDecision & !hasRecommendation)** 与 **可接受默认(has rec)** 两类。提交时若"必须决策"未确定 >0 → 弹层顶部红字明确提示「⚠️ 还有 X 个必须决策的点没确定」，逐条列出可跳转；用户可选择"返回补填"或"仍要提交"。可接受默认项作次级提示。
- 全局元素（状态条/「只看变更」/提交）保持在 tab 栏之上。

## 步骤清单
- [x] **1 · 协议助手**（`src/protocol/attention.mjs` + `constants.mjs`）
  - `constants`：`export const DEFAULT_SECTIONS = ['需求','架构','UI 设计','交互设计','测试','风险']`。
  - `groupBySection(blocks, sectionOrder) -> [{section, blocks}]`：按 canonical 顺序建组（空组保留=灰 tab）；无 section 块归「其他」（仅非空时出现）；末尾追加内容里出现但不在 canonical 的自定义面。
  - `hasSections(blocks, content)`：是否启用 tab 模式。
  - `sectionPendingStats(blocks, draft) -> {must, optional}`：该面未确认 must / optional 计数（复用 isDecisionFilled 逻辑）。
- [x] **2 · 渲染重构**（`src/render/attention-view.mjs`）
  - 抽 `renderZoneBody(blocks)`（现四区逻辑，去全局状态条）。
  - `renderZones`：全局状态条(不变) → 若 tab 模式：`tabBar(groups)` + 每组 `<section class="facet" id="facet-<slug>" data-facet-slug hidden?>` 内 `renderZoneBody`；否则 `renderZoneBody(allBlocks)`（现状）。
  - `tabBar`：`<nav class="tab-nav">` 每面一个 `<button class="tab" data-facet data-empty? disabled?>面名 <span class="tab-badge">N</span></button>`。
- [x] **3 · 交互**（`src/render/app.mjs`）
  - `activateFacet(slug)`：显隐 `.facet`、切 tab 选中态；bootstrap/loadAndRender 后选默认 tab。
  - tab 点击 → activateFacet；灰 tab 忽略。
  - `updateDecisionProgress` 扩展：刷新每 tab `tab-badge` 数字 + 颜色（must/optional）。
  - `jumpToBlock` 扩展：目标块若在隐藏 facet → 先 activateFacet 再 scrollIntoView+flash（保证从提交弹层能跳进隐藏 tab）。
- [x] **4 · 样式**（`src/render/app.css`）：`.tab-nav`(sticky 横向可滚)、`.tab`(选中/灰/hover)、`.tab-badge`(红/橙/隐藏)、`.facet[hidden]`。暗色 + 移动端。
- [x] **5 · 模板产出 section**（`templates/dev-review.mjs` `design-review.mjs`）
  - dev-review：prdItems→需求、arch*→架构、test*→测试；可加 risks→风险（若模板有）。
  - design-review：screen 默认 `section='UI 设计'`，`screen.section` 可覆盖（交互设计）；checklist→'测试' 或独立面。
  - 追加字段，不动现结构。
- [x] **6 · 测试**：groupBySection（canonical 顺序/空组/其他/自定义面）、sectionPendingStats、faceted 渲染出 tab-nav+facet+空 tab 灰、无 section 向后兼容、tab 内仍 context→zoneA→zoneB 顺序、模板 section 正确。
- [x] **7 · 文档 + 回归**：DESIGN §2.2 加 `section` + 新增 §15「tab 分面导航」；SKILL.md 协议速查加 `section` + canonical 面；dev-log 批次 7；`npm test` 全绿。
- [x] **8（可选，待点头）· demo**：给 `ms-design-verify-0704` content 追加 section（需求/架构/风险归面），你直接在现有 session 看到 tab（UI/交互面会灰，因无内容——正好演示"没有该类目变灰"）。

## 影响文件
改：`src/protocol/{attention,constants}.mjs`、`src/render/{attention-view,app.mjs,app.css}`、`templates/{dev-review,design-review}.mjs`、`docs/DESIGN.md`、`~/.claude/skills/workbench/SKILL.md`；扩测试。不改：schema/server/loop/diff。

## 风险 / 非目标
- 风险：渲染重构碰现有 renderZones 断言——逐一保证子串不变（首轮文案、`新增 <strong>N</strong>`、zone-a、fyiSummary 等）。
- 非目标：给 meeting-scribe **生成** UI/交互内容（需设计素材）；字段级 diff、embed 安全等其它批次。
