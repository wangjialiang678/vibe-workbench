---
title: UI 与交互设计意图澄清方法全景调研
date: 2026-07-02
topic: ui-interaction-clarify
status: active
audience: both
tags: [research, ui-design, ux-process, design-brief, wireframe, prototype, ai-ui, design-tokens, interaction-spec]
type: 原始调研
sources:
  - IxDF Design Briefs (ixdf.org)
  - Nielsen Norman Group (nngroup.com)
  - Toptal Design Blog (toptal.com)
  - MindStudio AI Blog (mindstudio.ai)
  - Lenka Studio (lenkastudio.com)
  - Figr Design (figr.design)
  - UX Tigers / Jakob Nielsen (uxtigers.com)
  - Gökhan Meriç (gokhanmeric.com)
  - Tijocreative (tijocreative.com)
  - Sketch2Code / NAACL 2025 (arxiv.org)
verified: 2026-07-02
shelf_life: 需定期更新
---

# 调研报告: UI 与交互设计意图澄清方法全景

**日期**: 2026-07-02
**任务**: 在动手或让 AI 生成 UI 之前，澄清设计意图的产物层级、交互澄清方法、以及 AI 时代新范式

---

## 调研摘要

UI 设计在执行前的澄清工作本质上是一个从"抽象意图"向"可执行规格"逐步细化的过程，分为若干递进层级：设计简报(Design Brief) → 参考图/情绪板(Mood Board) → 信息架构(IA)/用户流程图(User Flow) → 低保真线框(Wireframe) → 高保真原型(Prototype) → 交互规格(Interaction Spec) → 设计 Token/设计系统(Design Tokens/Design System)。传统方法以 Figma 标注与原型走查为核心，AI 时代则追加了截图驱动(screenshot-to-code)与视觉规格 prompt 两条新路径，要求在 prompt 中精确传达风格密度、状态覆盖、设计 token 等信息，才能避免 AI 输出落入通用默认样式。

---

## 一、产物层级详解

### 1. 设计简报 (Design Brief)

**定义**: 描述项目目标、目标用户、约束与交付物的综合文档，是整个设计过程的"合同"与"路线图"。

**核心组成部分**（共识）：
- Project Overview（项目概述）
- Target Audience（目标用户 + 人口特征 + 行为）
- Goals & Objectives（SMART 目标）
- Deliverables（线框图、原型、最终设计文件等）
- Budget & Timeline（预算与时间线）
- Constraints（技术/品牌约束）
- References（参考案例/竞品）
- Competitor Analysis（竞品分析）

**最佳实践**（共识）：
- 与客户/利益相关方协作撰写，不由设计师单方面填写
- 保持简洁聚焦，但细节要足以消除歧义
- 使用设计简报模板可节省时间并保持一致性

**来源**:
- IxDF Design Briefs: https://ixdf.org/literature/topics/design-briefs
- Asana Design Brief Guide: https://asana.com/resources/design-brief
- Intellectsoft: https://www.intellectsoft.net/blog/understanding-design-briefs

---

### 2. 情绪板 / 参考图 (Mood Board)

**定义**: 视觉集合，包含图像、颜色、字体、纹理、图案，用于在设计开始前建立视觉语言的共识。

**内容构成**（共识）：
- 颜色调色板（含色值）
- 字体系统（Font Pairings）
- 图像风格（摄影基调、插图风格）
- UI 截图参考（其他产品的交互模式）
- 语气词汇（Tone-of-voice words）
- 交互设计模式（Interaction patterns）

**NN/G 的三步法**（共识）：
1. 头脑风暴：写出情绪词汇（如 motivational / energetic / bright）
2. 收集视觉素材：Google Images / Pinterest / Behance / Dribbble / 实体杂志
3. 组织呈现：可异步协作（多人贡献到同一板）

**价值**（共识）：
- 对齐团队对视觉方向的理解（消除"我以为是这种风格"的分歧）
- 为后续视觉风格指南（Visual Style Guide）提供输入
- 尤其适合在 Brief 敲定后、原型开始前使用

