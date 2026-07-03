---
title: AI 编码前的测试文档与验收标准写法
date: 2026-07-02
topic: test-scenario
status: active
audience: both
tags: [research, BDD, Gherkin, acceptance-criteria, ATDD, TDD, AI-coding, Example-Mapping, specification-by-example]
type: 原始调研
sources:
  - cucumber.io
  - automationpanda.com
  - medium.com/@mattwynne
  - arxiv.org
  - github.com/unclebob/empire-2025
  - github.com/swingerman/disciplined-agentic-engineering
  - hlluan.com
  - ubos.tech
  - testkube.io
  - less.works
verified: 2026-07-02
shelf_life: 需定期更新
---

# 调研报告: AI 编码前的测试文档与验收标准写法

**日期**: 2026-07-02
**任务**: 调研 AI 编码前应澄清什么、如何编写测试文档/验收标准/场景用例；重点覆盖 Given-When-Then/Gherkin/BDD、Example Mapping、Specification by Example、User Story Mapping、Job Stories，以及测试作为 AI 验收护栏的社区实践。

---

## 调研摘要

在 AI 辅助编码时代，"测试即规格（Tests as Specification）"已从理论走向工程实践。社区共识是：先用人写验收标准（Given-When-Then 场景）锁定行为契约，再让 AI 生成实现，由测试套件做自动验收护栏——这直接来自 BDD/ATDD/SBE 这三个互相交织的流派。Uncle Bob（Robert C. Martin）在 empire-2025 项目中用"双流测试（验收+单元）+ 变异测试"约束 Claude Code，成为最广泛引用的 agentic AI 实践案例。学术界同步出现 TENET、TDAD、Property-Based Testing 等多条技术路线，共同指向"在生成代码之前，测试必须先存在"。

---

## 一、验收标准写法：Given-When-Then / Gherkin / BDD

### 1.1 核心格式

Given-When-Then（GWT）来自 BDD 方法论，由 Dan North 提出，使用 Cucumber 的 Gherkin 领域特定语言落地。格式：

```gherkin
Scenario: <场景名>
  Given <初始上下文/前提条件>
  When  <触发的动作或事件>
  Then  <预期结果>
  And   <补充条件（可选）>
```

**已验证事实**：2024 World Quality Report 显示，超过 60% 的敏捷团队已采用 BDD 实践。
来源：https://testquality.com/how-to-write-effective-gherkin-acceptance-criteria

### 1.2 好的 Gherkin 黄金法则（Andy Knight / Automation Panda）

- **Cardinal Rule of BDD**：每个场景只覆盖一个行为（One scenario = One behavior）。
- 若出现多个 When-Then 对，应拆分成多个场景。
- 步骤应用业务领域语言，而非低层 UI 交互细节（"用户搜索了商品" 而非 "用户点击了第 3 个输入框"）。
- 用 Scenario Outline + Examples 处理同一规则的多数据集。
- 按场景前置-动作-结果严格排序，不允许 Given 出现在 When/Then 之后。

来源：https://automationpanda.com/2017/01/30/bdd-101-writing-good-gherkin

### 1.3 每个用户故事应有多少验收标准

社区共识：1-3 条。超过 4 条通常意味着故事太大，应拆分。
来源：https://testquality.com/how-to-write-effective-gherkin-acceptance-criteria

### 1.4 验收标准的两种主流格式

1. **场景导向（Gherkin/GWT）**：适合复杂业务规则，可直接自动化。
2. **规则导向（Rule-based）**：简洁陈述约束，如"密码长度不少于 8 位"。

两种格式可混用，复杂行为用 GWT，简单约束用规则列表。
来源：https://www.altexsoft.com/blog/acceptance-criteria-purposes-formats-and-best-practices

---

## 二、编码前应澄清什么

### 2.1 三类核心问题（来自 BDD 三剑客角色）

在编写 Gherkin 之前，三剑客（开发、测试、产品）需澄清：

