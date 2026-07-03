---
title: "Vibe Coding 前：PRD 与需求文档应澄清哪些内容、用什么方式澄清"
date: 2026-07-02
topic: spec-prd
status: active
audience: both
tags: [research, spec-driven-development, EARS, PRD, context-engineering, vibe-coding, AI-coding]
type: 原始调研
sources:
  - https://kiro.dev/docs/specs
  - https://addyosmani.com/blog/good-spec/
  - https://github.com/github/spec-kit
  - https://alistairmavin.com/ears
  - https://tessl.io/blog/how-tessls-products-pioneer-spec-driven-development
verified: 2026-07-02
shelf_life: 需定期更新
---

# 调研报告：Vibe Coding 前 PRD 澄清内容与方式

**日期**: 2026-07-02
**任务**: 在 Vibe Coding / AI 辅助编码开始之前，PRD 与需求文档到底应澄清哪些内容、用什么方式澄清。重点覆盖 Spec-Driven Development 运动与工具、EARS 语法、Context Engineering 以及多种澄清方式。

---

## 调研摘要

2025 年下半年至 2026 年，"Spec-Driven Development（SDD）"运动从 AWS Kiro（2025-07）、GitHub Spec Kit（2025-09）、Tessl（2025-09）三条路线同步兴起，正式将"先写规格再写代码"确立为 AI 辅助编码的生产级范式。行业在"AI-ready 规格必须包含哪些字段"上基本达成共识：用户故事 + EARS 验收标准 + 非目标 + 技术约束 + 数据模型 + 可测成功指标。EARS（Easy Approach to Requirements Syntax）因被 Kiro 内置而重获关注，其五类模式（Ubiquitous / Event-driven / State-driven / Optional / Unwanted behavior）提供了消歧义的结构化句法。澄清方式从"单次提示"进化为"AI 反问优先 → 渐进式精化 → 分段实施"的三步流程，其中"让 AI 先列出 5-8 个澄清问题、再写规格"被多位权威（Addy Osmani、momoview.com）列为最高杠杆单点实践。

---

## 一、背景：为什么需要规格先行

### 1.1 Vibe Coding 的失效模式

Vibe Coding（模糊提示驱动的 AI 编码）常见于探索和原型阶段，但用于生产系统时会引发：
- AI 生成代码偏离用户真实意图（"它跑了，但不是我想要的"）
- 上下文丢失导致会话间方向漂移（architectural drift）
- 无法追溯决策来源，代码不可维护

