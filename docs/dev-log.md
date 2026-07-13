# Dev Log

## Phase 1: Init
- 2026-06-30 PRD/DESIGN/scenarios 完成；UX 自审采纳 3×P0 + 多 P1（见 DESIGN §13 / feedback-log）。
- protocol 基座（constants/schema/diff/attention/status）+ 单测 14/14 绿。前端安全：attention/status/constants 无 node 依赖；schema/diff 服务端（crypto）。
- 偏差记录：auto-dev 自动续跑 Stop hook 未部署（避免未知钩子 runaway），改由子代理通知驱动续跑；并行采用"同树·互斥文件"而非 worktree（文件按目录完全互斥，零冲突，省 merge）。

## Phase 2: Development Verification（5 路并行 TDD，子代理各自跑绿，主代理独立复核）

| Task | 文件 | 子代理测试 | 主代理复核 |
|------|------|-----------|-----------|
| feat-server | src/server/server.mjs | 12 pass | 全量重跑含其用例，绿 |
| feat-loop | src/loop/{listener,claude-exec,session-store}.mjs | 27 pass | 同上 |
| feat-render | src/render/* | 33 pass | 同上 |
| feat-templates | templates/{think-discuss,dev-review}.mjs | 20 pass | 同上 |
| feat-bin | bin/workbench.mjs | 7 pass | 同上 |

## Phase 3: Integration Verification

| Action | P0 | P1 | Details |
|--------|----|----|---------|
| 全量 node --test | ✅ exit 0 | — | 115→118 pass / 0 fail（含集成 3） |
| 端到端集成 integration.test.mjs | ✅ | ✅ | S1 往返 / S5 崩溃→retry→恢复 / 幂等，绿 |
| 真实启动冒烟 | ✅ | — | health/302/page/app/css/protocol 全 200，content 注入 _change |
| 集成缺陷修复 | — | ✅ | bin↔server 契约：startServer 传数字（原误传对象）→ 修复（预算内 1/10） |
| 解析校验 | ✅ | — | 19 个 .mjs 全 node --check 过；app.mjs 导入解析到位 |

最终：118 自动化测试 + 端到端集成全绿，退出码 0。详见 docs/delivery-report.md。

## 批次 5：PRD Review Studio 迁移收尾（2026-07-02，DESIGN §1.5/§1.6/§1.7）

- 新增 `scripts/import-prd-project.mjs`：读取 prd-review-studio 的 `demo.js`（用正则+Function 沙箱取出 `window.PROJECT_DATA`），按 §1.3 六面映射逐面生成 Vibe block 数组，落成 `workspace/imported-demo/round-1/content.json`（19 个 blocks，类型：verdict/diagram/choice/code/checklist/prototype）；运行 `validateContent` 校验全部通过（ok: true）。
- PRD Review Studio README 顶部加【已弃用 Deprecated】段，说明功能已并入 Vibe Workbench、仓库停止维护仅存档；无文件删除。
- 迁移完成说明：PRD 六面已全量导入并通过 schema 校验（§1.7 判据 1 达成）。
- 注意：§1.7"需真实 ≥2 轮评审"（判据 4）留待用户在 Vibe Workbench 上完整走完后确认；定位批注（判据 2）依赖批次 4（构建步骤 + Annotorious）尚未启动；completeness checklist 提交（判据 3）可在当前渲染层验证。
- node --test：209 pass / 0 fail（全量累积，无回归）。

## 批次 6：§13 落地校验（2026-07-03，DESIGN §13 纸面→代码对账）

背景：调研+独立评审（docs/research/2026-07-02-hci-...-review.md「元发现 A」）发现 §13 多条采纳项只写进文档、实现层断了。本批次逐条补齐 + 加测试断言，防再次纸面化。

| 项 | §13 出处 | 修法 | 文件 |
|----|----------|------|------|
| P0-1 提交确认可就地展开/跳转补填 | §13 P0-1 | `confirm()` → 原生 `<dialog>` 模态：已决/接受默认（重要项逐条列 title+默认值）/未表态（逐条 title+可跳转，重要标红）；新增纯函数 `confirmModel`；无 `<dialog>` 环境降级回 `confirm` | attention.mjs, app.mjs, index.html, app.css |
| P2 决策进度「已填 m/X」 | §13 P2 | `<progress>` 分母改本轮待决策数（`pendingDecisionBlocks`=needsDecision且非unchanged）+ 加 `.decision-count` 文字；`countAnsweredDecisions` 计已决数；委托监听 `$zones` 实时刷新 | attention.mjs, attention-view.mjs, app.mjs, app.css |
| P1 议题重组提示 | §13 P1 | 服务端本已回传 `sanity`（无需改）；前端 `loadAndRender` 消费 `sanity.suspect`→顶部可关闭横幅 `.reintro-banner` | app.mjs, app.css |
| P2「↩已采纳/—维持」徽章 | §13 P1 改动E | 补 `.badge-adopted`(蓝)/`.badge-maintained`(灰边)/`.badge-unchanged` 样式（原仅 new/changed） | app.css |
| P2 zoneC-Fyi 折叠标题前缀重复 | §13 P0-3 | 修 `fyiSummary` 双前缀 bug（原渲染成「已为你设好默认（N）· 默认已设好（N）· …」）；删死分支「（无默认值）」。**注：评审所指"无默认值块混入分区"经读码不成立——`routeBlocks` 的 `hasDefault` 已正确过滤** | attention-view.mjs |

测试：新增 `tests/unit/attention-confirm.test.mjs`(5) + `attention-progress.test.mjs`(5) + 扩 `render.test.mjs`(徽章类/进度文字/无重复前缀 4 条)。
结果：`npm test` 234 pass / 0 fail（较批次前 +14），三个改动文件 `node --check` 通过。
未做（属其它批次）：新 block 类型、embed/proxy 安全加固、真实浏览器 E2E、暗色对比度全面复核。

## 批次 7：tab 分面导航（2026-07-04，DESIGN §15）

用户要求 restore prd-studio 六面 tab 体验（真·切换），并加防漏看角标；本批次落地。

| 能力 | 实现 | 文件 |
|------|------|------|
| 块 `section` 字段 + `content.sections` | 无需改 schema（validateBlock 宽容）；不进 fingerprint | constants(DEFAULT_SECTIONS/MISC) |
| 分组/统计/拆分 | groupBySection / sectionPendingStats / hasSections；confirmModel 拆 unansweredMust/Optional | src/protocol/attention.mjs |
| tab 渲染 | 抽 renderZoneBody(blocks,sfx)；faceted 时 tabBar + 每面 facet(zone id 加 -f<i>)；空面灰 tab；无 section 向后兼容 | src/render/attention-view.mjs |
| tab 交互 | activateFacet / activateDefaultFacet(第一个含必须决策的面) / updateFacetBadges(红橙绿) / 委托点击；jumpToBlock 跨面激活 | src/render/app.mjs |
| 提交必须决策警示 | 弹层顶部红字「⚠️ 还有 X 个必须决策的点没确定」+ 主按钮「仍要提交」；fallback confirm 同步 | src/render/app.mjs |
| 样式 | .tab-nav(sticky) / .tab(active/empty) / .tab-badge(must红/optional橙/done绿) / .confirm-must-warn | src/render/app.css |
| 模板 section | dev-review(需求/架构/测试)、design-review(screen.section 默认 UI 设计, checklist→测试) | templates/ |

- **面内顺序**：设计方案(zoneContext)→必须(zoneA)→可接受(zoneB)→默认(zoneC)→沉降，复用 renderZoneBody。
- **防盲签**：角标常显未确认 + 全局进度跨面 + 提交弹层跨面列出并自动切 tab 跳转 + 必须决策红字警示。
- 测试：新增 `tests/unit/facet-nav.test.mjs`(8) + render(4) + templates(2)；`npm test` 248 pass / 0 fail。
- **真实浏览器 dogfood**（Playwright 无头截图 facet-demo）：tab 栏/红角标/空面变灰/默认激活/面内顺序 全部符合规格 ✓——首次真机验证前端交互（补上此前评审指出的 E2E 缺口）。

## 批次 8：user-vibeloop 实战反馈全量落地（2026-07-13，DESIGN §16）

`docs/iteration-brief-2026-07-13.md` 7 项全做 + 富渲染最后一公里。病例集当 fixture。

| 项 | 实现 | 文件 |
|---|---|---|
| **P0** embed 代理不转发 POST（实证 bug） | 代理支持 GET/POST/PUT/DELETE，透传 method/body/CT，回传真实状态码；form action + fetch/XHR 改写回代理通道 | `server/server.mjs` |
| **P1** 决策块结构化（创始人加权最高） | `background`/`why`/`options[].pros`/`.cons`/`recommendReason` + 四段固定次序渲染 + 进 fingerprint | `blocks.mjs` `schema.mjs` |
| **P1** 作者侧 lint（warn 不阻断） | 7 规则全部对应真实病例；`present` 时打 stderr | `protocol/lint.mjs` `bin/workbench.mjs` |
| **P1** 会话级留言 | 常驻输入区 → `feedback.sessionComment`；feedbackToMd 置顶 | `index.html` `app.mjs` `schema.mjs` `server.mjs` |
| **P1** live 实时系统标识 | `live:true` → 红框 + ⚡角标（视觉层，不靠文案） | `blocks.mjs` `app.css` |
| **P2** 受众分层 | `audience:'tech'` → 折叠进「🔧 技术细节」 | `blocks.mjs` `app.css` |
| **P2** 确认低摩擦 | editable「✓ 保持原样即确认」→ `type:'confirm'`（看了不改）≠ `unanswered`（没看） | `blocks.mjs` `app.mjs` `attention.mjs` |
| **P3** 术语一致性 | `docs/authoring-guide.md`（大白话原则 + 术语表 + 内容基准 + lint 速查） | docs |
| 富渲染最后一公里 | import 补 `convertUI`(ui→prototype iframe) + `frame:'phone'` 手机壳 + 自动打 section + `?facet=` 深链 | `scripts/import-prd-project.mjs` `blocks.mjs` `app.css` `app.mjs` |

- 测试：`lint.test.mjs`(8) + render(5) + protocol(3) + attention(1) + server P0 回归(4)；`npm test` **268 pass / 0 fail**。
- **实证**：把 prd-studio 的 recorder-app 真实数据导进 Vibe → 65 块 / 六面全满（需求22·架构11·**UI设计10**·交互设计4·测试14·风险4）；浏览器 dogfood 确认 **10 个高保真手机屏在手机壳里正常渲染 + 可落 pin 批注**。
- **lint 实战命中**：该份 recorder-app 的决策块**全部缺 background/why** —— 正是创始人抱怨的"没背景"病根，lint 一次全抓出来。
