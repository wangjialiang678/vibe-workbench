---
title: Vibe Coding 前的澄清方式（PRD/测试/场景/UI/交互）社区调研 + 本项目独立设计评审
date: 2026-07-02
type: research + review
method: 18-agent workflow（5 路调研 × 反驳式核验 + 4 镜头评审 × 读码去伪）
raw_reports: docs/research/raw/2026-07-02-community-*.md
confidence: 调研整体 medium（UI/交互一路 high）；评审发现均已读码核验
---

# 摘要

两个问题，一份报告：

1. **社区怎么在 Vibe Coding 之前做澄清**——PRD/需求、测试/场景、UI/交互、以及"怎么问"的方法论。
2. **本项目（vibecoding 工作台）从设计/交互角度能改什么**——独立评审，刻意绕开 DESIGN §13 已做过的自审。

> ⚠️ 全篇遵循"声明-来源配对 + 事实/推测分离"。凡被反驳式核验**打过折扣**的结论，直接在正文标注 `【核验修正】`，不藏在附录。别把被修正的数字当事实引用。

**一句话结论**：社区在 2025–2026 已明确收敛到"**先规格、后代码**（Spec-Driven Development）+ 让 AI 先反问澄清 + 测试当护栏"；UI/交互澄清是一条从简报到 token 的**七层链**，AI 时代追加了"参考式 prompt / 截图读结构"。而本项目最大的问题不是缺设计思想（§13 思想很完整），而是**"纸面已采纳、代码未落地"**——§13 清单里一批 P0/P1 只写进了 DESIGN，实现层没跟上；加上**从未在真实浏览器端到端 dogfood 过**，以及若要真正当"澄清工具"还**缺一批 block 类型**。

---

# 第一部分 · 社区调研：Vibe Coding 前该澄清什么、怎么澄清

## 1. PRD / 需求文档（可信度 medium）

### 澄清"什么"——AI-ready 规格的字段共识
行业已基本共识：一份能喂给编码 agent 的规格，应覆盖 **用户故事 + 验收标准（EARS/GWT）+ 非目标(anti-goals) + 技术约束 + 数据模型 + 可测成功指标**。

- **Kiro（AWS）三文件体系**：每个 feature spec 强制 `requirements.md`（用户故事+EARS 验收标准）/ `design.md`（架构+序列图）/ `tasks.md`（可执行任务，逐条追溯需求）。来源：<https://kiro.dev/docs/specs>
  - 【核验修正】发布是 2025-07-15 的 **public preview**（非"正式发布"、非 07-14）；"强制三文件"只对 feature spec 成立，bugfix spec 产出的是 `bugfix.md`。
- **GitHub Spec Kit** 模板三个 *mandatory* 字段：`User Scenarios & Testing`（Given/When/Then）、`Requirements`（FR-001 编号 + `[NEEDS CLARIFICATION]` 标记）、`Success Criteria`（可测量）。来源：<https://github.com/github/spec-kit/blob/main/templates/spec-template.md>（此条核验为 **confirmed**，读原文逐字吻合）
- **EARS** 五类句法（Ubiquitous / Event-driven `When` / State-driven `While` / Optional `Where` / Unwanted `If…then…`）用固定关键词消歧。来源：<https://alistairmavin.com/ears>
  - 【核验修正】EARS 原始论文（RE'09）仅基于 **36 条**高层安全需求，样本极小，对非功能需求覆盖有已知短板；Kiro 内置 EARS 是**可选 format hint**，非对所有验收标准"强制"。
- **anti-goals（非目标）** 被多个实践者列为 AI-friendly PRD 与传统 PRD 的关键差异——不显式排除的功能会被 AI 主动实现。来源：<https://vibecode.fun/learn/how-to-write-prd-for-ai>
  - 【核验修正】"最关键字段"无实证支撑；AI scope creep 更常见的成因是 AI 实现时"顺手优化"（machine-scale boy-scouting），而非 PRD 缺 anti-goals。项目级指令（如 CLAUDE.md 的"只改指定项，其余标注为建议"）被认为更直接有效。参照：<https://medium.com/@pramida.tumma/ai-scope-creep-why-your-pull-requests-are-quietly-getting-bigger-8d2c827667aa>
- **Addy Osmani 六区域**（Commands / Testing / Project structure / Code style / Git workflow / Boundaries，边界分 Always / Ask-first / Never 三层）。来源：<https://addyosmani.com/blog/good-spec/>
  - 【核验修正】"2,500+ 文件分析"其实是 **GitHub** 做的分析、Osmani 二手引用；六区域本身也非固定（他自己的 spec.md 命令列的是另一组）。