**来源**:
- NN/G Mood Boards: https://www.nngroup.com/articles/mood-boards
- Toptal Guide to Mood Boards: https://www.toptal.com/designers/brand/guide-to-mood-boards
- UX Planet: https://uxplanet.org/a-comprehensive-guide-to-creating-mood-boards-for-brand-identity-and-ux-design-projects-3243790ca5f9

---

### 3. 信息架构 (Information Architecture, IA)

**定义**: 数字产品中内容和功能的组织结构，包含导航、分类体系、标签系统。

**核心方法**（共识）：
- **卡片分类 (Card Sorting)**：参与者将内容分组，揭示用户心智模型
  - 开放式卡排：用户自定义分类名称
  - 封闭式卡排：分类名称预定义，用户归类
- **树形测试 (Tree Testing)**：验证现有 IA，用户仅凭链接文字导航
- **站点地图 (Sitemap)**：层级图，呈现所有页面与关系

**流程**（共识）：
1. 内容盘点 + 卡片分类 → 确定分类体系
2. 定义导航 → 创建站点地图
3. 树形测试 → 验证标签清晰度

**来源**:
- NN/G Card Sorting: https://www.nngroup.com/articles/card-sorting-definition
- CareerFoundry IA Guide: https://careerfoundry.com/en/blog/ux-design/a-beginners-guide-to-information-architecture
- Eleken IA: https://www.eleken.co/blog-posts/information-architecture

---

### 4. 用户流程图 (User Flow)

**定义**: 用户完成特定任务所需交互步骤的可视化表示。

**与站点地图的区别**（共识）：
- 站点地图 = 30,000 英尺俯视（结构全景）
- 用户流程图 = A→B 的具体路径（决策节点、分支、成功/失败路径）

**组成元素**（共识）：
- 起点（Entry point）
- 决策节点（Diamonds）
- 操作步骤（Rectangles）
- 成功/结束状态
- 错误路径 + 异常状态

**最佳实践**（共识）：
- 每个关键用户旅程单独绘制一张流程图
- 包含异常分支（空态、错误态、加载态）
- 在低保真线框前完成，避免遗漏场景

**来源**:
- Slickplan User Flow vs Sitemap: https://slickplan.com/blog/user-flow-vs-sitemap
- UXFolio UX Design Process: https://blog.uxfol.io/ux-design-process

---

### 5. 低保真线框 (Low-Fidelity Wireframe)

**定义**: 灰度占位符级别的布局蓝图，聚焦结构、内容层次、功能位置，不含视觉细节。

**设计原则**（共识）：
- 灰阶调色板 + 基础图形（不加颜色、字体、图片）
- 快速迭代为首要目标
- 用标注（Annotations）说明交互意图

**工具**（共识）：Balsamiq、Miro、Figma（低保真模式）、纸笔草图

**向利益相关方呈现的技巧**（共识）：
- 解释目标是结构和功能，而非视觉设计
- 逐屏演示用户交互路径和元素位置原因
- 将设计决策与用户需求/业务目标挂钩

**命名约定**（新兴最佳实践）：
- 格式：`[Screen] / [State]`，例如 `Checkout / Empty Cart` 或 `Dashboard / Loaded`
- 这一约定在后续高保真和交接阶段大幅提升效率

**来源**:
- IxDF Wireframe: https://ixdf.org/literature/topics/wireframe
- Tijocreative UX Workflow: https://tijocreative.com/articles/wireframe-to-prototype-my-complete-ux-workflow-in-figma
- The Virtual Forge: https://www.thevirtualforge.com/company/blog/wireframing-and-prototyping-laying-the-foundation-for-great-ui-ux-design

---

### 6. 高保真原型 (High-Fidelity Prototype)

**定义**: 接近最终产品视觉和交互的交互式模型，可用于可用性测试和利益相关方评审。

**Figma 原型构建技巧**（共识）：
- 使用 Smart Animate 做屏间过渡
- 组件变体 + 交互触发器（hover、click、input）覆盖所有状态
- 目标：测试参与者无需引导即可自行导航

**必须设计的所有状态**（共识）：
- Default / Hover / Active / Focus / Disabled / Loading / Error
- Empty State（空态）/ Success State
- 各尺寸响应式断点

