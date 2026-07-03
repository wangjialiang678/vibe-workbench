STATUS: DONE（2026-07-03，npm test 234 pass / 0 fail）

# 计划：§13 落地校验批次（把"纸面已采纳、代码未落地"的欠账补齐）

> 来源：docs/research/2026-07-02-hci-clarification-community-and-project-review.md「元发现 A」。
> 已亲自读码核实每一项的真实现状（见下"核实结论"），不照抄子代理假设。

## 目标
DESIGN §13 采纳的若干 UX 修订只写进文档、实现层断了。本批次逐条补齐并加测试，并确立"§13 类采纳项必须有测试断言"的护栏，防止再次纸面化。**只做 §13 欠账，不加计划外功能。**

## 核实结论（读码后，与评审子代理的差异已修正）
| # | §13 承诺 | 读码后的真实现状 | 定性 |
|---|---|---|---|
| 1 | P0-1 提交前可就地展开复核未表态/重要默认项 | `app.mjs:759-777` 用原生 `confirm()` 纯文本，`summary.unanswered`/`importantDefaults`（已在 `attention.submitSummary` 算好）仅 `join(',')` 显示 blockId，无法展开/跳转 | 真实缺口 P0 |
| 2 | P2 长页面进度「已填 m/X」 | `attention-view.mjs:32,42` `<progress value="0">` 恒 0，无 JS 更新；无 m/X 文字 | 真实缺口 P2 |
| 3 | P1 diff 议题重组提示 | `diffSanity()` 已算，`server.mjs:190` **已回传 `sanity`**，但 `app.mjs:loadAndRender` 只读 `data.blocks`、不消费 `data.sanity` → 前端无提示 | 纯前端缺口 P1 |
| 4 | P1 diff「↩已采纳/—维持」徽章 | `diff-view.mjs:24,31` 输出 `.badge-adopted/.badge-maintained/.badge-unchanged`，`app.css` 仅有 `.badge-new/.badge-changed`，缺样式 → 退化成橙色/无样式 | 真实缺口 P2 |
| 5 | P0-3 zoneC-Fyi 折叠标题给默认值摘要 | 分区**本身正确**（`attention.mjs:24` 的 `hasDefault` 已过滤，评审"无默认值块混入"不成立）；真实 bug 是 `attention-view.mjs:60+125` 前缀重复渲染成「已为你设好默认（N 项）· 默认已设好（N 项）· …」 | 真实缺口 P2（重定性） |

## 设计原则
- 复用已验证积木：优先用已算好的纯函数（`submitSummary`/`diffSanity`）+ 抽出可单测纯函数，DOM 事件留在 `app.mjs`（不单测，符合现有约定）。
- 零依赖：模态用原生 `<dialog>`；不引任何库。
- 每项配测试：纯逻辑走 `tests/unit`（node:test + 现有 DOM 字符串断言风格）。

## 步骤清单
- [x] **步骤 1 · P0-1 提交确认模态（核心）**
  - `attention.mjs`：新增纯函数 `confirmModel(blocks, answeredIds) -> { decided, acceptedDefaults, unanswered:[{id,title,importance}], importantDefaults:[{id,title}] }`（把 id 映射为含 title/importance 的对象，供 UI 展开）。
  - `app.mjs`：把 `confirm()` 替换为 `<dialog>` 模态——三段（已决 N / 接受默认 M，重要项逐条列 title / 未表态 K，逐条列 title），未表态与重要默认项可点击"跳转到该块"（`scrollIntoView` + 高亮），底部「返回补填」「仍要提交」。
  - `index.html`：加一个空 `<dialog id="confirm-dialog">` 容器（或纯 JS 创建）。
  - `app.css`：模态样式（含暗色）。
  - 测试：`tests/unit/attention-confirm.test.mjs` 断言 `confirmModel` 在有/无未表态、有/无重要默认下的输出结构。