### 澄清"怎么做"——方式
- **让 AI 先反问 5–8 个澄清问题再动手**——被多来源称为开始写规格前"最高杠杆的单步"。来源：<https://momoview.com/blog/en/posts/writing-specs-with-ai-spec-driven-workflow/>
  - 【核验修正】"5–8"这个具体数字无出处，"最高杠杆/比任何后期优化都强"是无量化依据的绝对化断言；方向对、程度存疑。
- **分阶段渐进细化**（Brainstorm → Specify → Plan → Tasks → Implement），别把超长规格一次性灌给模型——存在"**诅咒效应/Curse of Instructions**"：指令越多，单条遵守率越低。来源：<https://addyosmani.com/blog/good-spec/>（引 OpenReview 实验）
- **验收标准必须由懂业务的人确认**，不能全托 AI 自动生成（会写出"格式漂亮但偏离业务"的标准）。来源同上 momoview。
- **有争议**：`Spec as source of truth` 在大型多人项目的可维护性有真实反对声——部分人认为代码才是真 truth、规格漂移难免、简单任务 spec 是 overkill。来源：<https://github.com/github/spec-kit/discussions/152>

**成熟度框架**（新兴）：Tessl 提出 Spec-Assisted → Spec-Driven → Spec-as-Source 三阶。来源：<https://tessl.io/blog/how-tessls-products-pioneer-spec-driven-development>

## 2. 测试文档 / 验收标准 / 场景文档（可信度 medium）

**核心范式**：编码前先由人写好验收标准 → 用 Example Mapping 澄清 → 把"测试即合同"喂给 AI 当**自动验收护栏**。

- **Given-When-Then / Gherkin** 是验收标准主流格式；规则：一个 Scenario 只覆盖一个行为，出现多个 When-Then 就拆。来源：<https://automationpanda.com/2017/01/30/bdd-101-writing-good-gherkin>
  - 【核验修正 · 重要】原报告"2024 WQR 显示 60%+ 敏捷团队已采用 BDD"被**证伪**：WQR 的 63% 是"TDD+BDD 合并、认为重要"的比例，非"已采用"；PractiTest《2024 State of Testing》实测 BDD 采用率仅 **26%**。别引用这个 60%。参照：<https://www.practitest.com/assets/pdf/stot-2024.pdf>
- **Example Mapping**（Matt Wynne/Cucumber）：四色卡（故事/规则/示例/问题）+ 25 分钟时间盒；红卡多 = 故事没就绪、不能进开发。这是"编码前澄清"最被推崇的结构化会议。来源：<https://cucumber.io/blog/bdd/example-mapping-introduction>
- **Specification by Example**（Gojko Adzic）：抽象规则必须配具体示例，且示例不含 UI 实现细节、只描述业务意图。来源：<https://less.works/less/technical-excellence/specification-by-example>
- **User Story Mapping**（Jeff Patton/Mike Cohn）：横轴活动序列、纵轴优先级，用来发现 MVP 边界与遗漏场景。来源：<https://www.mountaingoatsoftware.com/blog/user-story-mapping-how-to-create-story-maps>
- **测试当 AI 护栏的落地路径**：ATDD-with-AI（自然语言 GWT 当 prompt 约束 → AI 实现 → 跑验收测试 → 失败反馈回 AI 迭代）。来源：<https://www.paulmduvall.com/atdd-driven-ai-development-how-prompting-and-tests-steer-the-code/>；Uncle Bob 的 empire-2025 用"双流测试+变异测试"约束 Claude Code、防 AI 反手改测试迁就 bug 代码。来源：<https://github.com/unclebob/empire-2025>
  - 【核验修正】empire-2025 是"有影响力的早期实践参考"，不是可量化的"最广泛引用"。
- **有争议 · 自我庆贺循环**：AI 既写代码又写测试会共享同一误解，测试绿但逻辑错；对策是 Property-Based Testing + 人工审核。来源：<https://arxiv.org/pdf/2405.10849>
  - 【核验修正】该论文是 XP'24 研讨会的**初步探索实验**（样本小、非同行评审完整论文），现象成立但证明力弱于原表述。

## 3. UI / 交互设计的澄清方式（可信度 high — 本路核验后最扎实）