**来源**:
- Tijocreative UX Workflow: https://tijocreative.com/articles/wireframe-to-prototype-my-complete-ux-workflow-in-figma
- Bubble UX Design: https://bubble.io/blog/ux-design

---

### 7. 交互规格 (Interaction Spec)

**定义**: 精确描述交互行为的文档，包含动效参数、触发条件、状态转换、无障碍要求。

**核心内容**（共识）：
- 每个组件的所有状态（default/hover/active/focus/disabled/loading/error）
- 动效 Token：`transition: background-color 150ms ease-out`（不能只写"顺滑过渡"）
- 响应式规则：哪些属性在哪些断点下变化
- 无障碍：ARIA roles、键盘导航顺序、焦点样式、Screen reader label
- 边缘案例：最大内容长度、图片缺失、错误态、empty state

**Figma 交互规格建立方法**（新兴）：
- 在组件 Default 和 Interaction State 帧之间添加 Figma 箭头连接器
- 连接器标注：触发条件 + 动效 Token 名称
- 复杂动画：录制 Loom 视频说明（90 秒视频 > 三段文字描述）
- 使用 Motion Token 命名：`--motion-standard: 300ms cubic-bezier(0.4, 0, 0.2, 1)`

**交接 Checklist**（共识）：
- [ ] 所有交互状态已设计（hover/focus/active/disabled/loading/error）
- [ ] 所有动态内容区域有空态设计
- [ ] 边缘案例已文档化（最大内容、缺失图片、错误态）
- [ ] 所有断点的响应式行为已规格化
- [ ] 暗色模式变体（如适用）
- [ ] 减少动画模式（Reduced Motion）已注明

**来源**:
- Lenka Studio Interaction Spec: https://lenkastudio.com/blog/how-to-build-interaction-design-spec-figma
- Gökhan Meriç Design Handoff 2026: https://www.gokhanmeric.com/blog/design-to-code-handoff-2026-workflow-that-actually-works/
- Figr Developer Handoff Playbook: https://figr.design/blog/developer-handoff-playbook-tools-templates-and-best-practices-for-cross-functional-teams

---

### 8. 设计 Token / 设计系统 (Design Tokens / Design System)

**定义**: 将颜色、字体、间距、圆角、阴影等视觉属性抽象为命名变量，实现设计与代码的单一真相来源。

**三层 Token 架构**（新兴共识）：
1. **Primitive**（原始值）：`blue-500: #1A2B6D`
2. **Semantic**（语义别名）：`color/interactive/primary`
3. **Component**（组件级别）：`button/background/default`

**命名规范**（共识）：
- 语义化而非表现性：`error-background` 而非 `red-background`
- 层级结构：使用点标记 `color.primary.background`
- 避免歧义：`spacing-xs` 而非 `spacing-small`

**Figma 与代码同步**（新兴）：
- Figma Variables → REST API 导出 → CSS Custom Properties
- 或使用 Tokens Studio 插件导出 JSON → Style Dictionary 转换为多平台格式
- Token 名称必须在 Figma 和代码中完全一致，否则漂移不可避免

**来源**:
- Lenkastudio Design Handoff Workflow: https://lenkastudio.com/blog/how-to-build-design-handoff-workflow-developers-love
- Tony Ward Figma Variables to CSS: https://www.tonyward.dev/articles/figma-variables-to-css-variables
- Medium Token Naming Conventions: https://medium.com/@wicar/streamlining-your-design-system-a-guide-to-tokens-and-naming-conventions-3e4553aa8821

---

## 二、交互澄清方法

### 1. 原型走查 (Prototype Walkthrough)

**方法**: 设计师引导利益相关方逐屏浏览可交互原型，实时说明交互意图。

**最佳实践**（共识）：
- 端到端演示完整流程，用口头叙述说明用户意图
- 主动展示边缘案例（长文本、空态、错误态）
- 确认 Token 使用：开发者知道使用哪些 token
- 建立反馈循环：Slack 频道 / Linear 工单 / Notion 评论