| 角色 | 核心问题 |
|------|----------|
| 产品（What） | 这个功能解决什么业务问题？成功看起来是什么样？ |
| 开发（How） | 有哪些技术约束？依赖哪些系统或 API？ |
| 测试（What if）| 边界条件是什么？异常路径有哪些？哪些情况在本次范围之外？ |

来源：https://www.bmc.com/blogs/behavior-driven-development-bdd

### 2.2 Example Mapping 技法（Matt Wynne / Cucumber）

**这是将澄清会议结构化的最高效工具**，Matt Wynne 于 2015 年提出。

用四色卡片完成 25 分钟时间盒会议：
- **黄卡**：用户故事本身（顶部）
- **蓝卡**：每条验收规则（Rule），列在黄卡下方
- **绿卡**：每条规则的具体示例（Example），列在蓝卡下方
- **红卡**：未能当场解答的问题（Question），放一侧

关键洞察：
- 红卡数量多 = 故事还未就绪，不宜拉入开发。
- Example Mapping 的目的是**对话和理解**，而不是当场写 Gherkin——写 Gherkin 应在会议之后由开发/测试完成。
- 25 分钟内无法完成 = 故事太大或不确定性太高。

来源：https://cucumber.io/blog/bdd/example-mapping-introduction（官方一手来源）
来源：https://medium.com/@mattwynne/introducing-example-mapping-42ccd15f8adf（作者原帖）

---

## 三、场景/用户故事/Use Case 写法

### 3.1 User Story Mapping（Jeff Patton）

**结构**：横轴 = 用户活动（按时间序），纵轴 = 详细程度（优先级分层）。

用途：发现用户完成目标所需的全部场景，识别 MVP 边界。Story map 的每个格子可产出一条用户故事，用户故事再产出 GWT 验收标准。

格式（经典）：`As a [user], I want [goal], so that [benefit]`

来源：https://www.mountaingoatsoftware.com/blog/user-story-mapping-how-to-create-story-maps

### 3.2 Job Stories（Alan Klement / Intercom）

**格式**：`When [situation], I want to [motivation], so I can [expected outcome]`

Job Stories 与 User Stories 的核心区别：
- 聚焦**情境触发**而非人物角色（避免用 persona 掩盖真实动机）
- 更适合功能/UX 设计阶段的需求挖掘
- 不适合直接用作开发规格——缺少足够的验收标准细节

**有争议**：部分团队认为 Job Stories 是 User Stories 的替代品；另一观点（Mountain Goat Software）认为两者各有适用场景，可混用。

来源：https://www.intercom.com/blog/using-job-stories-design-features-ui-ux（作者 Alan Klement 原帖）
来源：https://www.mountaingoatsoftware.com/blog/job-stories-offer-a-viable-alternative-to-user-stories

### 3.3 场景法（Scenario-Based Testing）

场景法在传统软件测试中指"从用户目标出发构造端到端的使用路径"：

- **正常路径（Happy Path）**：用户顺利完成目标的主流程。
- **备选路径（Alternate Path）**：用户选择不同方式完成同一目标。
- **异常路径（Error Path）**：输入错误、网络超时、权限不足等情形。
- **边界条件（Boundary Cases）**：最小值、最大值、空值、临界值。

写给 AI 时，每个路径都应能对应一个或多个 GWT 场景。

---

## 四、Specification by Example（Gojko Adzic）

### 4.1 核心理念

SBE（规范即示例）由 Gojko Adzic 在 2011 年同名书中系统化。它与 ATDD/BDD 高度重叠，核心差异在于**强调需求层面的协作过程，而非技术测试流程**。

关键过程模式：
1. **协作规格化（Specifying Collaboratively）**：产品、开发、测试三方共同参与，避免单方撰写规格。
2. **用示例说明规则（Illustrating with Examples）**：抽象规则必须伴随具体例子。
3. **精炼示例（Refining Examples）**：去掉实现细节，只保留业务相关信息。
4. **不要把 UI 步骤写进示例**：示例描述业务意图，不描述 UI 操作。
5. **自动化验收测试**：示例变成可执行的规范（Living Documentation）。