- [x] **步骤 2 · P2 决策进度实时更新**
  - `attention.mjs`：新增纯函数 `countAnsweredDecisions(blocks, draft) -> number`（needsDecision 且 draft 中该块有 verdict|select|text|非空 checklistItems 才算已答；仅评论不算）。
  - `attention-view.mjs`：`statusBar` 两个分支的 `<progress>` 改 `max` 为 `stats.needsDecision`（全部需决策数，与「已填 m/X」同分母），并加 `<span class="decision-count">已填 0/X</span>`。
  - `app.mjs`：新增 `updateDecisionProgress()`，在 `restoreDraftUI` 后与每次决策类 change 事件后调用，更新 `.decision-progress` 的 value 与 `.decision-count` 文案。
  - 测试：`tests/unit/attention-progress.test.mjs` 断言 `countAnsweredDecisions` 计数正确（含"仅评论不计入"）。
- [x] **步骤 3 · P1 议题重组提示（前端消费 sanity）**
  - `app.mjs:loadAndRender`：读 `data.sanity`；`suspect===true` 时在 `$zones` 顶部插入可关闭横幅「⚠️ 本轮议题可能重组，已突出新增/改动项。建议开启『只看变更』对照前后」。
  - `app.css`：`.reintro-banner` 样式。
  - 测试：`diffSanity` 已有单测则复用；补一条 `suspect` 边界断言（若缺）。
- [x] **步骤 4 · P2 徽章样式补齐**
  - `app.css`：新增 `.badge-adopted`（蓝，用 `--color-responded`/蓝）、`.badge-maintained`（灰边）、`.badge-unchanged`（无背景基线）。
  - 测试：`tests/unit/render.test.mjs` 补断言 `changeBadge` 在 `_respondedToPrev` 下输出含 `badge-adopted`/`badge-maintained` 类（验证 diff-view 纯函数；CSS 值本身不单测）。
- [x] **步骤 5 · P2 fyiSummary 前缀重复修复**
  - `attention-view.mjs`：`fyiSummary` 只返回 `item · item` 列表；折叠 `<summary>` 一次性组成「已为你设好默认（N 项）· 列表」，删掉 line 125 的 regex strip 与重复前缀；顺手删 `'（无默认值）'` 死分支（`routeBlocks` 已保证 default!=null）。
  - 测试：`tests/unit/render.test.mjs`（或 attention-view 相应测试）断言折叠标题不含重复「（N 项）」。
- [x] **步骤 6 · 回归**：`npm test` 全绿；更新 `docs/dev-log.md` 记录本批次；`docs/DESIGN.md §13` 对应项标注「已落地 ✓」。

## 影响文件
- 改：`src/protocol/attention.mjs`、`src/render/attention-view.mjs`、`src/render/app.mjs`、`src/render/app.css`、`src/render/index.html`
- 只读依赖：`src/protocol/diff.mjs`、`src/render/diff-view.mjs`、`src/server/server.mjs`（步骤 3 确认无需改服务端）
- 新增测试：`tests/unit/attention-confirm.test.mjs`、`tests/unit/attention-progress.test.mjs`；扩充 `tests/unit/render.test.mjs`
- 文档：`docs/dev-log.md`、`docs/DESIGN.md §13`

## 测试计划
- 单元（node:test，零浏览器）：`confirmModel`、`countAnsweredDecisions`、`diffSanity.suspect`、`changeBadge` 徽章类、`fyiSummary` 无重复前缀。
- 手动冒烟（可选，若你要我起 server）：起 `workbench up`，造一轮含未表态+重要默认+new/changed 的 content，肉眼验证模态可展开跳转、进度条随勾选走动、议题重组横幅出现、徽章配色区分。

## 风险 / 非目标
- 风险：模态改动触及提交主路径——保留"提交失败下载 JSON""409 处理中"等既有分支不动，仅替换确认层。
- 非目标（本批次**不做**，属其它批次）：新增 block 类型（clarification/acceptance-criterion）、embed/proxy 安全加固、真实浏览器 E2E、暗色对比度全面复核、`advanceToRound` 清旧轮草稿（可作为可选加项，见下）。

## 可选加项（低风险、与进度条正确性相关，待你点头才纳入）
- `advanceToRound` 进新轮时清理上一轮 `localStorage` 草稿键，避免旧草稿串味导致进度条/恢复错乱（评审 interaction-flow 项，非 §13）。