**来源**:
- Lenkastudio Design Handoff: https://lenkastudio.com/blog/how-to-build-design-handoff-workflow-developers-love
- IxDF Wireframe Presentation: https://ixdf.org/literature/topics/wireframe

---

### 2. 可用性测试 (Usability Testing)

**核心方法**（共识）：

| 方法 | 适用场景 |
|------|----------|
| 调节式测试（Moderated） | 需要实时提问追问 |
| 非调节式测试（Unmoderated） | 大样本、跨地域 |
| 原型测试（Prototype Testing） | 开发前验证设计假设 |
| 卡片分类 | 验证 IA |
| 树形测试 | 评估现有 IA |

**12 步流程**（共识）：
问题定义 → 设定目标 → 选择方法 → 招募参与者 → 制定测试计划 → 准备环境 → 预测试(Pilot) → 主持测试 → 分析发现 → 报告 → 跟进 → 规划下轮

**来源**:
- UserTesting Usability Methods: https://www.usertesting.com/resources/guides/usability-testing/methods
- UX Tigers 12-Step Guide: https://www.uxtigers.com/post/user-testing
- NN/G Card Sorting: https://www.nngroup.com/articles/card-sorting-definition

---

### 3. 设计评审 (Design Review)

**最佳实践**（共识）：
- 在设计工作开始前邀请产品、工程、QA、客服参与早期评审
- 每个功能使用标准化结构：Overview → User Flow → Screens → Component Specs → States → Responsive Behavior → Data Requirements → Accessibility → Implementation Notes → Acceptance Criteria
- 复杂动画提供原型（Figma prototype / Lottie / 代码原型），而非文字描述

**来源**:
- Figr Developer Handoff: https://figr.design/blog/developer-handoff-playbook-tools-templates-and-best-practices-for-cross-functional-teams
- MillerMedia7 End-to-End UX: https://millermedia7.com/blog/end-to-end-ux-process

---

### 4. Figma 标注与交接 (Figma Annotation / Handoff)

**标注维度**（共识）：
- 交互行为（点击、悬停、键盘导航）
- 动效参数（时长、缓动函数）
- 边缘案例（空态、错误态、loading）
- 响应式断点行为
- 无障碍：ARIA roles、焦点顺序、Reading Order

**组织结构**（共识）：
- 按功能/流程组织，而非按屏幕
- 每个屏幕的交接帧：最终设计 + 标注侧栏布局
- 所有组件属性引用命名 Token（不用任意值）
- 将"Ready for Dev"状态显式标记

**关键原则**（共识）：
- 交接不是一个时间点事件，而是一个持续过程
- 设计师应在实现阶段保持参与，实时回答问题

**来源**:
- Figma Designer's Handbook for Developer Handoff: https://www.figma.com/blog/the-designers-handbook-for-developer-handoff/
- Tijocreative UX Workflow: https://tijocreative.com/articles/wireframe-to-prototype-my-complete-ux-workflow-in-figma
- Gökhan Meriç 2026 Handoff: https://www.gokhanmeric.com/blog/design-to-code-handoff-2026-workflow-that-actually-works/

---

## 三、AI 时代 UI 澄清的新范式

### 1. 主流 AI UI 生成工具概览

| 工具 | 定位 | 特点 |
|------|------|------|
| **v0.dev (Vercel)** | shadcn/ui 生成 | Tailwind + Radix UI，适合设计系统规模化；支持 Figma 导入与截图克隆 |
| **Lovable** | 美学优先 | 注重 Framer Motion 动效、高质感配色，支持附加图片/Figma 文件 |
| **Bolt.new** | 全栈编排 | 2026 年支持 Multi-Agent Workflow（UI agent + DB agent），适合 MVP 全栈 |
| **Claude Artifacts** | 快速原型 | 即时 HTML/React 预览，支持 AI-powered artifacts |

**共识**：prompt 质量决定输出质量，模糊 prompt → 通用输出，精准 prompt → 接近目标结果。

