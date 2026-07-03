---
title: 把模糊想法澄清成无歧义需求的方法论与提问方式
date: 2026-07-02
topic: elicitation-method
status: active
audience: both
tags: [research, requirements-elicitation, disambiguation, clarifying-questions, LLM, JTBD, example-mapping, design-thinking]
type: 原始调研
sources:
  - https://arxiv.org/html/2507.02564v1
  - https://openreview.net/forum?id=JAMxRSXLFz
  - https://arxiv.org/html/2507.02858v1
  - https://cucumber.io/blog/bdd/example-mapping-introduction
  - https://www.nngroup.com/articles/user-story-mapping
  - https://maze.co/blog/assumption-mapping
  - https://en.wikipedia.org/wiki/Five_whys
  - https://ixdf.org/literature/article/5-stages-in-the-design-thinking-process
  - https://www.eedi.com/news/improved-human-ai-alignment-by-asking-smarter-clarifying-questions
  - https://arxiv.org/html/2409.06097v2
  - https://medium.com/@a1guy/prompt-engineering-via-prompt-patterns-cognitive-verifier-pattern-727878a4d372
verified: 2026-07-02
shelf_life: 需定期更新
---

# 调研报告：把模糊想法澄清成无歧义需求的方法论与提问方式

**日期**：2026-07-02
**任务**：系统梳理需求获取经典技术、消歧/降歧义手段、LLM 主动澄清最佳实践，以及何时停止澄清、如何排优先级。

---

## 调研摘要

需求获取（Requirements Elicitation）不是简单的"问用户要什么"，而是一个系统性的探索与发现过程。传统技术（访谈、问卷、观察、Workshop、原型）与现代消歧工具（Example Mapping、Assumption Mapping、JTBD、5 Whys、User Story Mapping）可以互补叠加。LLM 辅助澄清是 2024-2025 年最活跃的研究前沿，核心结论是：每次只问一个最高信息增益的问题，并用结构化框架（Cognitive Verifier Pattern、Active Task Disambiguation）驱动问题选择。停止澄清的信号是"冗余信息出现"或"已覆盖高优先级需求"——Bezos 70% 信息量法则提供了可操作的决策阈值。

---

## 一、需求获取经典技术

### 1.1 访谈（Interviews）

**核心描述**：与利益相关者一对一深入交谈，获取需求、痛点与期望。分结构化（预设问题）和非结构化（开放式）两种形式。

**关键步骤**（来源：LLMREI 论文，Ferrari et al. 访谈指南）：
1. 准备（识别利益相关者、拟定问题、定义目标）
2. 执行（收集见解，结构化 vs 非结构化）
3. 分析（提炼需求，处理偏差）
4. 验证（与受访者确认理解正确）

**研究发现**：现代技术（JAD/Workshop）比传统访谈在完整性（4.6 vs 3.8）和清晰度（4.7 vs 3.5）上显著更好，需要澄清的需求从 20% 降至 5%，修订次数从 3 次降至 1 次。