来源：https://less.works/less/technical-excellence/specification-by-example（LeSS 框架二次整理，引用 Adzic 原著）
来源：https://en.wikipedia.org/wiki/Specification_by_example（包含 SBE 与 ATDD 的同义词关系）

### 4.2 SBE vs BDD 的区别

- **BDD**：强调技术测试过程（outside-in TDD），Gherkin 是载体。
- **SBE**：强调需求结果（examples as specifications），侧重沟通和协作。
- 实践中两者几乎重叠，常被视为同义词，但侧重点不同。

来源：https://itsadeliverything.com/specification-by-example-versus-behaviour-driven-development

---

## 五、"测试即规格"喂给 AI Agent

### 5.1 Uncle Bob 的 ATDD agentic 实践（empire-2025 项目）

Robert C. Martin 在 2025 年用 Claude Code 重构经典战略游戏 Empire（Clojure 实现），发展出"约束 AI agent 的 ATDD 方法论"：

**核心做法**：
- **双流测试**：验收测试（Acceptance Tests）+ 单元测试（Unit Specs），两流并行，AI 无法绕过任意一流。
- **自定义验收管道**：把自然语言需求场景通过定制解析器转化为可执行的验收测试，防止 AI "反过来修改测试来让测试通过"。
- **变异测试（Mutation Testing）**：用 `dae_mutmap.py` 等工具检验测试质量——代码被故意引入缺陷，测试必须检出。
- **规格泄漏规则（Spec-Leakage Rule）**：验收测试不能包含实现细节，否则测试即被污染。

**观察到的现象**：项目增长到 25,000+ 行，其中超过一半是测试。

来源：https://github.com/unclebob/empire-2025（Uncle Bob 原始仓库）
来源：https://github.com/swingerman/disciplined-agentic-engineering（DAE：将 Uncle Bob 方法打包为 Claude Code Skills）
来源：https://cleancoders.com/episode/agentic-discipline-4（Uncle Bob 视频课程，含完整讲解）

### 5.2 ATDD with AI：Paul Duvall 的实践文章

将 ATDD 与 AI 结合的实用工作流：
1. 用自然语言写出验收标准（GWT 格式）。
2. 把验收标准作为 prompt 的核心约束喂给 AI。
3. AI 生成实现代码。
4. 自动运行验收测试套件。
5. 失败的测试报告反馈给 AI 做迭代。

来源：https://www.paulmduvall.com/atdd-driven-ai-development-how-prompting-and-tests-steer-the-code/（2025-06-05）

### 5.3 AI-TDD 框架（Hualin Luan，2026）

提出"AI-TDD Gate Manifest"：
- 在需求确认阶段生成机器可读的需求合同矩阵（Manifest）。
- 从 Manifest 生成验收测试基线，建立 TDD-RED 入口状态。
- AI 生成代码时必须通过 Gate Manifest 校验，否则禁止合并。

核心洞察：**"没有 Manifest 的 AI 生成是无锚的即兴发挥（unanchored improvisation）"**。

来源：https://hlluan.com/en/blog/ai-tdd-framework/（2026-05-27）

### 5.4 UBOS 的验收标准驱动 TDD 流程（工程实践）

四阶段流程：
1. 用纯英文写出验收标准。
2. AI 阅读验收标准和变更 diff，决定需要哪些测试，生成 Playwright 测试脚本。
3. 多个 AI agent 并行运行测试，截图记录，生成 JSON 结果（并行可降低 80% 验证时间）。
4. 最终聚合产出 verdict JSON，只有失败项需要人工介入。

**有争议**：依赖 AI 自动生成测试脚本可能产生"自我庆贺循环"——AI 既写代码又写测试，可能共享同一种误解。

来源：https://ubos.tech/news/ai-generated-code-agents-trust-framework-and-acceptance-criteria-driven-tdd/（2026-03-11）

---

## 六、社区对"AI 生成代码如何验证正确性"的方法

### 6.1 TENET（测试作为生成语境，arxiv 2025）