**七层澄清链**（从抽象愿景到可执行规格）：
> 设计简报 Design Brief → 情绪板/参考图 Mood Board → 信息架构（卡片分类）/用户流程图 → 低保真线框 Wireframe → 高保真原型 Prototype → 交互规格 Interaction Spec → 设计 Token / 设计系统

- **Design Brief**（目标用户、SMART 目标、交付物、约束、竞品参考）是起点。来源：<https://ixdf.org/literature/topics/design-briefs>
  - 【核验修正】"缺任一组件必致 scope creep"是过度因果化（scope creep 成因多维）；对内部工具"竞品参考"未必必要。
- **Mood Board** 在 brief 之后、原型之前，用视觉集合消除"我以为是这种风格"的分歧。来源：<https://www.nngroup.com/articles/mood-boards>
- **信息架构**用 Card Sorting（揭示心智模型）+ Tree Testing（验证标签可理解）。来源：<https://www.nngroup.com/articles/card-sorting-definition>
- **交互规格要精确到数值**（如 `transition: background-color 150ms ease-out`），别用"顺滑过渡"；组件覆盖 default/hover/active/focus/disabled/loading/error 等状态。来源：<https://www.gokhanmeric.com/blog/design-to-code-handoff-2026-workflow-that-actually-works/>
  - 【核验修正】"必须 7 种状态""统一 150ms"是任意枚举/绝对化：不同组件状态集不同（按钮无 error、输入框需 success），数值随状态类型而异。权威参照 NN/g 按钮状态：<https://www.nngroup.com/articles/button-states-communicate-interaction>
- **设计 Token 三层**（primitive → semantic → component）。来源：<https://lenkastudio.com/blog/how-to-build-design-handoff-workflow-developers-love>
  - 【核验修正】"必须 Figma 与 CSS 完全同名"站不住——业界靠 Style Dictionary 做命名转换、刻意解耦；三层对简单应用可能 overkill（两层起步）。参照 Martin Fowler：<https://martinfowler.com/articles/design-token-based-ui-architecture.html>

**AI 时代新增两条路径**（均为"新兴"）：
- **参考式 prompt > 描述式**："Build in the visual style of Linear — dense hierarchy, monochrome" 远优于 "clean, professional"；不显式指定颜色/圆角/字体/密度/状态，AI 默认落入 Inter + indigo + comfortable 的"通用相"。来源：<https://www.mindstudio.ai/blog/claude-design-avoid-generic-ai-aesthetics>
- **截图驱动（screenshot-to-code）要"读结构、忽略美学、套新风格"**，否则 AI 会复制线框的灰阶外观；text-augmented（截图+文字）比纯图稳。来源：<https://arxiv.org/html/2410.16232>（Sketch2Code, NAACL 2025）
- **Jakob Nielsen 的 Prompt Augmentation 六模式**（Style Galleries / Prompt Rewrite / Targeted Rewrite / Related Prompts / Prompt Builders / Parametrization）解决"用户说不清想要什么"的表达障碍。来源：<https://www.uxtigers.com/post/prompt-augmentation>
- 交接已从"单次移交"变"持续过程"；复杂动效用 90s Loom 录屏比三段文字规格更有效。来源：<https://www.figma.com/blog/the-designers-handbook-for-developer-handoff/>

## 4. "怎么问"——需求消歧方法论（可信度 medium）

- **每轮只问一个最高信息增益的问题**（一次问一堆会让人只答最后一个）。来源：<https://arxiv.org/html/2409.06097v2>（ClarQ-LLM）
  - 【核验修正 · 重要】这**有有效反例**：FATA（<https://arxiv.org/html/2508.08308v1>）用"单轮一次性给全部澄清问题"，基准上比 baseline 高约 40%。所以"一次一个"应限定在**人类对话/传统聊天机器人**语境；**异步、可批注**场景（正是本工作台！）反而适合"一次性结构化列出多个问题让用户异步答"。