**来源**:
- Nextfuture v0 vs Bolt vs Lovable 2026: https://nextfuture.io.vn/blog/v0-dev-vs-bolt-new-vs-lovable-comparison-2026
- DEV Community Comparison: https://dev.to/boringcoder53/comparing-lovabledev-boltnew-and-v0dev-which-ai-ui-tool-delivers-the-best-results-54d8
- Xinran Ma Substack: https://designwithai.substack.com/p/i-ran-the-same-prompt-through-three-ai-prototyping-tools

---

### 2. 截图驱动 (Screenshot-to-Code)

**工作原理**（新兴共识）：
- 将参考截图 / UI 草图 / 风格图作为多模态输入提供给 AI
- AI 读取结构（布局层次、组件类型、空间关系）并生成代码
- 关键：模型默认会"复制"截图的灰阶美学（如线框 → 生成灰色原型外观），需要在 prompt 中显式指示"读取结构，扔掉美学，应用合适的视觉风格"

**最佳实践**（新兴）：
- 附加截图说明哪部分是参考（不要直接嵌入图片 URL 到代码）
- 明确区分"复制外观"和"借鉴结构"
- Text-augmented prompting（在截图基础上追加文字内容和结构描述）优于 pure image prompting

**研究来源**（学术）：
- Sketch2Code (NAACL 2025)：截图 + 问题澄清的多轮交互显著优于单次生成：https://arxiv.org/html/2410.16232
- RapidNative Vision Prompt：读取截图时"跳过美学，读取结构，重新应用风格"是关键系统提示设计：https://www.rapidnative.com/blogs/inside-the-vision-prompt-how-rapidnative-reads-a-screenshot-to-generate-react-na

---

### 3. 在 Prompt 中澄清视觉与交互意图

**品牌规格文档 (Brand Spec) 作为 Prompt Prefix**（新兴最佳实践）：

```
# 颜色 Tokens
--color-brand-primary: #1A2B6D
--color-brand-accent: #E84545

# 字体
Headings: Syne 600/700 (Google Fonts)
Body: DM Sans 400/500

# 圆角
--radius-sm: 2px
--radius-md: 4px
--radius-full: 0px  /* 禁止 pill 形状 */

# 间距
Base unit: 8px

# 风格偏好
Flat design, no decorative shadows
```

**参考式 Prompt 优于描述式 Prompt**（新兴共识）：
- 不要："Build a settings page with a clean, professional design"
- 要这样："Build a settings page in the visual style of Linear — dense information hierarchy, monochrome palette, sans-serif typography, no decorative shadows. Use the design tokens above."
- 或："This is enterprise software for finance teams. Think Bloomberg terminal density, not consumer SaaS spaciousness."

**需要在 Prompt 中显式说明的维度**：

| 维度 | 需要指定的内容 | 不指定的后果 |
|------|--------------|------------|
| 风格密度 | compact / default / comfortable | 默认 comfortable（留白偏大） |
| 颜色 | 具体 hex 值 / token 名 | 使用 AI 默认配色（通常是 indigo/blue/gray） |
| 圆角 | px 数值 | 默认 pill 或 lg radius |
| 阴影 | flat / token 值 | 添加装饰性阴影 |
| 字体 | 字体名 + weight | 默认 Inter / sans-serif |
| 状态覆盖 | 列出需要哪些状态 | 只生成 default state |
| 空态 | 显式要求设计空态 | 不生成空态 |
| 错误态 | 显式要求设计错误态 | 不生成错误处理 |
| 响应式 | 列出断点需求 | 仅桌面端 |

**来源**:
- MindStudio Claude Design: https://www.mindstudio.ai/blog/claude-design-avoid-generic-ai-aesthetics
- AI UX Playground Prompts: https://aiuxplayground.substack.com/p/top-10-ai-prompts-every-visual-designer
- Jakob Nielsen Prompt Augmentation: https://www.uxtigers.com/post/prompt-augmentation

---

### 4. 迭代式 AI UI 澄清（Prompt Augmentation Patterns）

