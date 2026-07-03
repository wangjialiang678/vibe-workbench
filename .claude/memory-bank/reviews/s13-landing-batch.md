# REVIEW：§13 落地校验批次（2026-07-03）

配套计划：`.claude/memory-bank/plans/s13-landing-batch.md`（STATUS: DONE）

## 实现 vs 计划：偏差核对
| 计划步骤 | 实现 | 偏差 |
|---|---|---|
| 1 提交确认模态 | `<dialog>` + `confirmModel` 纯函数 + 无 dialog 降级回 `confirm` | 无 |
| 2 进度实时更新 | `pendingDecisionBlocks`/`countAnsweredDecisions` + 委托监听 `$zones` | 无 |
| 3 议题重组横幅 | 前端消费 `data.sanity.suspect`（服务端本已回传，未改服务端） | 无（如计划预判） |
| 4 徽章 CSS | `.badge-adopted/.badge-maintained/.badge-unchanged` | 无 |
| 5 zoneC-Fyi 摘要 | **重定性**：分区无 bug，真实缺陷是前缀重复 → 修 `fyiSummary` | 计划已记录此重定性 |
| 6 回归/文档 | 234 pass、dev-log、DESIGN §13 标注 | 无 |

**唯一功能性偏差**：计划把步骤 5 当"分区边界 bug"，实际读码发现 `routeBlocks` 的 `hasDefault` 已正确过滤，真实 bug 是折叠标题前缀重复。已在计划与 dev-log 中如实记录（对抗了评审子代理的原始误判）。

## 测试覆盖
- 新增：`attention-confirm.test.mjs`(5)、`attention-progress.test.mjs`(5)；扩 `render.test.mjs`(4：徽章类×2、进度文字、无重复前缀)。
- 全量：`npm test` 234 pass / 0 fail（批次前 220 → +14）；3 个改动 .mjs `node --check` 通过。
- 缺口（已知，属其它批次）：真实浏览器 E2E 未覆盖模态/进度/横幅的 DOM 行为——纯函数与渲染字符串已测，DOM 事件（app.mjs）沿用项目既有"入口不单测"约定。

## 独立复审（Reviewer 子代理，只读）结论
6 个对抗性核查点**全部成立**：
1. ✅ 事件顺序——所有 `saveDraft` 绑在子元素、无 capture，冒泡保证 `updateDecisionProgress` 后触发，进度不慢拍。
2. ✅ 模态提交路径——`doSubmit` 未改，409/下载兜底/断连分支完好；Escape 仅 close 不误提交；无 dialog 环境降级 `confirm`。
3. ✅ 进度分母一致——`max` / `data-total` / `countAnsweredDecisions` 三处同源 `pendingDecisionBlocks`，不越界。
4. ✅ fyiSummary——单次转义、无重复前缀；`routeBlocks` 保证 `default != null`。
5. ✅ jumpToBlock——`querySelector` 按文档顺序返回外层 `<section>`（非内层按钮）。
6. ✅ XSS——`confirmDialogHtml` 的 title/default/id 均 `escapeHtml/escapeAttr`；`reintroBannerHtml` 纯静态。

**采纳的 1 条建议**：`jumpToBlock` 选择器加 `CSS.escape(id)` 防守（id 含特殊字符时不失效）——已应用（app.mjs），复跑 234 green。

## 结论
批次达成计划目标：§13 五项纸面欠账全部落地并加测试断言，确立了"§13 采纳项须有测试"的护栏。无严重问题遗留。下一步候选（未启动）：新 block 类型（clarification/acceptance-criterion）、embed/proxy 安全加固、真实浏览器 E2E。