- **Active Task Disambiguation**（ICLR 2025 Spotlight）：把 LLM 选问建模为 Bayesian 实验设计，选期望信息增益(EIG)最大的问题。来源：<https://openreview.net/forum?id=JAMxRSXLFz>
- **Assumption Mapping**（重要性 × 不确定性四象限）锁定最该澄清的高风险假设。来源：<https://maze.co/blog/assumption-mapping>
- **5 Whys**（原设计就是挖"为何要这个特性"，非仅故障根因）、**JTBD Job Story**（When…/I want…/So I can…）、**Event Storming** 三层工作坊、**设计思维 Empathize-Define**。来源：<https://en.wikipedia.org/wiki/Five_whys> · <https://jtbdtoolkit.medium.com/job-stories-revisited-13ad0b54eb3c> · <https://www.qlerify.com/post/why-event-storming> · <https://ixdf.org/literature/article/5-stages-in-the-design-thinking-process>
- **何时停止澄清**：Bezos 70% 法则（信息到七成就决策、快纠错胜过慢等待）；停止信号=信息冗余/无新高优需求/业务价值路径已被无歧义需求支撑。来源：<https://www.forbes.com/sites/eriklarson/2018/09/24/how-jeff-bezos-uses-faster-better-decisions-to-keep-amazon-innovating> · <https://www.long-intl.com/articles/defining-requirements>
  - 【核验修正】原报告引的 JAD/Workshop 对比数据（4.6 vs 3.8…）来自疑似掠夺性期刊 FMDB、单项目双案例无统计检验，**降级为初步案例证据**，别当共识引用。

## 5. HITL / Vibe Coding 社区实践与反思（可信度 medium）

- **vibe coding**：Karpathy 2025-02-02 定义（"全交给 vibes、不读 diff、随性接受"），定位是个人/一次性项目。来源：<https://x.com/karpathy/status/1886192184808149383>
- **"spec over vibe"回潮**：2025 生产事故频发（Retool 2026：93% 技术/安全高管担忧、22% 组织近一年至少一次 AI 生成工具事故），催生 Kiro（Spec/Vibe 双模式）、Spec Kit、SDD。来源：<https://retool.com/blog/ai-governance-report-2026>
- Karpathy 2026-02 提 **agentic engineering**，把人定位为 "orchestrator + oversight"。来源：<https://x.com/karpathy/status/2019137879310836075>
  - 【核验修正】不是"替代"——他明确说 vibe coding "raises the floor"、agentic engineering "raises the ceiling"，两者**并列共存**。
- **Plan-then-Execute 是主流 HITL 模式**：计划阶段只读不改、人批准后才执行（Cursor Plan Mode、Claude Code /plan）。来源：<https://cursor.com/blog/plan-mode>
  - 【核验修正】原报告"Claude Code 7 级权限"**错误**：官方是 5 种 permissionMode（default/acceptEdits/plan/auto/dontAsk）+ 独立 bypassPermissions。参照：<https://code.claude.com/docs/en/permissions>
- 其他确认模式：Devin 置信度门控（非绿自动等批准）、v0 用 Git PR + diff view。来源：<https://docs.devin.ai/release-notes/2025> · <https://vercel.com/blog/introducing-the-new-v0>
  - 【核验修正】Kiro 的"逐步签字"来自 **Supervised 执行模式**，与 Vibe/Spec **会话类型正交**（Spec 也能 Autopilot 无人跑）。别把"Spec=需签字"画等号。参照：<https://kiro.dev/docs/chat/autopilot>
- **认知负荷新研究（新兴、待同行评审）**：BCG "AI brain fry"——第 4 个 agent 起生产力下降；CHI 2026——与编码 agent 交互时认知参与度随时间衰减，建议引入"认知强制设计(cognitive forcing)"。来源：<https://builtin.com/articles/ai-brain-fry-software-developers> · CHI'26 workshop 预印本

> **这一路直接印证了本工作台的立项主张**（"编排注意力 > 渲染内容"、决策点上浮/默认下沉、异步唤醒）。业界确实在往"人做编排与验证、agent 做执行、UI 负责把该看的抬上来"走——本项目方向正确。

---

# 第二部分 · 本项目独立评审（设计 / 交互）

> 方法：4 镜头（端到端闭环 / 信息架构·视觉·可访问性 / **澄清能力契合度** / 逆向弱点）各自读码评审，再由独立核验员读 DESIGN §13 + 源码逐条去伪。下面只收**读码核验为 real 的**发现，按主题聚合。完整 50 条见 workflow 原始输出。

## 元发现 A（最重要）：§13 是"纸面已采纳"，实现层系统性欠账
DESIGN §13 的 UX 自审思想很完整，但多条采纳项**只写进了文档、代码没落地或没接通**。这不是"又发现一个 bug"，而是一种**文档-实现漂移**的系统性风险——它会让"118 测试全绿 + §13 全采纳"给人"已完成"的错觉。核验确认的具体断点：