**Jakob Nielsen（UX Tigers）的六种 Prompt 增强模式**（新兴共识）：
1. **Style Galleries**：展示风格选项让用户选择（而非用文字描述）
2. **Prompt Rewrite**：AI 将用户模糊 prompt 改写为更精确版本
3. **Targeted Prompt Rewrite**：针对特定维度重写
4. **Related Prompts**：提供相关变体供用户选择方向
5. **Prompt Builders**：结构化引导用户填写参数
6. **Parametrization**：将设计参数化（如密度/颜色/风格），通过滑块或选项控制

**迭代工作流最佳实践**（共识）：
- 将 AI 当作初级开发者进行结对编程
- 分步 prompt（Header → Sidebar → Content → Logic），不要一次描述 50 个功能
- 显式指定依赖库（"只用 Lucide icons 和 Recharts"），避免 AI 安装多个冗余库

**来源**:
- UX Tigers Prompt Augmentation: https://www.uxtigers.com/post/prompt-augmentation
- Nextfuture Common Mistakes: https://nextfuture.io.vn/blog/v0-dev-vs-bolt-new-vs-lovable-comparison-2026

---

## 四、方案比较

### 传统方式 vs AI 时代方式

| 澄清维度 | 传统方式 | AI 时代方式 |
|----------|---------|------------|
| 视觉风格 | 情绪板 + 视觉审查 | 截图参考图 + brand spec prompt prefix |
| 结构布局 | 低保真线框图 | 截图/草图 → screenshot-to-code + 迭代 |
| 交互规格 | Figma 标注 + 交互连接线 | prompt 中列出状态（hover/error/empty） |
| 设计 Token | Figma Variables + Token Studio | prompt 中内嵌 CSS Token 字符串 |
| 交接 | Figma Dev Mode + Loom 视频 | 代码直接输出 + token 在代码中引用 |
| 澄清循环 | 原型走查 + 可用性测试 | 多轮对话 + 视觉 feedback loop |

---

## 五、风险与注意事项

### AI 生成 UI 的常见陷阱（新兴共识）

1. **Prompt Bloat**：过长 prompt 导致"幻觉"代码，应分步迭代
2. **无障碍盲区**：AI 对复杂键盘导航和焦点管理仍不可靠，须人工用 Screen Reader 审计
3. **依赖地狱**：不显式指定库，AI 会安装多个重叠库
4. **状态遗漏**：不显式要求，AI 只生成 default state，忽略 empty/error/loading
5. **美学平庸**：不提供 brand spec，AI 输出落入 Inter + indigo 默认组合
6. **品牌失忆**：AI 不跨会话保留品牌上下文，每次需重新注入 spec

**来源**:
- Nextfuture 2026 Comparison: https://nextfuture.io.vn/blog/v0-dev-vs-bolt-new-vs-lovable-comparison-2026
- MindStudio Claude Design: https://www.mindstudio.ai/blog/claude-design-avoid-generic-ai-aesthetics

---

## 六、共识 vs 有争议 vs 新兴 分类

| 结论 | 分类 | 说明 |
|------|------|------|
| 设计简报是项目对齐基础 | 共识 | IxDF/Asana/Canva 均有一致的组件描述 |
| 情绪板用于视觉方向对齐 | 共识 | NN/G 有系统研究支撑 |
| 卡片分类用于 IA | 共识 | NN/G、CareerFoundry 均推荐 |
| 线框→原型→交接是标准流程 | 共识 | 各主流 UX 资源均支持 |
| Token 三层架构（primitive/semantic/component） | 共识（走向共识） | Figma 官方 + Lenka Studio + 多家设计系统均采用 |
| 截图作为 AI prompt 参考 | 新兴 | 实践广泛但学术研究仍在涌现 |
| Brand Spec Document 作为 AI Prompt Prefix | 新兴 | MindStudio 等实践者推广，尚无标准化 |
| Prompt Augmentation 六模式 | 新兴 | Jakob Nielsen 2025 年提出，影响力上升 |
| AI 处理可用性测试所有场景 | 有争议 | AI 在无障碍、复杂导航方面仍有明显局限 |
| 交接是"事件"而非"过程" | 有争议（传统观点被颠覆） | 共识已转向"持续过程"，但许多团队仍用"扔过墙"方式 |

---

## 七、参考来源完整列表