> "Applications were buggy, unmaintainable and definitely not production-ready. Something was missing to guide the LLM."
>
> 来源：[Spec-driven development, Back to the Future?! — Jérôme Van Der Linden (AWS SA)](https://jeromevdl.medium.com/spec-driven-development-back-to-the-future-d71fde8d47cf)

### 1.2 规格驱动开发（SDD）的兴起时间线

| 时间 | 事件 |
|------|------|
| 2025-07-14 | AWS 发布 Kiro IDE，首次将 SDD 概念化为 requirements → design → tasks 三段式 |
| 2025-09-10 | GitHub 开源 Spec Kit，提供 specify → plan → tasks → implement 四段工作流 |
| 2025-09-16 | Tessl 发布 Tessl Framework + Spec Registry，via MCP 为各类 agent 注入规格驱动能力 |
| 2026-01-13 | Addy Osmani（Google Cloud）发布《How to write a good spec for AI agents》，成为行业综合参考 |

---

## 二、AI-ready 规格应包含的结构化字段

### 2.1 Kiro 三文件规格体系（EARS 驱动）

Kiro 为每个 feature spec 生成三个 Markdown 文件：

**`requirements.md`** — 用户故事 + EARS 验收标准
```
## Requirements N: [Name]
User Story: As <role>, I want <feature>, so that <value>

### Acceptance Criteria
1. WHEN [condition/event] THE SYSTEM SHALL [expected behavior]
2. WHEN [condition/event] THE SYSTEM SHALL [expected behavior]
```

**`design.md`** — 技术架构 + 序列图 + 实现考量 + 错误处理策略
- 记录"系统如何工作"的大图
- 捕获组件及其交互
- 包括技术选型理由

**`tasks.md`** — 可执行的实施任务清单，每个任务追溯到 requirements 中的具体验收标准
```
- [ ] 1. Task description
  - Implementation step 1
  - Implementation step 2
  - [ ] 1.1 Sub-task
```

来源：[Kiro Docs — Specs](https://kiro.dev/docs/specs) | [Kiro Best Practices — AWS Builder Center](https://builder.aws.com/content/3BHUl6M43xtQ0niutCXtw4zg4RH/kiro-best-practices-a-field-guide-for-development-teams)

---

### 2.2 GitHub Spec Kit 四段式文件结构

GitHub Spec Kit（117k+ stars，2025-09 发布）将项目组织为 `.specify/` 目录：

| 文件 | 作用 |
|------|------|
| `spec.md` | 项目目标与需求（"what & why"，以用户旅程为中心） |
| `plan.md` | 技术方案与架构（"how"，含技术栈与约束） |
| `tasks/` | 从 plan 分解的独立工作单元 |
| `constitution.md`（可选）| 不可协商的项目原则与规范 |

**spec-template.md 强制字段（来自官方模板）**：
1. **User Scenarios & Testing**（mandatory）— 用户故事 + Given/When/Then 验收场景 + 边界情况
2. **Requirements**（mandatory）— FR-001: System MUST ... 格式；含 `[NEEDS CLARIFICATION]` 标记机制
3. **Success Criteria**（mandatory）— 可测量的结果指标（响应时间、并发量、用户满意度等）
4. **Assumptions** — 目标用户假设、范围边界、依赖项

来源：[GitHub spec-kit spec-template.md](https://github.com/github/spec-kit/blob/main/templates/spec-template.md) | [Microsoft Developer Blog — Diving Into Spec-Driven Development](https://developer.microsoft.com/blog/spec-driven-development-spec-kit)

---

### 2.3 Addy Osmani 六大核心区域（基于 2,500+ AGENTS.md 分析）

Google Cloud AI 工程主管 Addy Osmani 对 2,500 余个 agent 配置文件的分析（2026-01）总结出有效规格必须覆盖六个区域：

1. **Commands** — 完整的可执行命令（含 flags），如 `npm test`、`pytest -v`
2. **Testing** — 如何运行测试、框架名称、测试文件位置、覆盖率要求
3. **Project structure** — 源码、测试、文档的目录约定
4. **Code style** — 真实代码片段优于文字描述；命名规范、格式化规则
5. **Git workflow** — 分支命名、commit 格式、PR 要求
6. **Boundaries（三层边界）** — ✅ Always / ⚠️ Ask first / 🚫 Never（"Never commit secrets"是最高频约束）

来源：[Addy Osmani — How to write a good spec for AI agents (2026-01-13)](https://addyosmani.com/blog/good-spec/)

---

### 2.4 面向 AI Builder 的 PRD 高杠杆字段（实践者总结）

基于 vibeworkflow.app、vibecode.fun、slobodskyi.com 等多个实践者文章的综合：

**最容易被忽略但收益最高的字段**：

| 字段 | 作用 | 关键格式 |
|------|------|---------|
| **Anti-goals / 非目标** | 防止 AI 主动添加计划外功能 | "Do NOT build X in v1" |
| **Acceptance Criteria** | 可测试的完成定义 | Given/When/Then 或 EARS 格式 |
| **Technical Constraints** | 技术栈、部署目标、安全要求 | "Stack: Next.js + Supabase; Deploy: Vercel" |
| **Data Model** | 核心实体及关系 | 实体表 + 关系描述 |
| **Error States** | 异常场景处理 | "When X fails, show inline error with retry" |
| **Negative Examples** | 明确禁止的实现模式 | "Do NOT use modals for confirmations" |

来源：[How to Write a PRD That AI Agents Can Actually Use — vibeworkflow.app](https://vibeworkflow.app/blog/prd-for-ai-agents) | [PRD for AI Builder: Template That Actually Works — vibecode.fun](https://vibecode.fun/learn/how-to-write-prd-for-ai)

---

## 三、EARS 语法：消歧义的结构化句法

### 3.1 EARS 概述

EARS（Easy Approach to Requirements Syntax）由 Rolls-Royce 的 Alistair Mavin 在 2009 年 RE 会议上提出，现被 Airbus、Bosch、Intel、NASA 等广泛使用。其核心价值是通过五类模式 + 严格语序消除需求歧义。

**通用句法结构**：
```
While <precondition>, when <trigger>, the <system name> shall <system response>
```

### 3.2 五类模式

| 模式 | 关键词 | 示例 |
|------|--------|------|
| Ubiquitous（普遍） | 无关键词 | The system shall encrypt all passwords with bcrypt. |
| Event-driven（事件驱动） | WHEN | When "mute" is selected, the laptop shall suppress all audio output. |
| State-driven（状态驱动） | WHILE | While in Do Not Disturb mode, the software shall silence incoming calls. |
| Optional feature（可选特性） | WHERE | Where the car has a sunroof, the car shall have a sunroof control panel. |
| Unwanted behavior（异常处理） | IF / THEN | If an invalid credit card number is entered, then the website shall display "please re-enter credit card details". |

来源：[Alistair Mavin — EARS Official Guide](https://alistairmavin.com/ears) | [EARS: The Easy Approach to Requirements Syntax — DEV Community](https://dev.to/sebastian_dingler/ears-the-easy-approach-to-requirements-syntax-39a5)

### 3.3 Kiro 的 EARS 内置

Kiro 将 EARS 作为 requirements.md 的强制格式：
```
WHEN [condition/event] THE SYSTEM SHALL [expected behavior]
```

Kiro 2026 版增加的 Requirements Analysis 功能使用 SMT solvers 进行形式逻辑验证，在代码生成前捕获需求矛盾。

来源：[6 Best Spec-Driven Development Tools for AI Coding in 2026 — Augment Code](https://www.augmentcode.com/tools/best-spec-driven-development-tools)

### 3.4 EARS 与 AI 的结合方式

Inflectra.ai 已于 2025-07 发布基于 Amazon Nova LLM 的 EARS 自动评分与改进建议功能，可对现有需求文档打分并给出修改建议。

来源：[Analyze Your Requirements Against EARS Using Inflectra.ai](https://www.inflectra.com/Company/Article/analyze-your-requirements-ears-using-inflectra-ai-1916.aspx)

---

## 四、Context Engineering：喂给 AI 编码 Agent 的完整上下文

### 4.1 Context Engineering vs Prompt Engineering

Context Engineering 是"deliberate process of designing, structuring, and providing relevant information to LLMs"，与 Prompt Engineering 的区别在于：
- Prompt Engineering：聚焦指令本身和输出格式
- Context Engineering：聚焦为特定任务收集和选择输入数据，包括相关指南、配置文件、文档和代码示例

来源：[Context Engineering for AI Agents in Open-Source Software — arXiv 2510.21413](https://arxiv.org/html/2510.21413v1)

### 4.2 Kiro Steering Files：项目级永久上下文

Kiro 的 Steering 文件相当于永久型 AI 上下文注入，区别于 spec（针对具体 feature）：

| 文件 | 包含内容 | 触发条件 |
|------|---------|---------|
| `product.md` | 产品概述、用户、核心功能、业务目标 | always |
| `tech.md` | 框架、库、技术约束 | always |
| `structure.md` | 文件组织、命名规范、架构 | always |
| `code-conventions.md` | 命名模式、导入、通用模式 | auto |
| `testing-standards.md` | 测试模式、覆盖率要求、mock 方法 | fileMatch (.test.) |
| `api-standards.md` | REST 约定、错误格式、middleware | fileMatch (app/api/) |
| `security-policies.md` | 认证、验证、数据消毒规则 | always |

来源：[Kiro Best Practices — AWS Builder Center](https://builder.aws.com/content/3BHUl6M43xtQ0niutCXtw4zg4RH/kiro-best-practices-a-field-guide-for-development-teams)

### 4.3 喂给编码 Agent 的上下文层级

基于 Addy Osmani 2026-01 文章和 latitude.so 指南综合：

```
Layer 1: Constitution / Steering（全局不变）
  - Tech stack + versions
  - Code style (real snippet beats description)
  - Git workflow
  - Always/Ask/Never boundaries

Layer 2: Feature Spec（feature 级，session 内）
  - Goals & user stories
  - Non-goals / anti-goals
  - Acceptance criteria (EARS or Given/When/Then)
  - Data model (entities & relationships)
  - Error states
  - External integrations & constraints

Layer 3: Task Context（实施级，per-task）
  - Relevant spec subsection only
  - Current file structure
  - Existing similar code patterns
  - Test expectations
```

### 4.4 "诅咒效应"：上下文越多不一定越好

研究（"Curse of Instructions"，OpenReview）表明：当提示中包含过多指令时，模型对每条指令的遵守率显著下降。实践建议：
- 不要把完整 50 页文档全部塞进 prompt
- 每次 prompt 只对焦当前任务所需的 spec 章节
- 大型 spec 用扩展 TOC + 摘要；agent 需要时再提取详情

来源：[Addy Osmani — How to write a good spec for AI agents](https://addyosmani.com/blog/good-spec/)

---

## 五、澄清方式：从单次提示到结构化对话

### 5.1 AI 反问澄清（Clarifying Questions First）

最高杠杆单点实践，来自多个独立来源的强共识：

**核心做法**：在开始写 spec 或写代码之前，先让 AI 提出需要澄清的问题。

推荐开场 prompt（来自 momoview.com）：
```
Before we start, list the 5-8 questions you need me to clarify,
especially ambiguities in scope and acceptance criteria.
```

另一种变体（来自 Addy Osmani 的 LLM 编码工作流）：
```
Draft a detailed specification for [project X] covering objectives, features, constraints,
and a step-by-step plan. If anything is not clear, ASK me questions before proceeding.
```

这一做法在 Kiro 中也有对应体现：生成 spec 时 AI 会标记 `[NEEDS CLARIFICATION]`，要求人工确认后再推进。

来源：
- [Writing Specs with AI — momoview.com (2026-06)](https://momoview.com/blog/en/posts/writing-specs-with-ai-spec-driven-workflow/)
- [My LLM coding workflow going into 2026 — Addy Osmani](https://medium.com/@addyosmani/my-llm-coding-workflow-going-into-2026-52fe1681325e)
- [GitHub spec-kit spec-template.md `[NEEDS CLARIFICATION]` 机制](https://github.com/github/spec-kit/blob/main/templates/spec-template.md)

### 5.2 渐进式细化（Progressive Refinement）

标准流程分四个阶段，每个阶段都是人工审核门控：

```
Stage 0: Brainstorm（问题对齐）
  → AI 列出澄清问题 → 人工回答 → 产出"双方认可的问题陈述"

Stage 1: Specify（目标层）
  → 描述 what & why；用户旅程；成功定义
  → 产出 spec.md / requirements.md

Stage 2: Plan（方案层）
  → 技术栈、架构、约束
  → 产出 design.md / plan.md

Stage 3: Tasks（执行层）
  → 分解为可独立测试的小任务
  → 产出 tasks.md；每个任务追溯到验收标准

Stage 4: Implement（实施）
  → 每个任务独立实施；AI 自验证；人工审核
```

**关键原则**：只有在当前阶段审核通过后，才进入下一阶段。

来源：
- [GitHub spec-kit spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md)
- [Spec-Driven Development: The 2026 Guide — productbuilder.net](https://productbuilder.net/learn/spec-driven-development)
- [Writing Specs with AI — momoview.com](https://momoview.com/blog/en/posts/writing-specs-with-ai-spec-driven-workflow/)

### 5.3 Refine-Plan-Act（RPA）模式

来自实践者 Francesco Borzì（Medium）的三段式 agent 工作流：

**Refine 阶段**（新 session，只读）：
```
- Analyze the requirements
- If anything is not clear, ASK me questions before proceeding
- Output a REQUIREMENTS.md with all necessary information
- Do NOT proceed with implementation
```

**Plan 阶段**（新 session，输入 REQUIREMENTS.md）：
```
- Analyze REQUIREMENTS.md and prepare an implementation plan
- Ask me questions when you're not sure
- Make it consistent with the current codebase
- Save the plan in PLAN.md
- Do NOT proceed with implementation
```

**Act 阶段**（基于 PLAN.md 执行）

这个模式的优势：每个阶段都只读/只写一个产物，并行安全，错误时从 PLAN.md 重新开始而非从零。

来源：[The Refine-Plan-Act Pattern for Agentic AI Coding — Francesco Borzì (Medium)](https://medium.com/@borzifrancesco/the-refine-plan-act-pattern-for-agentic-ai-coding-59ee013e4427)

### 5.4 Interview 式需求挖掘（学术方向）

2026 年发表的论文《From Chat to Interview: Agentic Requirements Elicitation with an Experience Ontology》（arXiv 2605.05828）提出 OntoAgent：
- 使用 Experience Ontology 框架驱动结构化澄清问题
- 当需求维度"仅被提及但缺少细节"时，用 Yes/No 确认式提问
- 当"已有部分约束"时，切换为开放式 What/How 提问
- 在 Claude Opus 4.5、Gemini 3 Flash 等模型上验证

来源：[From Chat to Interview: Agentic Requirements Elicitation — arXiv 2605.05828](https://arxiv.org/html/2605.05828v1)

---

## 六、Tessl 的差异化视角："Spec First, Always"

Tessl（由 Snyk 创始人 Guy Podjarny 创立）定义了 SDD 三个成熟度阶段：

1. **Spec-Assisted**（2026 年将成主流）：修改 spec 再修改代码，但仍有人工操作代码
2. **Spec-Driven**：agent 自动根据 spec 变更生成代码更新
3. **Spec-as-Source**：删除 src/，只保留 spec，CI/CD 实时从 spec 生成代码

Tessl 的核心主张：每次需求变更都必须先更新 spec、再应用到代码，不允许直接改代码绕过 spec。这一"规格先行"的纪律，类比于优秀开发者在动手之前先确认需求变更对产品定义的影响。

来源：[How Tessl's Products Pioneer Spec-Driven Development](https://tessl.io/blog/how-tessls-products-pioneer-spec-driven-development) | [Is Spec-Driven Development the Future of AI Coding? — zuplo.com](https://zuplo.com/blog/spec-driven-ai-development)

---

## 七、"Spec as Source of Truth"的争议

尽管 SDD 运动快速兴起，社区内存在真实争议：

**支持方观点**：
- 规格让 AI 有了可追溯的契约，减少 hallucination 和意图漂移
- 大上下文窗口（200K+ tokens）现在足以处理完整规格文档
- 代码成为"派生产物"——可从规格重新生成（Augment Code 的"rebuild test"）

**质疑方观点**（来自 github/spec-kit Discussion #152）：
- 代码是被编译和部署的，"代码才是真正的 source of truth"（rienst, 2026-04）
- 大型多人项目中规格漂移太容易，维护成本高（Ian1971, 2026-01）
- 对许多任务而言 spec kit 是 overkill，产生的文档量与收益不成比例

**折中观点**：
- Jérôme Van Der Linden（AWS SA）："Agile taught us that working software beats comprehensive documentation. AI doesn't change that — it just makes both faster. Keep your specs micro, keep iterating."
- 复杂生产系统、合规场景 → SDD；探索原型、单文件修改 → 跳过

来源：
- [Evolving specs · github/spec-kit · Discussion #152](https://github.com/github/spec-kit/discussions/152)
- [Spec-driven development, Back to the Future?! — Medium](https://jeromevdl.medium.com/spec-driven-development-back-to-the-future-d71fde8d47cf)
- [The Spec as Source of Truth — Augment Code](https://www.augmentcode.com/guides/spec-as-source-of-truth-rebuildable-codebase)

---

## 八、AI-ready 规格的反模式（Anti-Patterns）

来自 Addy Osmani《How to write a good spec for AI agents》和多个实践者总结：

| 反模式 | 问题 | 正确做法 |
|--------|------|---------|
| 模糊描述 | "直觉性 UI"、"快速"、"安全" | 具体可测："\<100ms response"、"bcrypt salt rounds 12" |
| 省略非目标 | AI 会主动添加"nice-to-have"功能 | 显式 Anti-goals 章节 |
| 没有错误状态 | AI 只实现 happy path | 每个 feature 描述 error state 和 fallback |
| 一次性超长 prompt | "诅咒效应"，多条指令相互干扰 | 分阶段、分章节、per-task 提供上下文 |
| 验收标准描述主观感受 | "UI 要好看"无法验证 | "不超过 3 次点击即可创建任务" |
| AI 自行生成验收标准 | 可能偏离真实业务规则 | 验收标准必须由懂业务的人确认 |
| 跳过人工审核直接实施 | "house of cards code" | 每个阶段门控，执行前审核通过 |

---

## 九、工具生态一览（2025-2026）

| 工具 | 类型 | 规格格式 | 澄清方式 | 状态 |
|------|------|---------|---------|------|
| **Amazon Kiro** | 专用 IDE（VS Code 基础） | EARS（requirements.md + design.md + tasks.md） | AI 生成 + NEEDS CLARIFICATION 标记 | 正式发布（付费） |
| **GitHub Spec Kit** | CLI + 模板（agent 无关） | Given/When/Then（spec.md + plan.md + tasks/） | slash commands + AI 提问 | 开源免费 |
| **Tessl Framework** | MCP 工具（agent 无关） | 自定义 spec registry | spec-first 强制工作流 | 封测（waitlist） |
| **specs.md** | CLI 框架 | Markdown + YAML（AI-DLC 三阶段） | Memory Bank 持久化 | 开源 |
| **Cursor Plan Mode** | IDE 内置 | 非正式 markdown | 对话式 | 已集成 |
| **Inflectra.ai** | 需求管理平台 | EARS 自动评分 | AI 改进建议 | 正式发布 |

---

## 十、实施建议

### 最小可行规格（Minimum Viable Spec）

对于中等复杂度的 Vibe Coding 项目，推荐的最小字段集：

```markdown
## Goal (1 sentence)
[What are we building and why]

## Target User
[Who, with specific goals and frustrations]

## Features (MVP Only)
[Explicit list; separate v1 from future]

## Anti-goals (Do NOT build)
[At least 3 explicit exclusions]

## Technical Constraints
- Stack: [exact versions]
- Deploy: [target]
- Auth: [method]

## Acceptance Criteria
- [ ] WHEN [trigger] THE SYSTEM SHALL [response]
- [ ] Given [state], When [action], Then [outcome]
- [ ] [Edge case 1 handled]
- [ ] [Error state 1 handled]

## Data Model (if applicable)
[Core entities and relationships]
```

### 澄清顺序建议

1. **让 AI 先列澄清问题**（5-8 个）
2. **人工回答** → 双方认可问题陈述
3. **AI 生成 spec 草稿**
4. **人工审核** → 确认非目标、验收标准、技术约束
5. **AI 生成 plan**（技术方案）
6. **人工审核** → 确认架构决策合理
7. **AI 分解 tasks**
8. **执行**（每个 task 后验证）

---

## 参考来源

### 一手来源（官方文档/作者原文）
- [Kiro Docs — Specs](https://kiro.dev/docs/specs) — 支撑 Kiro 三文件规格体系
- [EARS Official Guide — Alistair Mavin](https://alistairmavin.com/ears) — 支撑 EARS 五类模式定义
- [GitHub Spec Kit — spec-template.md](https://github.com/github/spec-kit/blob/main/templates/spec-template.md) — 支撑 spec 字段结构
- [GitHub Spec Kit — spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md) — 支撑 SDD 工作流描述
- [Tessl Blog — How Tessl's Products Pioneer SDD](https://tessl.io/blog/how-tessls-products-pioneer-spec-driven-development) — 支撑 Tessl 三阶段论
- [Addy Osmani — How to write a good spec for AI agents](https://addyosmani.com/blog/good-spec/) — 支撑六区域模型、三层边界、诅咒效应

### 二手/综合来源
- [Spec-driven development, Back to the Future?! — jeromevdl.medium.com](https://jeromevdl.medium.com/spec-driven-development-back-to-the-future-d71fde8d47cf) — 支撑 SDD 时间线与行业背景
- [Kiro Best Practices — AWS Builder Center](https://builder.aws.com/content/3BHUl6M43xtQ0niutCXtw4zg4RH/kiro-best-practices-a-field-guide-for-development-teams) — 支撑 Steering Files 体系
- [EARS DEV Community — Sebastian Dingler](https://dev.to/sebastian_dingler/ears-the-easy-approach-to-requirements-syntax-39a5) — 支撑 EARS 使用示例
- [Inflectra.ai EARS 分析](https://www.inflectra.com/Company/Article/analyze-your-requirements-ears-using-inflectra-ai-1916.aspx) — 支撑 EARS + AI 工具化
- [Writing Specs with AI — momoview.com](https://momoview.com/blog/en/posts/writing-specs-with-ai-spec-driven-workflow/) — 支撑 AI 反问澄清最佳实践
- [How to Write a PRD That AI Agents Can Actually Use — vibeworkflow.app](https://vibeworkflow.app/blog/prd-for-ai-agents) — 支撑 7 sections PRD 结构
- [PRD for AI Builder — vibecode.fun](https://vibecode.fun/learn/how-to-write-prd-for-ai) — 支撑 Anti-goals 重要性
- [The Refine-Plan-Act Pattern — Francesco Borzì (Medium)](https://medium.com/@borzifrancesco/the-refine-plan-act-pattern-for-agentic-ai-coding-59ee013e4427) — 支撑 RPA 三段模式
- [My LLM coding workflow going into 2026 — Addy Osmani (Medium)](https://medium.com/@addyosmani/my-llm-coding-workflow-going-into-2026-52fe1681325e) — 支撑 spec.md 先行工作流
- [The Spec as Source of Truth — Augment Code](https://www.augmentcode.com/guides/spec-as-source-of-truth-rebuildable-codebase) — 支撑 "rebuild test" 概念
- [Evolving specs Discussion #152 — github/spec-kit](https://github.com/github/spec-kit/discussions/152) — 支撑争议部分
- [Is SDD the Future of AI Coding? — zuplo.com](https://zuplo.com/blog/spec-driven-ai-development) — 支撑 Tessl 三阶段论和 Guy Podjarny 观点
- [Context Engineering for AI Agents — arXiv 2510.21413](https://arxiv.org/html/2510.21413v1) — 支撑 Context Engineering 定义
- [From Chat to Interview: Agentic Requirements Elicitation — arXiv 2605.05828](https://arxiv.org/html/2605.05828v1) — 支撑 Interview 式澄清学术方向
- [AWS re:Invent 2025 — Spec-driven development with Kiro](https://www.youtube.com/watch?v=4qcWgPb-8Fk) — 支撑 Kiro EARS 集成演示
- [Spec-Driven Development in 2025 Complete Guide — softwareseni.com](https://www.softwareseni.com/spec-driven-development-in-2025-the-complete-guide-to-using-ai-to-write-production-code) — 支撑详细 spec 样例对比
- [Spec-Driven Development: The 2026 Guide — productbuilder.net](https://productbuilder.net/learn/spec-driven-development) — 支撑 constitution.md 概念
- [Spec-Driven Development: From Code to Contract — arXiv 2602.00180](https://arxiv.org/html/2602.00180) — 支撑学术视角的 SDD 定义