> 来源：[Comparative Research of Traditional vs. Modern Elicitation Techniques (FMDB, 2024)](https://www.fmdbpub.com/uploads/articles/173475451926954.%20FTSTPL-231-2024.pdf)

**LLMREI（2025）**：GPT-4o 驱动的聊天机器人可以自动化大规模利益相关者访谈。使用 least-to-most prompting 时，LLM 生成的问题与人类访谈者出错率相当，且能提取绝大多数需求，并展现出高度的上下文依赖问题生成能力。

> 来源：[LLMREI: Automating Requirements Elicitation Interviews with LLMs (arXiv 2507.02564, RE 2025)](https://arxiv.org/html/2507.02564v1)

**共识**：访谈是最基础的需求获取技术，已有 70 余年实践积累。

---

### 1.2 问卷（Questionnaires）

**核心描述**：结构化书面问题，面向大量利益相关者，效率高但深度有限。

**适用场景**：初步筛选痛点优先级；验证已有假设；覆盖地理分散的受访群体。

**局限**：回应率（传统约 60%）低于访谈参与率（约 70%）；无法追问深层原因。

> 来源：[Comparative Research of Traditional vs. Modern Elicitation Techniques (FMDB, 2024)](https://www.fmdbpub.com/uploads/articles/173475451926954.%20FTSTPL-231-2024.pdf)

**共识**：问卷适合大规模初筛，需与深度访谈组合使用。

---

### 1.3 观察（Observation）

**核心描述**：在用户真实工作环境中观察行为（影子学习 / Contextual Inquiry），发现用户说不出口的隐性需求。

**原则**："Go and see"（丰田现场哲学）——不要在会议室推测，去现场观察。

**与 JTBD 的关系**：观察揭示用户实际完成的"工作步骤"，是构建 JTBD 地图的原始数据来源。

> 来源：[5 Whys Technique - Toyota Production System (Adobe Business)](https://business.adobe.com/blog/basics/5-whys-root-cause-analysis)

**共识**：观察是发现隐性需求最有效的方法，但耗时最高。

---

### 1.4 原型（Prototyping）

**核心描述**：快速构建低/高保真原型，让用户"看到"和"触碰"，激发具体反馈。

**原则**：需求在交互中涌现，用户往往说不清楚但看到就知道对不对。

**与 User Story Map 的关系**：原型可以作为 Story Map 中"风险便利贴"的验证手段——优先构建风险最高的假设原型。

> 来源：[Mapping User Stories in Agile - NN/G](https://www.nngroup.com/articles/user-story-mapping)

**共识**：原型是需求澄清最快的反馈回路，尤其适合 UI/UX 类需求。

---

### 1.5 Workshop / Event Storming

**Event Storming 核心描述**：Alberto Brandolini 创造的协作建模工作坊，用彩色便利贴在时间线上映射领域事件（Domain Events）、命令（Commands）、聚合（Aggregates）、策略（Policies）。

**三个层级**：
1. **Big Picture**：识别整体业务流程与热点
2. **Process Modeling**：聚焦单个业务流程，揭示瓶颈和歧义
3. **Design-Level**：对齐 DDD 设计，建模 Bounded Context

**核心价值**：弥合业务领域专家与工程师之间的沟通鸿沟，让业务完全参与建模过程。

> 来源：[Why you should consider using Event Storming (Qlerify, 2024)](https://www.qlerify.com/post/why-event-storming)
> 来源：[From Event Storming to User Stories (Qlerify, 2024)](https://www.qlerify.com/post/from-event-storming-to-user-stories)

**共识**：Event Storming 是目前最系统的领域级需求发现工作坊，已广泛应用于 DDD 实践。

---

## 二、消歧/降歧义技术

### 2.1 Assumption Mapping（假设映射）

**核心描述**：将团队隐含的产品假设可视化，按"重要性 × 不确定性"四象限排列，识别高风险假设优先验证。

**四类假设**：
- **Desirability**（用户想要吗？）
- **Feasibility**（团队能实现吗？）
- **Viability**（对业务划算吗？）
- **Adaptability**（用户能接受改变吗？）

**操作流程**：
1. 发散：列出所有隐含假设
2. 映射：在重要性 × 证据充分度矩阵上标注
3. 优先级：高重要性 + 低证据 = 必须先验证
4. 行动：设计最小实验验证高风险假设

> 来源：[Assumption Mapping: How To Test Product Assumptions | Maze](https://maze.co/blog/assumption-mapping)
> 来源：[An introduction to assumptions mapping - Mural](https://www.mural.co/blog/intro-assumptions-mapping)

**共识**：Assumption Mapping 是跨团队头脑风暴 + 问题发现阶段的首选消歧工具。

---

### 2.2 5 Whys（五问法）

**起源**：丰田佐吉（Sakichi Toyoda）1930s 发明，大野耐一在丰田生产系统中系统化。原始目的是理解"为什么需要新产品特性或制造技术"，而非仅用于故障分析。

**核心机制**：连续追问 "Why?"，穿透表层症状找到根因。次数以"找到根因"为准，不强制五次。

**在需求澄清中的应用**：
- 用户说"我需要一个报表" → Why? → "我需要查看销售数据" → Why? → "我需要发现哪个产品滞销" → Why? → 真实需求：库存决策支持，而非报表本身

**局限**（有争议来源：Wikipedia - Criticism 章节）：对复杂系统问题过于简单，根因往往是多元的，五问法可能过早收敛。

> 来源：[Five whys - Wikipedia](https://en.wikipedia.org/wiki/Five_whys)
> 来源：[How Toyota Utilizes the 5 Whys Method (OrcaLean)](https://www.orcalean.com/article/how-toyota-is-using-5-whys-method)

**共识**：5 Whys 是快速挖掘用户真实意图的轻量工具；对复杂问题需配合鱼骨图等辅助。

---

### 2.3 JTBD（Jobs To Be Done）

**起源**：Clayton Christensen（哈佛商学院）通过快餐奶昔研究提出："用户购买产品是为了'雇用'它完成某项工作"。

**核心框架**：
- **Job**：用户试图完成的进展（Progress），独立于具体产品或人设
- **Job Story 格式**：`When [situation], I want to [motivation], so I can [expected outcome]`
- **测试性**：Job Story 可通过可用性测试验证（比用户故事更易量化）

**与 User Story 的关系**：
- JTBD = 问题空间（Why）
- User Story = 解决方案空间（What/How）
- 二者互补：JTBD 导向创新，User Story 导向实现

**JTBD Map 构建**：两小时工作坊可完成初稿。阶段包括：发现内容、计划工作、完成工作、回顾结果。

> 来源：[Why you need a jobs-to-be-done map (Building Momentum Newsletter)](https://newsletter.buildingmomentum.io/p/jtbd-map)
> 来源：[Job Stories Revisited - JTBD Toolkit (Medium)](https://jtbdtoolkit.medium.com/job-stories-revisited-13ad0b54eb3c)

**共识**：JTBD 是揭示用户深层动机和消歧义最有力的理论框架，在产品创新场景尤为有效。

---

### 2.4 User Story Mapping（用户故事地图）

**起源**：Jeff Patton 创造，以用户旅程为 X 轴（activities → tasks），以优先级为 Y 轴，形成二维可视化地图。

**核心结构**：
- **Backbone（脊梁）**：顶层用户活动（activities），横跨整个旅程
- **Spine（脊椎）**：每个活动下的具体任务（tasks）
- **Story Slices（水平切片）**：横向切割定义 MVP、Release 1、Release 2 等

**消歧义价值**：
- 暴露"风险便利贴"（无用户数据支撑的假设）
- 强迫团队用用户语言而非技术语言思考
- 让利益相关者参与地图构建，减少理解偏差

> 来源：[Mapping User Stories in Agile - NN/G](https://www.nngroup.com/articles/user-story-mapping)
> 来源：[A Complete Guide to User Story Mapping - AltexSoft](https://www.altexsoft.com/blog/a-complete-guide-to-user-story-mapping-process-tips-advantages-and-use-cases-in-product-management)

**共识**：User Story Mapping 是 Agile 项目中最广泛使用的需求可视化与优先级工具。

---

### 2.5 Example Mapping（例子映射）

**起源**：Matt Wynne（Cucumber 联合创始人）发现的轻量协作技术，专为 BDD 精化会话设计。

**四色卡片系统**：
- 黄色：User Story（待讨论的故事）
- 蓝色：Business Rule（已知规则/验收准则）
- 绿色：Example（规则的具体例子，可直接转化为 Gherkin 场景）
- 粉色：Question（当前无法回答的疑问，需要 Product Owner 离线调研）

**时间盒**：25 分钟/故事。超时说明故事太大或不确定性太高，需要拆分或先去做"家庭作业"。

**消歧义机制**：
1. 将抽象规则转化为具体例子 → 暴露隐含假设
2. 显式记录 Questions → 将不确定性可视化
3. 例子驱动共识 → 消除跨角色理解偏差（开发/测试/产品）

Matt Wynne 原话："Example Mapping acts like a filter, preventing big fat stories from getting into your sprint and exploding."

> 来源：[Introducing Example Mapping - Matt Wynne / Cucumber](https://cucumber.io/blog/bdd/example-mapping-introduction)
> 来源：[Example Mapping for Requirements Elicitation (Medium, Analysts Corner)](https://medium.com/analysts-corner/example-mapping-for-requirements-elicitation-3a403427f196)
> 来源：[BDD Example Mapping - Automation Panda](https://automationpanda.com/2018/02/27/bdd-example-mapping)

**共识**：Example Mapping 是 BDD/敏捷团队澄清单个 Story 的最佳结构化工具，高度可操作。

---

### 2.6 设计思维（Design Thinking）

**框架来源**：Stanford d.school（Hasso Plattner Institute of Design），由 IDEO 共同推广。

**五阶段**：
1. **Empathize（共情）**：深度理解用户，通过访谈、观察、影子学习
2. **Define（定义）**：合成共情数据，产出以用户为中心的问题陈述（HMW）
3. **Ideate（构思）**：基于已定义问题，发散解决方案
4. **Prototype（原型）**：快速构建可测试的解决方案
5. **Test（测试）**：与用户验证，反馈驱动迭代

**与需求澄清的关系**：
- Empathize 阶段 = 需求发现（解决"用户想什么"的歧义）
- Define 阶段 = 需求定义（将模糊想法转化为清晰问题陈述）
- 两阶段的产出是后续所有开发活动的"需求锚点"

> 来源：[The 5 Stages in the Design Thinking Process | IxDF](https://ixdf.org/literature/article/5-stages-in-the-design-thinking-process)

**共识**：设计思维的 Empathize-Define 阶段是需求模糊度最高时的首选框架，适合新产品/新功能的早期探索。

---

## 三、AI 主动澄清：LLM 提问最佳实践

### 3.1 Active Task Disambiguation（主动任务消歧）

**论文**：Kobalczyk et al., ICLR 2025 Spotlight — "Active Task Disambiguation with LLMs"（University of Cambridge）

**核心贡献**：
- 正式定义"任务歧义"（Task Ambiguity）
- 将消歧问题建模为 **Bayesian Experimental Design** 问题
- 通过最大化**期望信息增益（Expected Information Gain, EIG）**选择最优澄清问题

**EIG 公式**：
```
EIG(q) = H[p*(h|S)] - E_{p*(a|q,S)} H[p*(h|S ∪ (q,a))]
```
其中 H 为 Shannon 熵，q 为候选问题，a 为答案，S 为当前问题陈述，h 为候选解决方案。

**工作流**：
1. 接收模糊问题陈述
2. 推断当前规格下兼容的解决方案空间（采样候选解）
3. 生成候选澄清问题
4. 选择 EIG 最高的问题
5. 获得回答，扩展问题陈述，重复

**实验结论**：基于解决方案空间推理（而非仅在问题空间推理）的问题选择显著更有效。

> 来源：[Active Task Disambiguation with LLMs - ICLR 2025 (OpenReview)](https://openreview.net/forum?id=JAMxRSXLFz)
> 来源：[Improved Human-AI Alignment by Asking Smarter Clarifying Questions (Eedi, 2025)](https://www.eedi.com/news/improved-human-ai-alignment-by-asking-smarter-clarifying-questions)

**分类**：新兴（2025 年 ICLR Spotlight，方法论前沿）

---

### 3.2 Requirements Elicitation Follow-Up Question Generation

**论文**：Shen, Singhal, Breaux — "Requirements Elicitation Follow-Up Question Generation"（arXiv 2507.02858, 2025）

**研究设计**：使用 GPT-4o 生成 RE 访谈跟进问题，基于"常见访谈错误类型"框架。

**关键发现**：
1. 无引导时：LLM 生成的问题在清晰度、相关性、信息性方面不劣于人类
2. 有错误类型引导时：LLM 问题**优于**人类——避免通用/领域无关问题，避免问与受访者档案不符的问题

**错误框架对 LLM 问题生成的作用**：引导模型避免"问太宽泛的问题"和"问不相关的问题"，从而提升清晰度和针对性。

> 来源：[Requirements Elicitation Follow-Up Question Generation (arXiv 2507.02858)](https://arxiv.org/html/2507.02858v1)

**分类**：新兴（2025 年最新 RE 领域研究）

---

### 3.3 Cognitive Verifier Pattern（认知验证模式）

**来源**：White, Schmidt et al., "ChatGPT Prompt Patterns for Improving Code Quality, Refactoring, Requirements Elicitation, and Software Design" (2024)

**核心机制**：强制 LLM 将用户问题拆解为若干子问题，分别回答后综合得出最终答案。

**在需求澄清中的 Prompt 示例**：
```
当用户描述一个需求时，先生成 3-5 个澄清子问题，
回答这些子问题后，再综合给出需求理解。
```

**研究依据**：研究表明，LLM 在问题被分解为子问题时推理质量显著提升（对应 Chain-of-Thought 的任务分解思路）。

> 来源：[Prompt Engineering via Prompt Patterns — Cognitive Verifier Pattern (Medium)](https://medium.com/@a1guy/prompt-engineering-via-prompt-patterns-cognitive-verifier-pattern-727878a4d372)
> 来源：[Prompt Engineering Guidelines for Using LLMs in Requirements Engineering (arXiv 2507.03405)](https://arxiv.org/html/2507.03405v1)

**分类**：共识（广泛采用的 Prompt Engineering 实践）

---

### 3.4 一次问一个问题 vs 一次问全

**研究依据**（ClarQ-LLM Benchmark, arXiv 2409.06097）：
> "In spoken dialogue, people are accustomed to asking one question at a time because asking too many questions at once can overwhelm the other party, making it difficult for them to remember and respond appropriately."

**关键发现**：
- 多问同时提出时，用户倾向于只回答最后一个或最显眼的一个
- LLM seeker agent 经常犯"一次问多个问题"的错误
- 最佳实践：每轮只提出一个最优先的澄清问题

**例外**：
- 结构化表单场景（收集固定字段）可以批量提问
- 当用户明确要求"列出所有问题"时，可一次给出问题列表供异步回答

> 来源：[ClarQ-LLM: A Benchmark for Models Clarifying and Requesting Information in Task-Oriented Dialog (arXiv 2409.06097)](https://arxiv.org/html/2409.06097v2)

**分类**：共识（对话设计的基本原则，有实验数据支持）

---

### 3.5 结构化提问策略

**来源综合**（NN/G、Conversational UX、Prompt Engineering 多源）：

**最佳实践清单**：

| 实践 | 描述 | 来源 |
|------|------|------|
| 问题有单一目的 | 每个问题只解决一个歧义维度 | [NN/G Chatbot Guidelines](https://www.nngroup.com/articles/ai-chatbots-design-guidelines) |
| 先问最高影响维度 | 优先问答案会最大改变输出的问题（EIG 最高） | [ICLR 2025 Active Task Disambiguation](https://openreview.net/forum?id=JAMxRSXLFz) |
| 避免诱导性问题 | 问题不暗示"正确答案"，保持中性 | [Ferrari et al. RE Interview Guidelines] |
| 总结确认 | 在关键节点用"我理解的是X，对吗？"验证 | [LLMREI 论文 (arXiv 2507.02564)](https://arxiv.org/html/2507.02564v1) |
| 上下文感知 | 问题与用户已提供的信息保持一致，不问已回答的内容 | [ClarQ-LLM](https://arxiv.org/html/2409.06097v2) |
| 错误类型引导 | Prompt 中显式列出"要避免的访谈错误" | [RE Follow-Up Question (arXiv 2507.02858)](https://arxiv.org/html/2507.02858v1) |

---

### 3.6 LLMREI 的 least-to-most prompting

**论文发现**（LLMREI, RE 2025）：

- **Zero-shot prompting**（最简指令）：LLM 能进行基本访谈，但在追问深度和上下文适应性上有局限
- **Least-to-most prompting**（从简到繁，逐步引导）：LLM 展现出高度上下文依赖的问题生成能力，更能根据受访者回答调整下一个问题
- **Fine-tuning**：初步试验效果差，被放弃

**结论**：结构化 System Prompt（含 RE 最佳实践指南）显著提升 LLM 访谈质量，比 Zero-shot 更接近有经验的人类访谈者。

> 来源：[LLMREI (arXiv 2507.02564)](https://arxiv.org/html/2507.02564v1)

---

## 四、何时停止澄清（Over-Clarification 的成本）

### 4.1 停止信号

**来源：Long International (Project Management: Defining Requirements)**

停止需求澄清的指标：
1. 结果已获利益相关者批准
2. 信息模型已完成
3. 提供的信息开始出现冗余（在当前抽象层级上）
4. 没有出现新的高优先级需求
5. 核心业务价值的实现路径已被无歧义需求支撑

> 来源：[Project Management: Defining Requirements for Success (Long International)](https://www.long-intl.com/articles/defining-requirements)

**Software Engineering Stack Exchange 的经验性原则**：
> "Stop gathering requirements when it stops causing meaningful change. It's a bit like microwaving popcorn. Stop when too much time passes between the pops."

> 来源：[Why bother gathering requirements when we know they will change? (SE Stack Exchange)](https://softwareengineering.stackexchange.com/questions/360478/why-bother-gathering-requirements-when-we-know-they-will-change)

---

### 4.2 Bezos 70% 信息量法则

**内容**：Jeff Bezos 在 2016 年亚马逊股东信中提出：在拥有约 70% 理想信息量时做出决策。等到 90% 往往已经太慢。

**原理**：
- 100% 的信息量在现实中几乎不可达
- 90% 的代价是大量等待时间，机会窗口可能关闭
- 70% + 快速迭代纠错 比 完美决策 更符合实际效益
- "如果你善于纠正错误，那么犯错的代价远低于行动迟缓的代价"

**在需求澄清中的应用**：
- 设定"澄清时间盒"（如 Example Mapping 的 25 分钟）
- 超出时间盒 = 停止，记录未解问题（粉色卡片），继续推进
- 定期"检查冗余度"：如果最近两轮问答没有带来需求理解的重大改变，停止

> 来源：[Jeff Bezos's theory for making better decisions (Hola)](https://www.hola.com/us/lifestyle/20260604905587/jeff-bezos-theory-better-decisions-70-percent-information-rule)
> 来源：[How Jeff Bezos Uses Faster, Better Decisions (Forbes, 2018)](https://www.forbes.com/sites/eriklarson/2018/09/24/how-jeff-bezos-uses-faster-better-decisions-to-keep-amazon-innovating)

---

### 4.3 Over-Clarification 的代价

**分析瘫痪（Analysis Paralysis）**来源于过度分析导致无法行动。
- 表现：无休止的需求会议、不断发现新问题、竞争对手已上线而你还在讨论
- 对策（Leadership IQ）：设置决策截止时间；练习"满足即可"（satisficing）而非完美；使用 70% 信息量法则；将大决策拆解为小的可逆决策

> 来源：[Analysis Paralysis (Leadership IQ)](https://www.leadershipiq.com/blogs/leadershipiq/analysis-paralysis)

**对 LLM 澄清的启示**：
- 不要让 LLM 在单次对话中无限追问
- 设置最大轮次限制（通常 3-5 轮后应进入"做出假设并推进"模式）
- 如果澄清问题的答案对最终输出影响很小，跳过该问题

---

## 五、优先级排序：哪些歧义最值得澄清

### 5.1 歧义类型分层

| 优先级 | 歧义类型 | 消歧工具 |
|--------|----------|----------|
| P0 | 目标/范围歧义（做什么 vs 不做什么） | 5 Whys + JTBD |
| P1 | 用户/利益相关者歧义（谁的需求） | 访谈 + Assumption Mapping |
| P2 | 行为/规则歧义（边界条件、异常流） | Example Mapping |
| P3 | 交互/UI 歧义 | 原型 + 用户测试 |
| P4 | 非功能性歧义（性能、安全等） | 访谈 + 问卷 |

### 5.2 MoSCoW + 假设优先级结合

**MoSCoW**（Must/Should/Could/Won't）用于功能优先级。

**Assumption Mapping** 用于风险优先级：高重要性 × 低证据支持的假设优先验证。

结合使用：先用 JTBD 确认 Must-Have 功能对应的真实 Job；再用 Assumption Mapping 找出 Must-Have 中最不确定的假设；用 Example Mapping 对该假设进行具体化验证。

---

## 六、综合对比表

| 技术 | 适用阶段 | 解决的歧义类型 | 时间成本 | 是否需要用户参与 |
|------|----------|---------------|---------|-----------------|
| 访谈 | 早期探索 | 目标/痛点/隐性需求 | 高 | 是 |
| 问卷 | 初筛/验证 | 优先级/规模 | 低 | 是（大规模） |
| 观察 | 早期探索 | 隐性行为/工作流 | 最高 | 是（现场） |
| Event Storming | 领域建模 | 业务流程/边界 | 中-高 | 是（跨团队） |
| 原型 | 验证阶段 | UI/UX/交互 | 中 | 是 |
| 5 Whys | 任何阶段 | 根因/真实意图 | 低 | 可选 |
| JTBD | 策略阶段 | 用户动机/深层需求 | 中 | 是 |
| User Story Mapping | 规划阶段 | 范围/优先级/旅程 | 中 | 跨团队 |
| Assumption Mapping | 发现阶段 | 风险假设 | 低 | 跨团队 |
| Example Mapping | 精化阶段 | 规则/边界条件 | 低（25min） | 三个角色 |
| 设计思维 | 早期探索 | 问题定义/用户共情 | 高 | 是 |
| LLM Active Disambig. | 任何阶段（AI辅助） | 任意语言歧义 | 极低 | 否（AI自动） |

---

## 七、推荐方案

**分阶段推荐**：

1. **模糊想法阶段（What is the problem?）**：
   - 工具：5 Whys + JTBD + 设计思维 Empathize-Define
   - LLM 辅助：Cognitive Verifier Pattern 驱动的结构化子问题拆解

2. **需求定义阶段（What do we build?）**：
   - 工具：User Story Mapping + Assumption Mapping + Event Storming
   - LLM 辅助：Active Task Disambiguation（EIG 最大化问题选择）

3. **Story 精化阶段（How exactly does it work?）**：
   - 工具：Example Mapping（25分钟时间盒，四色卡片）
   - LLM 辅助：基于错误类型框架引导的跟进问题生成（LLMREI 风格）

4. **停止信号**：
   - 应用 Bezos 70% 法则：信息冗余出现时停止
   - 设置时间盒（Example Mapping: 25min）
   - 最近两轮澄清没有改变需求理解 → 停止

---

## 参考来源

| 序号 | 来源标题 | URL | 支撑哪条结论 |
|------|----------|-----|-------------|
| 1 | LLMREI: Automating Requirements Elicitation Interviews with LLMs (RE 2025) | https://arxiv.org/html/2507.02564v1 | LLM 访谈、least-to-most prompting |
| 2 | Active Task Disambiguation with LLMs (ICLR 2025 Spotlight) | https://openreview.net/forum?id=JAMxRSXLFz | EIG 最大化、Bayesian 消歧 |
| 3 | Requirements Elicitation Follow-Up Question Generation (arXiv 2507.02858) | https://arxiv.org/html/2507.02858v1 | 错误类型框架引导 LLM 问题生成 |
| 4 | Introducing Example Mapping - Matt Wynne / Cucumber | https://cucumber.io/blog/bdd/example-mapping-introduction | Example Mapping 原始方法 |
| 5 | Mapping User Stories in Agile - NN/G | https://www.nngroup.com/articles/user-story-mapping | User Story Mapping 方法 |
| 6 | Assumption Mapping: How To Test Product Assumptions \| Maze | https://maze.co/blog/assumption-mapping | Assumption Mapping 方法 |
| 7 | Five whys - Wikipedia | https://en.wikipedia.org/wiki/Five_whys | 5 Whys 起源与局限 |
| 8 | The 5 Stages in the Design Thinking Process \| IxDF | https://ixdf.org/literature/article/5-stages-in-the-design-thinking-process | 设计思维五阶段 |
| 9 | Improved Human-AI Alignment by Asking Smarter Clarifying Questions (Eedi, 2025) | https://www.eedi.com/news/improved-human-ai-alignment-by-asking-smarter-clarifying-questions | Active Task Disambiguation 应用 |
| 10 | ClarQ-LLM: A Benchmark for Models Clarifying... (arXiv 2409.06097) | https://arxiv.org/html/2409.06097v2 | 一次问一个问题原则 |
| 11 | Cognitive Verifier Pattern (Medium) | https://medium.com/@a1guy/prompt-engineering-via-prompt-patterns-cognitive-verifier-pattern-727878a4d372 | Cognitive Verifier Pattern |
| 12 | Comparative Research: Traditional vs Modern Elicitation (FMDB, 2024) | https://www.fmdbpub.com/uploads/articles/173475451926954.%20FTSTPL-231-2024.pdf | 传统 vs 现代技术对比数据 |
| 13 | Why you should consider using Event Storming (Qlerify, 2024) | https://www.qlerify.com/post/why-event-storming | Event Storming 方法 |
| 14 | Why you need a JTBD map (Building Momentum Newsletter) | https://newsletter.buildingmomentum.io/p/jtbd-map | JTBD Map 构建 |
| 15 | Project Management: Defining Requirements (Long International) | https://www.long-intl.com/articles/defining-requirements | 停止澄清的判断标准 |
| 16 | How Jeff Bezos Uses Faster, Better Decisions (Forbes, 2018) | https://www.forbes.com/sites/eriklarson/2018/09/24/how-jeff-bezos-uses-faster-better-decisions-to-keep-amazon-innovating | Bezos 70% 信息量法则 |
| 17 | Analysis Paralysis (Leadership IQ) | https://www.leadershipiq.com/blogs/leadershipiq/analysis-paralysis | Over-Clarification 代价与对策 |
| 18 | Prompt Engineering Guidelines for Using LLMs in RE (arXiv 2507.03405) | https://arxiv.org/html/2507.03405v1 | Cognitive Verifier / CoT 在 RE 中的应用 |
| 19 | Job Stories Revisited - JTBD Toolkit (Medium) | https://jtbdtoolkit.medium.com/job-stories-revisited-13ad0b54eb3c | JTBD Job Story 格式与测试性 |
| 20 | An introduction to assumptions mapping (Mural) | https://www.mural.co/blog/intro-assumptions-mapping | Assumption Mapping 四类假设 |

---

## 附：歧义识别速查卡（可直接用于 Prompt）

```
检测需求歧义的七个维度：
1. Who（谁）：用户是谁？角色不清晰？
2. What（什么）：功能边界在哪里？
3. When（何时）：触发条件/时序是什么？
4. Where（哪里）：在什么上下文/环境？
5. Why（为何）：真实意图/动机是什么？（→ 5 Whys）
6. How much（多少）：规模/量级要求？
7. What if（如果）：异常情况/边界条件？（→ Example Mapping）
```

---

*本报告基于 2026-07-02 检索结果，核心 AI 澄清技术（Active Task Disambiguation、LLMREI）处于快速发展中，建议 3-6 个月更新一次。*