核心创新：测试不仅作为验证工具，还作为**生成 LLM 的语境输入（context）**。
- 选取多样化测试子集（覆盖不同使用场景）作为 prompt 的一部分。
- 通过测试反馈迭代精化代码。
- 在 RepoCod 基准上达到 69.08% Pass@1，优于最强 agentic baseline 9.49 个百分点。

来源：https://arxiv.org/pdf/2509.24148（2025-09）

### 6.2 TDAD（测试驱动 Agentic 开发，arxiv 2026）

核心发现：
- AI coding agents 在修复 bug 时频繁引入回归（之前通过的测试变为失败）。
- 解决方案：用 AST 构建代码-测试依赖图，在 AI 提交补丁前，自动告知 agent 哪些测试会受影响。
- **关键洞察**：agent 不需要被教"如何做 TDD"，只需要被告知"要检查哪些测试"。
- **结果**：回归率降低 70%（6.08% → 1.82%）。
- 反例：仅仅给 agent 提供 TDD 程序性说明（不提供上下文）反而使回归率从 6.08% 升高到 9.94%。

来源：https://arxiv.org/abs/2603.17973（2026-03-18）

### 6.3 Property-Based Testing（PBT）作为 AI 代码验证

PBT 不依赖具体输入-输出示例，而是验证**高层属性/不变量**，更适合作为 AI 生成代码的护栏：
- 单元测试只能检测"自我一致性"，PBT 可以检测"是否符合业务意图"。
- 研究（Bose, 2025）：PBT 发现了传统单元测试无法检出的逻辑错误，30-32% 的 AI 生成代码只部分满足正确性属性。
- Property-Generated Solver（He et al., 2025）：用 PBT 作为验证引擎，在标准代码生成基准上比传统 TDD 方法提升 23.1%-37.3% Pass@1。
- Anthropic（2026-01）：发布了用 AI agent 自动编写属性测试的研究。

来源：https://arxiv.org/pdf/2506.18315（2025-06-23，PBT as LLM code validation）
来源：https://www.anthropic.com/research/property-based-testing（2026-01-14，Anthropic 官方）
来源：https://doi.org/10.1145/3696630.3728702（Bose, 2025，PBT evaluation of StarCoder/CodeLlama）

### 6.4 "自我庆贺循环"问题（共识：有争议但重要）

如果让 AI 既写代码又写测试，两者可能共享同一错误假设——测试通过但代码逻辑有误。
- UBOS 文章明确指出此风险。
- arxiv 2024（Moritz Mock et al.）实验发现：AI 有时会"修改测试来适应有 bug 的代码"而非修复代码本身。
- 解决方法：**测试必须由人先写，或由不同来源（人写的验收标准 → 人工审核 → AI 生成代码）生成**。

来源：https://arxiv.org/pdf/2405.10849（Generative AI for TDD, 2024-05-17）
来源：https://ubos.tech/news/ai-generated-code-agents-trust-framework-and-acceptance-criteria-driven-tdd/

### 6.5 快照测试（Snapshot Testing）作为回归护栏

针对数据变换类代码，快照测试捕获关键数据结构的序列化状态。AI 优化代码后若输出有任何变化，快照测试立即失败。
适合场景：数据管道、查询结果处理、复杂计算逻辑。

来源：https://testkube.io/blog/building-trust-in-ai-generated-code-through-continuous-testing

### 6.6 连续测试 + CI/CD 护栏（工程共识）

2025 Stack Overflow Developer Survey：84% 开发者已将 AI 集成进工作流，但 46% 主动不信任 AI 输出。
- 预提交钩子（pre-commit hooks）：每次 AI 生成代码前运行单元测试。
- PR 门控：安全扫描 + 静态分析 + API 合约测试。
- 全量测试套件在每次 commit 运行，不只测试变更模块。

来源：https://testkube.io/blog/building-trust-in-ai-generated-code-through-continuous-testing

---

## 七、关键澄清清单（AI 编码前必问）

### 澄清业务层

1. **触发条件**：什么情境（situation）下用户会触发这个功能？（Job Story 的"When"）
2. **成功标准**：功能完成的可观测结果是什么？（Then 的定义）
3. **失败标准**：哪些情况算是失败？失败时应该发生什么？
4. **边界**：哪些情况明确**不在**本次范围内？
5. **规则**：有哪些业务规则约束此功能？（Example Mapping 的蓝卡）
6. **反例**：能举出一个"这不是我要的"的例子吗？

