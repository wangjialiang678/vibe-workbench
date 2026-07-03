---
title: AI 编码 agent 人机交互(HITL)模式与 vibe coding 社区实践
date: 2026-07-02
topic: hitl-vibecoding
status: active
audience: both
tags: [research, hitl, vibe-coding, agentic-engineering, spec-driven, cognitive-load, cursor, claude-code, devin, copilot]
type: 原始调研
sources:
  - https://x.com/karpathy/status/1886192184808149383
  - https://cursor.com/blog/plan-mode
  - https://docs.devin.ai/release-notes/2025
  - https://github.com/mikepenz/agent-belay
  - https://arxiv.org/html/2510.17842v1
  - https://arxiv.org/html/2606.05391
  - https://codeongrass.com/blog/core-agentic-workflow-task-plan-review-approve-pr/
  - https://www.agentnative.dev/patterns/human-in-the-loop-approval-flow-pattern
  - https://github.com/OWASP/AISVS/blob/main/research/chapters/C09-Orchestration-and-Agents/C09-02-High-Impact-Action-Approval.md
verified: 2026-07-02
shelf_life: 快速变化
---

# 调研报告: AI 编码 agent 人机交互(HITL)模式与 vibe coding 社区实践

**日期**: 2026-07-02
**任务**: 调研 vibe coding 起源、HITL 交互模式、现实工具实践、认知负荷管理

---

## 调研摘要

Andrej Karpathy 于 2025 年 2 月发布的"vibe coding"概念已从探索性口号演变为工业实践讨论的核心议题。社区在 2025-2026 年经历了从纯粹 vibe coding 到"spec over vibe"的明显回潮，安全事故与生产故障是催化剂。与此同时，Cursor、Claude Code、Devin、AWS Kiro 等工具均已将 human-in-the-loop 的"计划-审批-执行"模式内化为默认工作流。认知负荷（AI brain fry）已成为新兴研究领域，BCG 调查量化了多 agent 管理的注意力崩溃临界点。

---

## 一、起源与定义演变

### 1.1 原始定义（2025 年 2 月）