| §13 承诺 | 实现现状（已读码核验） | 位置 |
|---|---|---|
| P0-1 提交前"可就地展开复核"未表态/重要默认项 | 只用原生 `confirm()` 弹纯文本、只列 blockId，**无法展开** | `app.mjs:759-777` |
| P2 长页面"进度 已填 m/X" | `<progress>` 的 `value` 恒为 0、无 JS 更新，进度条永远空 | `attention-view.mjs:32,42` |
| P1 diff"议题重组提示" | `diffSanity()` 算出了 suspect，但 server 未注入、前端无代码消费 | `diff.mjs:40-46` → `server.mjs` → `app.mjs` |
| P1 diff"已采纳↩/维持—"徽章 | `diff-view.mjs` 定义了 `.badge-adopted/.badge-maintained`，`app.css` **无对应样式**，视觉上退化成橙色 changed | `diff-view.mjs:23-31` / `app.css` |
| P0-3 zoneCFyi 折叠标题"给默认值摘要" | 无默认值的块被分进 C-Fyi，摘要显示"（无默认值）"，暴露 `routeBlocks()` 分区边界问题 | `attention.mjs:24` / `attention-view.mjs:52-127` |

> 建议把这些当一个"**§13 落地校验**"批次统一清账，并补一条规矩：§13 类"已采纳"项必须有对应测试断言，防止再次纸面化。

## 元发现 B：从未真实浏览器 dogfood，"完成"宣称偏乐观（P0）
118 测试全是黑盒 unit/e2e（mock driver、无浏览器渲染）。而 `feedback-log.md` 记录的两个已知 P0/P1 bug（静态 404、AI 思考被折叠）**恰恰只有真实浏览器才暴露**——说明前端渲染/交互（blocks→HTML、注意力分区滚动、embed 选区/FAB、异步唤醒整链 render→submit→listen→exec→poll）目前零端到端验证。`README` 的"MVP 全量实现完成"宜降调为"think-discuss 单场景已验证，浏览器 E2E 待补"。建议：Playwright 跑 `scenarios.md` 五场景冒烟 + 视觉回归。

## 澄清能力契合度：想当"Vibe Coding 前澄清工具"，block 词汇表不够（**最贴合你的初衷**）
把第一部分的社区最佳实践逐项对照现有 block 类型（markdown/diagram/choice/verdict/freetext/editable/table/code/embed），**缺口清单**（均已核验为 real）：

| 想澄清的东西 | 社区实践 | 现在只能怎么凑 | 建议新增 block |
|---|---|---|---|
| 澄清问题 ↔ 答案的**可追溯**配对 | Active Task Disambiguation / 一次性多问 | 塞进 markdown/freetext，断了追溯 | `clarification`（question/whyAsking/precedence/answered/answer） |
| 验收标准的**分段交互** | GWT / Example Mapping | 压进 `code(gherkin)` 纯文本，无法对单个 When/Then 表态 | `acceptance-criterion`（given[]/when[]/then[]，逐段可批注） |
| UI 视觉澄清（情绪板/参考图/简报） | Mood Board / Design Brief | 只能一张张 embed（还要公网 URL） | `reference-gallery`（多图并排分组批注）+ `design-brief`（结构化表单） |
| 组件**状态矩阵**/交互规格 | 7 态 + token + 转场 | choice/verdict 只能单态决策 | `component-spec`（states/transitions/token 值） |
| 高风险**假设**聚焦 | Assumption Mapping（重要×不确定） | 无 | `assumption-map` |
| 显式**局限/风险**声明并确认 | SDD constraints/limitations | 塞 markdown、无法"已知并接受" | `constraints-and-risks`（逐行 verdict） |
| 规格**就绪度门控** | Kiro/Spec Kit mandatory 字段检查 | 无（只有表态完整性检查） | `spec.validateReadiness()`（提交时软提示缺 FR/测试/数据模型） |
| 跨轮**澄清历史**追溯 | 迭代确认 | feedback/response 线性追加、无引用 | block 增 `respondingTo?` 字段 + 前端"↩ 回复第 N 轮"链接 |

> 结论：现在的协议擅长"**对已成形的方案做结构化决策/评审**"，但对"**从模糊到清晰的前置澄清**"（问问题、收假设、对齐视觉、写验收）表达力不足。若定位是"Vibe Coding 前澄清台"，上面 2–3 个 block（尤其 `clarification` 与 `acceptance-criterion`）是最高杠杆。另注意第一部分核验的洞察：本工作台是**异步可批注**载体，恰好适合"一次性列多个澄清问题让用户异步答"（FATA 路线），不必拘泥"一次一个"。