### 澄清技术层

7. **依赖系统**：此功能依赖哪些外部系统/API/数据库？
8. **非功能需求**：有性能、安全、并发的要求吗？
9. **数据状态**：初始状态（Given）需要什么测试数据？
10. **接口契约**：输入输出的数据格式是什么？是否有现有 schema？

### AI 特有澄清

11. **测试所有权**：谁来写验收测试？人还是 AI？（原则：人先写，或人审核）
12. **禁区**：AI 不应修改哪些现有测试？（防止 spec-leakage）
13. **验收管道**：运行 `<specific test command>` 必须 100% 通过才算完成。

---

## 八、推荐方案

**面向 AI 编码的"测试即合同"工作流**：

```
需求会话（Example Mapping，25min）
  ↓ 产出：黄/蓝/绿/红卡
验收标准（GWT Gherkin 场景，人工撰写）
  ↓ 产出：feature files + 明确的边界/反例/规则
喂给 AI（测试 + 规格 + 明确的"测试必须通过"约束）
  ↓ AI 生成实现
自动运行验收套件（Cucumber/Playwright/pytest）
  ↓ 失败 → 反馈给 AI 迭代
  ↓ 通过 → 运行变异测试校验测试质量
  ↓ 通过 → 人工探索性测试（边界、安全、性能）
```

---

## 九、共识 vs 争议 vs 新兴

| 主题 | 状态 | 说明 |
|------|------|------|
| Given-When-Then 作为验收标准格式 | **共识** | 60%+ 敏捷团队采用 BDD，有 Cucumber 等成熟工具链 |
| 测试先于 AI 生成代码 | **共识** | Uncle Bob、Paul Duvall、UBOS、学术研究均指向此方向 |
| Example Mapping 作为 3 amigos 澄清工具 | **共识** | Cucumber 官方推荐，25 分钟时间盒被广泛采用 |
| User Story vs Job Story | **有争议** | Job Stories 提供更好情境，但不能直接作为验收规格；两者可混用 |
| AI 自动生成测试的可靠性 | **有争议** | 存在"自我庆贺循环"风险；PBT 比传统单元测试更能发现 AI 代码的隐性错误 |
| Property-Based Testing 作为 AI 代码验证 | **新兴** | 2025-2026 多篇学术论文，Anthropic 官方研究，尚未成为行业标配 |
| TDAD（测试-代码依赖图 + pre-change 分析）| **新兴** | arxiv 2026-03，效果显著（回归降 70%），但尚无广泛工程化落地 |
| Mutation Testing 作为测试质量门控 | **新兴** | Uncle Bob/DAE 社区实践，学术有支撑，工程采用率仍低 |
| AI-TDD Gate Manifest（需求合同矩阵）| **新兴** | hlluan.com 2026-05，理念清晰但尚无社区规范 |

---

## 参考来源（含 URL，按主题分组）