**来源**: Karpathy 原推 [x.com/karpathy/status/1886192184808149383](https://x.com/karpathy/status/1886192184808149383)

关键原文（已验证）：
> "There's a new kind of coding I call 'vibe coding', where you fully give in to the vibes, embrace exponentials, and forget that the code even exists."
> "I 'Accept All' always, I don't read the diffs anymore."
> "Sometimes the LLMs can't fix a bug so I just work around it or ask for random changes until it goes away."

背景：Karpathy 当时描述的是个人探索性项目（throwaway projects），使用 Cursor Composer + SuperWhisper 语音交互，主动放弃 diff 阅读。他本人事后（2026 年一周年）称这是"shower thoughts throwaway tweet"，但"意外命名了一个时代的感受"。

### 1.2 定义漂移

**来源**: [coderabbit.ai/blog/a-semantic-history-how-the-term-vibe-coding](https://coderabbit.ai/blog/a-semantic-history-how-the-term-vibe-coding-went-from-a-tweet-to-prod)

- Merriam-Webster 在 2025 年 3 月将 vibe coding 收录为俚语，定义为"以 AI 辅助以某种粗心方式编写计算机代码"
- Collins Dictionary 将 vibe coding 评为 2025 年年度词汇
- 2025 年全年，该词被广泛滥用，逐渐泛指"任何提示驱动的开发"，负面含义增加
- 到 2025 年底，"在生产系统中依赖 vibe coding"已带有明显的贬义

### 1.3 Karpathy 自身的演变（2026 年）

**来源**: [x.com/karpathy/status/2019137879310836075](https://x.com/karpathy/status/2019137879310836075) (一周年纪念帖)

> "Agentic engineering: 'agentic' because the new default is that you are not writing the code directly 99% of the time, you are orchestrating agents who do and acting as oversight."

Karpathy 在 2026 年 2 月前后提出"agentic engineering"作为 vibe coding 的成熟替代框架，强调：
- 人作为"工程总监"而非"提示 DJ"
- 代理处理机械实现，人保留架构判断
- "oversight"（监督）成为核心职责

另见 Karpathy 在 Sequoia AI Ascent 2026（2026 年 4 月）的演讲中强调"verifier in the loop"概念：
**来源**: [youtube.com/watch?v=96jN2OCOfLs](https://www.youtube.com/watch?v=96jN2OCOfLs)

---

## 二、"Spec over Vibe"回潮

### 2.1 社区批评声音

**来源**: [medium.com/@addyosmani/vibe-coding-is-not-the-same-as-ai-assisted-engineering](https://medium.com/@addyosmani/vibe-coding-is-not-the-same-as-ai-assisted-engineering-3f81088d5b98)（Addy Osmani，Chrome 工程团队）

关键数据（已验证）：
- 2025 年 8 月 Final Round AI 对 18 位 CTO 的调查：**16 位**报告经历了由 AI 生成代码直接导致的生产故障
- Canva CTO Brendan Humphreys 的原话："vibe coding 最危险的特征是代码'看起来运行完美，直到灾难性失败'"
- 研究发现：使用 AI 编码工具的开发者编写了更不安全的代码，但同时对其安全性报告更高的信心（ACM Digital Library，斯坦福 RCT）

**来源**: [retool.com/blog/ai-governance-report-2026](https://retool.com/blog/ai-governance-report-2026)（Retool，调查 307 位 CTO/CIO/CISO）

- **93%** 的高级技术和安全领导者对生产中的 vibe coding 工具感到担忧
- 22% 的组织在过去 12 个月内至少经历过一次 AI 生成内部工具引发的生产事故

**来源**: [research.gatech.edu/bad-vibes-ai-generated-code-vulnerable](https://research.gatech.edu/bad-vibes-ai-generated-code-vulnerable-researchers-warn)（Georgia Tech，2026 年 4 月）

- 扫描超过 43,000 个安全公告
- 2025 年下半年 Vibe Security Radar 发现约 18 个案例（7 个月）
- 2026 年前 3 个月发现 56 个，仅 3 月一个月就有 35 个（超过 2025 全年）

### 2.2 安全统计与事故

**来源**: [medium.com/@Reiki32/why-vibe-coding-is-going-to-create-the-worst-software-crisis](https://medium.com/@Reiki32/why-vibe-coding-is-going-to-create-the-worst-software-crisis-in-history-1a0b666a9b0c)

- Veracode 2025 年报告：约 45% 的 AI 生成代码样本在安全测试中失败，包含 OWASP Top 10 中的关键漏洞
- GitClear 分析 2.11 亿行代码（含 Google、Microsoft、Meta）：AI 工具后，代码体积增加 10%，但重构比例从 25% 降至 10%，代码粘贴比例从 8.3% 升至 12.3%
- 2025 年 7 月 Tea App 被黑：暴露约 72,000 张图片（13,000 张政府 ID 照片）
- 2025 年 5 月 Lovable 平台：CVE-2025-48757，暴露 170+ 个生产应用，Supabase 表缺少行级安全

### 2.3 Spec-Driven Development（SDD）兴起

**来源**: [thebcms.com/blog/spec-driven-development](https://thebcms.com/blog/spec-driven-development)

SDD 于 2025 年作为 vibe coding 的直接反应出现，核心思路：**先写规范（spec），再生成代码**。

主要工具生态（到 2026 年）：
- **GitHub Spec Kit**：开源 CLI，兼容 30+ agent，DeepLearning.AI 于 2025 年底推出专项课程
- **AWS Kiro**（2025 年 11 月 GA）：Spec/Vibe 双模式并存，"living specs"概念——规范版本化，不再消失在聊天历史中
- **Claude Code SDD skills**：通过 SKILL.md 实现可复用 spec-driven 工作流
- **Cursor Plan Mode**：2025 年 10 月发布（详见下节）

**来源**: [redmonk.com/kholterhoff/2025/09/08/the-endless-hot-vibe-code-summer](https://redmonk.com/kholterhoff/2025/09/08/the-endless-hot-vibe-code-summer)（RedMonk 分析）

> "AWS 明确在 IDE 中内置了'vibe coding'按钮……而 spec 模式要求 AI 先从你那里收集需求规格，然后设计，然后在每步都需要你签字后实施。"

---

## 三、HITL 交互模式分类

### 3.1 Plan-then-Execute（计划-执行分离）

这是 2025-2026 年最主流的 HITL 模式，核心原则：**计划阶段和执行阶段彼此隔离，人在中间决策**。

**来源**: [codeongrass.com/blog/core-agentic-workflow-task-plan-review-approve-pr](https://codeongrass.com/blog/core-agentic-workflow-task-plan-review-approve-pr/)（CORE 工作流，2026 年 4 月）

CORE 工作流（r/ClaudeCode 社区实践）步骤：
1. 写结构化任务文件（含范围约束和明确停止指令）
2. 运行规划 session——agent 起草计划并写入磁盘后停止
3. 审查计划文件（可手动编辑），无修改即视为批准
4. 运行独立的执行 session，读取已批准计划并返回 diff
5. QA inspector agent 在合并前审计 diff 的范围违规
6. 审查 PR diff 并合并

关键架构决策："计划和执行是独立调用，而不是一次长 session 中的内部检查点——单次 session 中'先计划再等批准'的指令是不可靠的"。

**来源**: [aipatternbook.com/plan-mode.md](https://aipatternbook.com/plan-mode.md)（AI Pattern Book）

- Plan Mode 第一阶段：探索、阅读文件、提出计划（**不修改文件**）
- Plan Mode 第二阶段：人类审查并批准后，agent 实施（变更遵循已商定计划，偏差需标注）

**来源**: [github.com/s977043/PlanGate](https://github.com/s977043/PlanGate)（PlanGate，治理优先的工作流约束框架）

两个固定人类审批门控：
- **C-3 门**：计划审查后、实施前（APPROVE / CONDITIONAL / REJECT）
- **C-4 门**：AI 实施后、GitHub PR 合并前（APPROVE / REQUEST CHANGES）

### 3.2 Confidence-Gated Approval（置信度门控审批）

**来源**: [docs.devin.ai/release-notes/2025](https://docs.devin.ai/release-notes/2025)（Devin 官方发布说明）

Devin 在 2025 年引入置信度分数机制（颜色编码）：
- 在每个 session 的多个节点表达置信度：session 开始时、创建计划后、回答代码问题时
- **置信度非绿色（黄或红）时，Devin 自动等待用户审批再继续**；绿色时自动推进
- 企业数据显示置信度分数与任务成功率高度相关
- 支持通过 Jira/Linear 集成批量评分，无需实际开启 session

这是**条件性 HITL**：只在不确定时介入人类，而非每步都要人确认。

### 3.3 Diff Review Gate（差异审阅门控）

**来源**: [vercel.com/blog/introducing-the-new-v0](https://vercel.com/blog/introducing-the-new-v0)（v0 2026 年 2 月重构发布）
**来源**: [genaipm.com/wiki/tools/v0](https://genaipm.com/wiki/tools/v0)（v0 diff view 功能，2026 年 3 月 20 日上线）

v0 2026 年引入以 Git 工作流为中心的 HITL：
- 每次对话创建新分支，对 main 提 PR
- PR 是一等公民，预览映射到真实 Vercel 部署
- 专用 **diff view**（逐文件差异、行数统计、提交信息）用于人工审阅
- 任何团队成员（非工程师）可通过此流程 ship 生产代码

### 3.4 Tool-Level Approval（工具级审批）

**来源**: [github.com/mikepenz/agent-belay](https://github.com/mikepenz/agent-belay)（Agent Belay，2026 年 4 月）

Agent Belay 是 Claude Code 和 GitHub Copilot 的 HITL 网关，拦截工具请求（文件编辑、shell 命令、Web 抓取）并在本地审批 UI 中呈现：
- **Protection Engine**：阻止危险操作（破坏性命令、凭据访问、供应链攻击）
- **Approval UI**：语法高亮 diff、命令预览、上下文
- **风险评分**：可选的 AI 驱动评分（1-5 级），自动批准安全操作
- **Always Allow**：为受信任的工具模式授予持久权限
- 集成方式：PreToolUse hook（Claude Code）、PermissionRequest（GitHub Copilot）

### 3.5 Risk-Based Action Classification（基于风险的行动分类）

**来源**: [agentnative.dev/patterns/human-in-the-loop-approval-flow-pattern](https://www.agentnative.dev/patterns/human-in-the-loop-approval-flow-pattern)（Agent Native，2026 年 3 月）

现代 HITL 实现的五步控制循环：
1. agent 接收任务
2. agent 提出行动（附完整参数）
3. agent 暂停，将请求路由给人工审批者
4. 人工审查上下文，批准或拒绝
5. 仅在获批后 agent 才继续

路由策略：
- CUD（创建/更新/删除）操作 → 需审批
- 置信度低于阈值（通常 85%）→ 需审批（无论操作类型）
- 审批请求写入持久存储，含：行动负载、完整上下文摘要、agent 推理链、不确定性信号
- **HMAC 签名锁定已批准负载**，防止审批到执行之间的负载篡改

**来源**: [github.com/OWASP/AISVS/blob/main/research/chapters/C09-Orchestration-and-Agents/C09-02-High-Impact-Action-Approval.md](https://github.com/OWASP/AISVS/blob/main/research/chapters/C09-Orchestration-and-Agents/C09-02-High-Impact-Action-Approval.md)（OWASP AISVS，2025-2026）

- 截至 2026 年初，约 70% 的组织运行"agent 推荐、人工批准"的 HITL 模式，只有 14% 允许完全自主修复
- Gartner 2026 年 3 月预测：40% 的企业应用将在 2026 年底嵌入 agent 能力（2025 年为 12%）
- 现有框架的缺口：LangGraph 的 `interrupt()` 暂停图执行并持久化状态，但**不**发送通知、不触发超时、不升级审批者——需外部 orchestrator（Temporal 等）补足

---

## 四、现实工具的人机确认实现

### 4.1 Cursor Plan Mode

**来源**: [cursor.com/blog/plan-mode](https://cursor.com/blog/plan-mode)（官方博客，2025 年 10 月 7 日发布）

核心机制：
- **激活**：在 agent 输入框按 `Shift + Tab`（Windows 用 `Alt + M`；v2.1.0+ 支持 `/plan` 命令）
- **阶段一**：agent 研究代码库（找相关文件、查文档、问澄清问题），生成结构化 Markdown 计划（含文件路径和代码引用），**不写代码**
- **阶段二**：人工审阅计划（可内联编辑），确认后 agent 执行
- Cursor 2.1 引入**澄清 UI**：agent 检测请求歧义时主动暂停提问
- Cursor 2.2（2025 年 12 月）增加 Mermaid 图表 + 任务可委派

引用（Janea Systems 分析）："这将交互从'提示和祈祷'转变为'计划和批准'"
**来源**: [janeasystems.com/blog/your-next-developer-ai-agent-cursor-vs-copilot](https://www.janeasystems.com/blog/your-next-developer-ai-agent-cursor-vs-copilot)

### 4.2 Claude Code Plan Mode

**来源**: [codewithmukesh.com/blog/plan-mode-claude-code](https://codewithmukesh.com/blog/plan-mode-claude-code)

七种权限模式（从高到低自主度）：
- `plan`：用户批准所有计划后才执行（只读阶段，不修改文件）
- `default`：标准交互审批
- `acceptEdits`：允许文件编辑和常见文件系统命令
- `auto`：长任务，后台安全检查
- `bypassPermissions`：最低提示

激活方式：
- `Shift + Tab` 循环切换（Windows 部分终端有冲突）
- `/plan` 命令（v2.1.0+）
- `claude --permission-mode plan`（CLI 启动）
- 设为默认：`.claude/settings.json` 中 `permissions.defaultMode: "plan"`

**来源**: [arxiv.org/html/2604.14228v1](https://arxiv.org/html/2604.14228v1)（Claude Code 设计空间论文，2026 年 4 月）

- Plan mode 的 agent teams 消耗约为标准 session 的 **7×** tokens
- Claude Code 的 "summary-only return" 模型（子 agent 只返回摘要，不共享完整 transcript）是上下文保护的关键设计

**来源**: [helpnetsecurity.com/2026/03/25/anthropic-claude-code-auto-mode-feature](https://www.helpnetsecurity.com/2026/03/25/anthropic-claude-code-auto-mode-feature)

Auto mode（2026 年 3 月，需 Team 计划 + 管理员批准）：
- AI 代为做审批决策，分类器（classifier）评估行动安全性
- 默认信任本地工作目录和配置的 git 远程仓库
- 如分类器重复触发阻止，升级给用户

### 4.3 GitHub Copilot Workspace

**来源**: [markets.financialcontent.com/wral/article/tokenring-2026-1-9-the-autodev-revolution](https://markets.financialcontent.com/wral/article/tokenring-2026-1-9-the-autodev-revolution-how-devin-and-github-copilot-workspace-redefined-the-engineering-lifecycle)

- Copilot Workspace 典型 HITL 模式：**开发者引导 AI 逐步完成任务**（Human-in-the-Loop 模型）
- 2025 年 7 月架构升级：从简单 LLM 调用升级为 agent 系统（自导航代码库、深度分析、组件关系理解）
- **Copilot 代码审查**（2025 年 4 月 GA，此前百万+开发者参与预览）：在 PR 上留下"Comment"级别评审（不阻断合并）
- Copilot Coding Agent：在 GitHub Actions 驱动的沙盒中独立工作，创建 PR 供人工审阅，**不自动合并**
- Repository Rules 集成：可在组织或仓库级强制要求每个 PR 由 Copilot 审阅

**来源**: [augmentcode.com/tools/github-copilot-ai-code-review](https://www.augmentcode.com/tools/github-copilot-ai-code-review)

- Copilot 代码审查 2025 年 4 月 GA
- Copilot 目前仅创建 PR，不自动合并——PR 本身是 HITL 的核心机制

### 4.4 Devin

**来源**: [docs.devin.ai/release-notes/2025](https://docs.devin.ai/release-notes/2025)（官方发布说明）

关键 HITL 特性时间线：
- **置信度分数系统**（绿/黄/红）：在 session 开始、计划创建后、回答代码问题时表达
  - 非绿色 → 等待用户审批
  - 绿色 → 自动推进
- **Interactive Planning（互动规划）**：用户在 Devin 开始执行前审阅并编辑计划
- **Devin Spaces**（早期预览）：执行前的互动精炼沙盒
- 可通过 Jira/Linear 批量评估多个 issue 的置信度（不开启实际 session）

**来源**: [cognition.com/blog/devin-annual-performance-review-2025](https://cognition.com/blog/devin-annual-performance-review-2025)（Cognition 2025 年度复盘）

- Devin 的主要局限：**处理歧义性需求时表现不佳**，需要人做好前期范围定义
- 对视觉设计等主观任务需要具体参数（颜色代码、间距值）
- "工程师需要学会'管理'Devin"

### 4.5 AWS Kiro（Spec/Vibe 双模式）

**来源**: [redmonk.com/kholterhoff/2025/09/08/the-endless-hot-vibe-code-summer](https://redmonk.com/kholterhoff/2025/09/08/the-endless-hot-vibe-code-summer)（RedMonk，2025 年 9 月）
**来源**: [augmentcode.com/guides/vibe-coding-vs-spec-driven-development](https://www.augmentcode.com/guides/vibe-coding-vs-spec-driven-development)

Kiro 特性（2025 年 11 月 GA，预览期 250,000+ 开发者）：

| 模式 | 行为 |
|------|------|
| **Vibe 模式** | 直接描述 → agent 生成代码和基础设施，自行做出大量假设 |
| **Spec 模式** | 收集需求 → 生成设计文档 → 生成任务清单 → 人工逐步确认实施 |

"Living specs"创新：规范文件版本化存储，需求变更时更新文件而非让决策消失在聊天历史中。

---

## 五、认知负荷与注意力管理

### 5.1 AI Brain Fry（认知过载）

**来源**: [builtin.com/articles/ai-brain-fry-software-developers](https://builtin.com/articles/ai-brain-fry-software-developers)（Built In，2026 年 6 月，引用 BCG 研究）

Boston Consulting Group 调查近 1,500 名工作者：
- **14%** 报告"精神宿醉"（mental hangover），与应对超出认知容量的 AI 工具相关
- 生产力模式：第 1→2→3 个 agent，生产力递增；**第 4 个 agent 起生产力下降**
- 4-10 个 agent 来回切换时，大脑更容易不堪重负

关键机制：AI agent 通常比人类思考更快，用户失去对 agent 如何产生输出的理解，导致难以纠错或推进。

### 5.2 CHI 2026 研究：认知参与度下降

**来源**: [ai-tools-for-thought.github.io/workshop/documents/chi26/Catalan_et_al_Cognitive_Engagement_with_Coding_Assistants_TfT_CHI26.pdf](https://ai-tools-for-thought.github.io/workshop/documents/chi26/Catalan_et_al_Cognitive_Engagement_with_Coding_Assistants_TfT_CHI26.pdf)（CHI 2026 Workshop 论文）

- 软件工程师与 agentic coding assistants 交互时，随着交互进展，认知参与度**显著下降**
- 导致参与者忽视关键细节
- 设计建议：
  - **多模态交互**（可视化 + 语音）维持参与度
  - **认知强制设计**（cognitive forcing designs）——主动引发反思而非立即提供解答
  - 将 ACA 定位为"结对编程伙伴"，支持丰富沟通和教学支架

### 5.3 过程导向可解释性（Process-Oriented Explainability）

**来源**: [arxiv.org/pdf/2604.16323](https://arxiv.org/pdf/2604.16323)（arXiv 2026 年 4 月）

提出 PoE（Process-oriented Explainability）框架：
- 将 agent 的推理过程映射为因果图，供轻量级全局监督
- 引入"认知完整性阈值"（CIT）：维持有实质意义的监督所需的最低理解水平
- 当审查者对因果图的参与度下降至 CIT 以下时，触发干预
- 提出"认知债务指数"（cognitive debt index）作为实际度量指标

### 5.4 认知负荷理论视角

**来源**: [innoq.com/en/blog/2026/03/ai-cognitive-lens-cognitive-load-theory](https://www.innoq.com/en/blog/2026/03/ai-cognitive-lens-cognitive-load-theory/)（INNOQ，2026 年 3 月）

- AI 工具同时**增加外在认知负荷**（上下文切换、提示工程、输出验证）并**抑制生成认知负荷**（建立专业技能的有效挣扎）
- Split-attention effect（分散注意力效应）：AI 生成代码需要同时处理多个相互依赖的信息源，认知负荷激增
- 建议：使用 Sweller 的整合格式原则——将信息源合并，每次活跃整合的信息源数量不超过 2 个

**来源**: [clearing-ai.com/cognitive-load.html](https://clearing-ai.com/cognitive-load.html)（2026 年 3 月）

减少认知负荷的实践：
- 批量 AI 交互（不频繁切换）
- 完成当前思路再求助 AI
- 为 AI 生成代码留出完整的理解 session
- 安排每日无 AI 时段重建生成认知负荷

### 5.5 "Agentic Fatigue"（代理疲劳）

**来源**: [explainx.ai/blog/agentic-fatigue-vibe-coding-ai-developer-productivity-paradox](https://explainx.ai/blog/agentic-fatigue-vibe-coding-ai-developer-productivity-paradox)（2026 年 4 月）

Agentic fatigue 定义：管理 AI 编码 agent 产生的认知过载——持续微决策（是否信任输出、何时介入、如何重定向）导致。

---

## 六、决策点上浮与默认下沉

### 6.1 "只看该看的"设计模式

**来源**: [prickles.org/tenet/the-intern-pattern/AI1](https://prickles.org/tenet/the-intern-pattern/AI1)（The Intern Pattern，Prickles，2026 年 5 月）

"Intern Pattern"四步循环（plan → approve → execute → review）的设计哲学：
- 计划是**合同**，批准是**门控**——在人工或 orchestrator 签字前不做任何编辑
- 在小型、可审阅的单元中执行
- Agent 先对自己的工作打分（AI6 Self-Review Pass），人再评估结果，两个门控都关闭才能合并
- "跳过一步，就会以机器速度产生似是而非的错误"

Karpathy 的表述（Sequoia 2026 演讲）："语言模型自动化了可以被验证的东西。"——自主性滑块、生成-验证循环，以及 vibe coding 与 agentic engineering 的区别，都在于验证者在不在循环中。

### 6.2 可见度分层

社区实践中涌现的两种设计方向：

**决策点上浮**（Decision Points Surfaced）：
- 只在置信度低或操作风险高时请求批准（Devin 置信度门控）
- 只在 CUD 操作或特定风险类别时路由审批（Agent Native 模式）
- 分阶段渐进揭示计划细节（Cursor Plan Mode + 澄清 UI）

**低风险操作下沉**（Low-Risk Actions Sunk）：
- Always Allow 规则（Agent Belay）：为受信任工具模式授予持久权限
- Auto mode（Claude Code）：分类器自主判断安全行动，不打扰用户
- `acceptEdits` 权限模式（Claude Code）：文件编辑自动通过，危险操作仍需确认

---

## 七、Vibe Coding vs Agentic Engineering 对比

**来源**: [codex.danielvaughan.com/2026/03/29/vibe-coding-vs-agentic-engineering](https://codex.danielvaughan.com/2026/03/29/vibe-coding-vs-agentic-engineering/)（2026 年 3 月）

| 维度 | Vibe Coding | Agentic Engineering |
|------|-------------|---------------------|
| 设计阶段 | 跳过——直接提示 | 先产出规范或计划 |
| Agent 指令 | 临时提示 | 版本化 AGENTS.md + WORKFLOW.md |
| 审阅立场 | 无批判接受输出 | 把每个 PR 当初级工程师的作品审阅 |
| 测试 | 可选 | 测试是 agent 的反馈循环 |
| 上下文管理 | 崩溃前忽视 | 结构化：压缩、子 agent 委派 |
| 失败模式 | 自信的错误输出 | 可在门控处检测 |

---

## 八、尚存争议与开放问题

1. **全自主与 HITL 的边界**：Devin 目标"Goal-Oriented Autonomy"，Copilot Workspace 目标"Human-in-the-Loop"——业界尚无共识哪种更适合哪类任务。

2. **LangGraph/CrewAI checkpoint vs 生产级审批工作流**：框架原生支持的 checkpoint 是否足够？Diagrid 2026 年 3 月分析指出两者不等价，生产级审批还需外部 orchestrator。
   **来源**: [agentnative.dev/patterns/human-in-the-loop-approval-flow-pattern](https://www.agentnative.dev/patterns/human-in-the-loop-approval-flow-pattern)

3. **认知完整性阈值如何量化**：CIT 的理论框架已提出，但经验基准尚无。

4. **规范疲劳（Spec fatigue）**：SDD 增加前期成本，小项目/快速原型下是否值得？社区对此仍有争议。

5. **AI 代码审查的"盲引盲"问题**：Addy Osmani 指出，用 AI 辅助审查 AI 生成代码可能造成"机器验证机器"的空洞审阅循环。

6. **认知负荷的长期影响**：短期研究（35 分钟任务）与长期技能发展之间的关系尚不清晰；"generation-then-comprehension"策略的长期效果待验证。

---

## 参考来源

### 一手来源（官方/作者原文）

1. [Andrej Karpathy — 原始 vibe coding 推文 (2025-02-02)](https://x.com/karpathy/status/1886192184808149383) — 定义来源
2. [Andrej Karpathy — 一周年纪念帖与"agentic engineering"提出 (2026-02)](https://x.com/karpathy/status/2019137879310836075) — 演变来源
3. [Cursor — Introducing Plan Mode (2025-10-07)](https://cursor.com/blog/plan-mode) — Cursor HITL 实现
4. [Devin — 2025 Release Notes](https://docs.devin.ai/release-notes/2025) — Devin 置信度门控
5. [Vercel — Introducing the new v0 (2026-02)](https://vercel.com/blog/introducing-the-new-v0) — v0 Git-first HITL
6. [Agent Belay — GitHub (2026-04)](https://github.com/mikepenz/agent-belay) — 工具级审批网关
7. [Anthropic — Claude Code Auto Mode (2026-03)](https://www.helpnetsecurity.com/2026/03/25/anthropic-claude-code-auto-mode-feature) — Auto mode 功能

### 社区实践与分析

8. [CORE 工作流 — codeongrass.com (2026-04)](https://codeongrass.com/blog/core-agentic-workflow-task-plan-review-approve-pr/) — 计划-执行分离的社区实践
9. [PlanGate — github.com/s977043/PlanGate](https://github.com/s977043/PlanGate) — C-3/C-4 门控框架
10. [AI Pattern Book — Plan Mode](https://aipatternbook.com/plan-mode.md) — 模式文档
11. [Agent Native — HITL Approval Flow (2026-03)](https://www.agentnative.dev/patterns/human-in-the-loop-approval-flow-pattern) — 5步控制循环 + HMAC
12. [OWASP AISVS — High-Impact Action Approval](https://github.com/OWASP/AISVS/blob/main/research/chapters/C09-Orchestration-and-Agents/C09-02-High-Impact-Action-Approval.md) — 70% HITL 统计

### 批评与反思

13. [Addy Osmani — Vibe Coding is not AI-Assisted Engineering](https://medium.com/@addyosmani/vibe-coding-is-not-the-same-as-ai-assisted-engineering-3f81088d5b98) — CTO 调查 + 社区批评
14. [Retool — AI Governance Report 2026](https://retool.com/blog/ai-governance-report-2026) — 93% 担忧统计
15. [Georgia Tech — Bad Vibes (2026-04)](https://research.gatech.edu/bad-vibes-ai-generated-code-vulnerable-researchers-warn) — 安全事故统计
16. [RedMonk — Vibe Code Summer (2025-09)](https://redmonk.com/kholterhoff/2025/09/08/the-endless-hot-vibe-code-summer) — AWS Kiro Spec/Vibe 分析

### 学术研究

17. [CHI 2026 Workshop — Cognitive Engagement with ACAs](https://ai-tools-for-thought.github.io/workshop/documents/chi26/Catalan_et_al_Cognitive_Engagement_with_Coding_Assistants_TfT_CHI26.pdf) — 认知参与度下降研究
18. [arXiv 2604.16323 — Process-Oriented Explainability](https://arxiv.org/pdf/2604.16323) — CIT 框架
19. [arXiv 2510.17842 — Vibe Coding: AI-Native Paradigm](https://arxiv.org/html/2510.17842v1) — 学术形式化定义
20. [arXiv 2604.14228 — Claude Code Design Space](https://arxiv.org/html/2604.14228v1) — 7 种权限模式分析
21. [INNOQ — AI Cognitive Load Theory (2026-03)](https://www.innoq.com/en/blog/2026/03/ai-cognitive-lens-cognitive-load-theory/) — 认知负荷分析
22. [Built In — AI Brain Fry (2026-06)](https://builtin.com/articles/ai-brain-fry-software-developers) — BCG 研究引用
23. [arXiv 2606.05391 — Human Oversight of Agentic Systems](https://arxiv.org/html/2606.05391) — 开发者监督实践研究

### Spec-Driven Development

24. [thebcms.com — SDD 2026 Guide](https://thebcms.com/blog/spec-driven-development) — SDD 工具生态
25. [augmentcode.com — Vibe vs SDD](https://www.augmentcode.com/guides/vibe-coding-vs-spec-driven-development) — AWS Kiro 双模式分析
26. [codex.danielvaughan.com — Vibe vs Agentic (2026-03)](https://codex.danielvaughan.com/2026/03/29/vibe-coding-vs-agentic-engineering/) — 对比框架

---

*本报告基于 2026 年 7 月 2 日前的公开资料。AI 工具特性更新迅速，建议 3 个月内复验工具能力部分。*