1. IxDF Design Briefs (2026) — 支撑设计简报章节: https://ixdf.org/literature/topics/design-briefs
2. IxDF Wireframes (2026) — 支撑线框章节: https://ixdf.org/literature/topics/wireframe
3. NN/G Mood Boards — 支撑情绪板章节: https://www.nngroup.com/articles/mood-boards
4. NN/G Card Sorting (2024) — 支撑 IA 章节: https://www.nngroup.com/articles/card-sorting-definition
5. Toptal Guide to Mood Boards — 支撑情绪板来源多样性: https://www.toptal.com/designers/brand/guide-to-mood-boards
6. Asana Design Brief — 支撑设计简报: https://asana.com/resources/design-brief
7. Intellectsoft Design Brief — 支撑设计简报: https://www.intellectsoft.net/blog/understanding-design-briefs
8. Slickplan User Flow vs Sitemap — 支撑 IA/用户流程: https://slickplan.com/blog/user-flow-vs-sitemap
9. CareerFoundry IA Guide — 支撑 IA: https://careerfoundry.com/en/blog/ux-design/a-beginners-guide-to-information-architecture
10. Tijocreative UX Workflow in Figma — 支撑线框/原型/命名约定: https://tijocreative.com/articles/wireframe-to-prototype-my-complete-ux-workflow-in-figma
11. Figma Designer's Handbook for Developer Handoff — 支撑交接: https://www.figma.com/blog/the-designers-handbook-for-developer-handoff/
12. Lenka Studio Interaction Design Spec — 支撑交互规格: https://lenkastudio.com/blog/how-to-build-interaction-design-spec-figma
13. Lenka Studio Design Handoff Workflow — 支撑 Token/交接: https://lenkastudio.com/blog/how-to-build-design-handoff-workflow-developers-love
14. Figr Developer Handoff Playbook — 支撑设计评审/交接: https://figr.design/blog/developer-handoff-playbook-tools-templates-and-best-practices-for-cross-functional-teams
15. Gökhan Meriç Design-to-Code Handoff 2026 — 支撑交互规格/checklist: https://www.gokhanmeric.com/blog/design-to-code-handoff-2026-workflow-that-actually-works/
16. Tony Ward Figma Variables to CSS — 支撑 Token 同步: https://www.tonyward.dev/articles/figma-variables-to-css-variables
17. MindStudio Claude Design Prompt — 支撑 AI Prompt Prefix: https://www.mindstudio.ai/blog/claude-design-avoid-generic-ai-aesthetics
18. UX Tigers Prompt Augmentation (Jakob Nielsen 2025) — 支撑 AI 澄清模式: https://www.uxtigers.com/post/prompt-augmentation
19. Nextfuture v0/Bolt/Lovable 2026 — 支撑 AI 工具对比: https://nextfuture.io.vn/blog/v0-dev-vs-bolt-new-vs-lovable-comparison-2026
20. Sketch2Code NAACL 2025 — 支撑截图驱动多轮对话: https://arxiv.org/html/2410.16232
21. RapidNative Vision Prompt — 支撑截图转代码机制: https://www.rapidnative.com/blogs/inside-the-vision-prompt-how-rapidnative-reads-a-screenshot-to-generate-react-na
22. AI UX Playground Prompts — 支撑 AI prompt 模式: https://aiuxplayground.substack.com/p/top-10-ai-prompts-every-visual-designer
23. UX Tigers Usability 12-Step — 支撑可用性测试: https://www.uxtigers.com/post/user-testing
24. DEV Community AI Tool Comparison — 支撑 v0/Lovable/Bolt: https://dev.to/boringcoder53/comparing-lovabledev-boltnew-and-v0dev-which-ai-ui-tool-delivers-the-best-results-54d8
25. UserTesting Usability Methods — 支撑可用性测试方法: https://www.usertesting.com/resources/guides/usability-testing/methods
26. Bubble UX Design Best Practices — 支撑原型: https://bubble.io/blog/ux-design
27. Medium Token Naming Conventions — 支撑 Token 命名: https://medium.com/@wicar/streamlisting-your-design-system-a-guide-to-tokens-and-naming-conventions-3e4553aa8821