### Given-When-Then / Gherkin / BDD
- [How to Write Effective Gherkin Acceptance Criteria - TestQuality](https://testquality.com/how-to-write-effective-gherkin-acceptance-criteria) — 支撑 GWT 格式最佳实践、60% 团队采用数据
- [BDD 101: Writing Good Gherkin - Automation Panda](https://automationpanda.com/2017/01/30/bdd-101-writing-good-gherkin) — 黄金法则和 Cardinal Rule 一手来源
- [Acceptance Criteria Purposes, Formats - AltexSoft](https://www.altexsoft.com/blog/acceptance-criteria-purposes-formats-and-best-practices) — 两种格式对比
- [Given When Then Framework - Miro](https://miro.com/agile/given-when-then-framework) — 框架总结
- [Given-When-Then - Ranorex](https://www.ranorex.com/blog/given-when-then-tests) — 写法步骤说明

### Example Mapping
- [Introducing Example Mapping - Cucumber 官方博客](https://cucumber.io/blog/bdd/example-mapping-introduction) — **Matt Wynne 一手来源，官方**
- [Introducing Example Mapping - Medium 原帖](https://medium.com/@mattwynne/introducing-example-mapping-42ccd15f8adf) — 作者原始文章

### Specification by Example
- [Specification by Example - Wikipedia](https://en.wikipedia.org/wiki/Specification_by_example) — 与 ATDD/BDD 的关系梳理
- [Specification by Example vs BDD](https://itsadeliverything.com/specification-by-example-versus-behaviour-driven-development) — 二者区别深度分析
- [Specification by Example - LeSS](https://less.works/less/technical-excellence/specification-by-example) — 澄清会议模式，引用 Adzic 原著
- [Gojko Adzic on Amazon](https://www.amazon.com/Specification-Example-Successful-Deliver-Software/dp/1617290084) — 书籍参考

### User Story Mapping / Job Stories
- [User Story Mapping - Mountain Goat Software](https://www.mountaingoatsoftware.com/blog/user-story-mapping-how-to-create-story-maps) — Mike Cohn 一手来源
- [Designing Features Using Job Stories - Intercom](https://www.intercom.com/blog/using-job-stories-design-features-ui-ux) — Alan Klement 原文
- [Job Stories vs User Stories - Mountain Goat](https://www.mountaingoatsoftware.com/blog/job-stories-offer-a-viable-alternative-to-user-stories) — 对比与适用场景

### ATDD / AI TDD 实践
- [ATDD with AI - Paul Duvall](https://www.paulmduvall.com/atdd-driven-ai-development-how-prompting-and-tests-steer-the-code/) — 2025-06-05 工程实践
- [AI-TDD Framework - Hualin Luan](https://hlluan.com/en/blog/ai-tdd-framework/) — 2026-05-27，Manifest Contract 理念
- [AI-Generated Code Agents Trust Framework - UBOS](https://ubos.tech/news/ai-generated-code-agents-trust-framework-and-acceptance-criteria-driven-tdd/) — 2026-03-11，四阶段工程流程
- [Uncle Bob's TDD with Acceptance Tests and Unit Tests](https://blog.objectmentor.com/articles/2007/10/17/tdd-with-acceptance-tests-and-unit-tests) — 2007 原文，理论基础
- [Clean AI: Agentic Discipline - Clean Coders](https://cleancoders.com/episode/agentic-discipline-4) — Uncle Bob 视频讲座
- [empire-2025 - GitHub](https://github.com/unclebob/empire-2025) — Uncle Bob ATDD agentic 实验原始仓库
- [Disciplined Agentic Engineering - GitHub](https://github.com/swingerman/disciplined-agentic-engineering) — DAE：Claude Code ATDD Skills 实现

### 学术研究：AI 代码验证
- [Generative AI for TDD - arxiv 2024](https://arxiv.org/pdf/2405.10849) — AI 可能修改测试而非修复 bug
- [TENET: Tests Beyond Validation - arxiv 2025](https://arxiv.org/pdf/2509.24148) — 测试作为生成语境
- [TDAD: Test-Driven Agentic Development - arxiv 2026](https://arxiv.org/abs/2603.17973) — 回归率降低 70%
- [Property-Generated Solver - arxiv 2025](https://arxiv.org/pdf/2506.18315) — PBT 比 TDD 提升 23-37% Pass@1
- [PBT for LLM Evaluation - ACM 2025](https://doi.org/10.1145/3696630.3728702) — 30-32% AI 代码只部分满足正确性属性
- [Property-Based Testing Research - Anthropic](https://www.anthropic.com/research/property-based-testing) — 2026-01-14，Anthropic 官方 PBT 研究

### 工程化验证实践
- [Continuous Testing for AI-Generated Code - Testkube](https://testkube.io/blog/building-trust-in-ai-generated-code-through-continuous-testing) — CI/CD 护栏，快照测试
- [Intent Formalization - arxiv 2026](https://arxiv.org/html/2603.17150v1) — 形式化规格作为 AI 验证的必要性