## embed / proxy 是最脆弱子系统（多镜头独立命中）
- **quote 定位脆弱**：`iframe.contentWindow.find(quote)` 只匹配第一个出现处，重复文案/大小写/空格敏感，代理还可能重写了 id/class；高亮用 CSS Custom Highlight API 失败静默 → 刷新后批注可能锚错段落。`app.mjs:413-426`（real-new）
- **CSP 去除不完整**：只删了 `<meta>` 里的 X-Frame-Options，**没处理 HTTP 响应头的 CSP**（多数站点走响应头）；注入的 `<base href>` 会劫持目标页 fetch 同源 API；目标页 JS 未沙箱化，追踪脚本在 proxy 域下执行；10s 超时对真实 Web 应用过短。`server.mjs:95-112,219-244`（real-new）
- **SSRF/无速率限制**：`/api/proxy` 只校验 `^https?://` 前缀，可打内网（`127.0.0.1:6379` 等），无 allowlist、无限流、无审计。建议白名单 + 拒绝内网 CIDR + 超时/大小限制。（real-new）
- **移动端评论栏不能滚**：`@media max-width:800px` 把 `.embed-rail` 从 sticky 改 static 却没补 `overflow-y:auto`，窄屏下评论被底部按钮遮挡。`app.css:768-771`（real-new）

> 建议：DESIGN §14 增一节"Limitations & Alternatives"，诚实声明"只可靠支持静态展示页"，并对交互/支付页给 `iframe sandbox` 或原生 iframe 的替代路径。

## 可访问性 / 视觉具体缺陷（均 real-new / real-partly）
- **暗色对比度未达 WCAG AA**：`--color-text-muted #9ca3af` on `#111827` ≈ 4.2:1（<4.5），zoneC-Fyi 标题 `#6b7280` 偏低。`app.css:35-51`
- **形状图标无障碍关联弱**：`◆/◇/＋/～` 用 `aria-hidden`，与相邻标题语义未程序化关联；diff 徽章 `aria-label`（"新增"）与展示文案（"＋NEW"）不一致。
- **顶栏高度硬编码**：`.embed-rail { top: 64px }` 假设固定高度，标签换行/缩放时会与顶栏重叠——应改 CSS 变量或动态测量。

## 逆向弱点（诚实清单）
- **并发/单用户假设未声明**：同轮多次提交会互相覆盖 feedback.json、"最后提交胜出"未定义为需求；`Object.entries` 遍历顺序决定同块多 item 顺序，不确定。多用户共会话（phase 2）会翻倍。建议提交幂等 + 内容 hash 校验 + DESIGN 增"并发提交安全"一节。（real-partly）
- **异步等待缺认知反馈**：处理中徽章无进度动画、不显示已等待时长（读了 state 没读 claimedAt）、`document.title` 处理中不变角标——对照 CHI 2026"等待中认知参与度衰减"，5–10s 无反馈显著掉信任。建议脉冲动画 + "已等待 Xs" + 超阈值降级提示。
- **"通用框架"通用性仅一例验证**：PRD 自己写"暂不做 dev-review 重建"，即通用性目前是"希望"而非"事实"。要么落一个最小 dev-review 证明协议真通用，要么把宣称从"通用框架"收敛为"think-discuss 共创台"。（此条核验为 unverified，作为观点保留）

---

# 附：可落地的下一步（供 PLAN 阶段挑选）
1. **§13 落地校验批次**（元发现 A 的 5 项）——纯欠账、性价比最高，且每项都能补测试。
2. **`clarification` + `acceptance-criterion` 两个 block**——把工作台从"评审台"补齐为"澄清台"，直接对上你的初衷。
3. **embed/proxy 加固**——SSRF allowlist + 响应头 CSP + 移动端滚动 + §14 局限声明。
4. **真实浏览器 E2E（Playwright）冒烟**——消除"完成"错觉。
5. **暗色对比度 + 无障碍 aria** 修一轮。

---

## 来源汇总（去重）
见各条正文内联 URL；完整原始笔记与更多来源见：
- `docs/research/raw/2026-07-02-community-spec-prd.md`
- `docs/research/raw/2026-07-02-community-test-scenario.md`
- `docs/research/raw/2026-07-02-community-ui-interaction-clarify.md`
- `docs/research/raw/2026-07-02-community-hitl-vibecoding.md`
- `docs/research/raw/2026-07-02-community-elicitation-method.md`
