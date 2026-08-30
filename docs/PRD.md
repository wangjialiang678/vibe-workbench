# 通用人机交互层 / vibecoding 工作台 — PRD & 设计文档

> 状态：需求已通过工作台两轮确认（2026-06-30）。本文件为正式交付物（C），综合 RESEARCH→INNOVATE→PLAN 的全部结论。
> 配套：实施计划见 [.claude/memory-bank/plans/web-medium-mvp.md](../.claude/memory-bank/plans/web-medium-mvp.md)；交互式确认数据见 prd-review-studio `?p=vibecoding-workbench`。

---

## 1. 背景与动机

当前人机协作方式 =「Markdown 文件 + Claude Code VSCode 插件聊天框」，痛点：

- **呈现**：聊天框是线性纯文本，信息密度高、难扫读；很多内容（架构、流程、关系、原型）**纯文本就是错误载体**，该用图/流程图/思维导图/截图。
- **采集**：确认/选择只能打字，结构化决策笨重。
- **触发/载体**：本地、同步、绑定单一客户端，无法远程/移动办公。

用户已积累三个相关实例：① PRD 评审网页工作台 ② 设想的"思考可视化"网页 ③ 飞书文档协作（远程、移动、就地编辑/评论，改完用 CLI/agent 告知 AI）。三者指向同一个可抽象的范式。

## 2. 问题的本质

> **今天的 AI 协作把"交互界面"硬焊死在"对话流"上。本质解法 = 把交互界面从对话流解耦，使之成为一个一等公民的、可替换的、双向可写的共享工件。**

聊天把三件本应分开的事捆死了，拆开即得设计空间：

| 职责 | chat 现状 | 目标 |
|---|---|---|
| 呈现 AI→人 | 线性纯文本 | 富、可视、按内容类型选对表达形式 |
| 采集 人→AI | 打字自由文本 | 就地编辑/评论/选择/批注（结构化）|
| 传输/触发 | 本地、同步、单端 | 解耦、异步、远程、多端 |

## 3. 核心抽象：三段式「桥」

```
[ 人类 ] ⇄ [ 载体 Medium ] ⇄ [ 内容协议 ] ⇄ [ 桥/触发 ] ⇄ [ 接入 ] ⇄ [ Claude ]
           网页 │ 飞书文档      blocks+feedback    异步唤醒        CLI
           ╰── 可插拔 ──╯      ╰── 不变内核 ──╯    ╰─ 复用 ─╯    ╰你定╯
```

- **两端可插拔**：换载体（网页↔飞书）= 换薄适配器；换接入（CLI↔SDK）= 换驱动法。
- **中间是不变内核**：内容协议 + 桥（同步/触发/续接），也是现有工具唯一真正缺的那块。
- 网页与飞书文档不是两个方案，而是同一范式的两个实例。

## 4. 通用框架：Block 原语 + 模板（两大场景）

PRD 评审工作台**只是本框架的一个模板/特例**，不是基座。通用性来自 block 原语 + 自由组合：

```
通用 Block 原语 ──► 模板(组合) ──► 用例
markdown · diagram(mermaid)     ├─ dev-review   = 研发评审（PRD/架构/测试，=现工作台）
choice · verdict · freetext     └─ think-discuss = AI↔人思考共创（文档/brainstorm/讨论）
editable(就地编辑) · comment(评论层)
```

**两大目标场景**：
- **dev-review**：软件研发的需求/架构/测试确认（现 prd-studio 的能力，表达为本框架的一个模板）。
- **think-discuss**：AI 产出思考/文档/brainstorming，渲染成图文页，与用户讨论迭代（可编辑块 + choice/verdict + 评论层）。*——本项目这几轮的需求确认过程本身就是该场景的真实运行。*

## 5. 触发模型：异步唤醒（非同回合阻塞）

按"稳健 + 体验"标准选定（用户明确：别为复杂度妥协）：

| | 同回合阻塞 poll | **异步唤醒** ✅ |
|---|---|---|
| 占用会话 | 卡住回合、怕超时 | 不占回合，结束后被唤醒续跑 |
| 用户可花多久 | 越久越危险 | 想多久多久、可离开 |
| 稳健性 | 中低 | 高（解耦）|
| 移动/远程 | 不行 | 天然契合（= 飞书 daemon 同模型）|

时序：`我渲染 content → 结束回合 + 起后台监听 → 你提交(POST 落盘) → 监听检测到→唤醒我 → 读取续跑`。
（本项目确认阶段已用此模型实证：网页提交→Claude 自动接住续跑。）

- **IDE 内**：后台监听→唤醒。
- **离开/移动**：复用现成飞书 daemon。两者同一模型，phase 2 统一。

## 6. 容错与恢复（web-only 硬需求）

**洞察**：IDE/CLI 有终端当第二控制面可自救；web-only 没有，AI 侧崩了就是黑洞。故须让网页"成为"控制面 + AI 侧可自愈不丢状态：

1. **持久队列 + ack**：提交落盘为 pending 任务；AI 取走需回写 ack+结果；未接到/中途崩 → 仍是 pending，不丢。
2. **自愈监管 listener**：非一次性脚本，而是 Restart=always + watchdog + **启动即对账**（扫未 ack 提交补处理）。崩溃→重启→自动补上。复用 `feishu-claude-agents` 的 watchdog/每日重启模式。
3. **网页状态回显**：心跳 + 徽章（🟢在线 / 🟡处理中 / 🔵已回复 / 🔴AI离线·提交已存 / ⚠️报错）。把黑洞变成可见状态。
4. **网页内恢复动作**：「重试/重新唤醒」按钮；AI 报错亦在网页显示并可重试。用户从网页即可自救，无需回 IDE。

谱系判断：IDE 内 dogfood 用一次性 watcher 即可（终端兜底）；**web-only / 远程 / 移动 必须上 ①②③④**，恰好收敛到飞书 daemon 形态。

## 7. 复用策略（不重复造轮子）

调研结论（本地 7 仓库 + claude-mem 近两周对话，详见 §12）：

- **桥内核：复用你自己的 `feishu-claude-agents/control-plane`**（`claude-exec` 驱动 + `eval/run.mjs` 无飞书 headless 样板 + session resume + 文件态 MEMORY.md 续接）。这是与载体无关的现成内核。
- **渲染技术：复用 `prd-review-studio`** 的零依赖 server、mermaid、interact、feedback 回路 作积木；但**数据模型重做成通用 block + 模板**。
- **不依赖黑盒 `lark-channel-bridge`**：它把入向+驱动+回向焊死、长不出网页载体；网页载体自建薄接入层（入向 `onMessage` / 驱动 `buildClaudeArgv+--resume` / 回向 `reply`）。

## 8. 决策与功能需求（确认版）

**核心决策**
| ID | 决策 |
|---|---|
| D1 | 本质 = 把交互界面从对话流解耦为可插拔共享工件 |
| D2 | 复用 control-plane 内核 + prd-studio 渲染技术；数据模型重做 |
| D3 | 接入 = CLI（`claude -p`），吃订阅、灵活、主流；SDK/tmux/OpenClaw phase 2 可换 |
| D4 | 首个载体 = 网页优先 dogfood；飞书暂用现成黑盒，phase 2 统一 |
| D5 | 呈现 = Markdown 为单一信息源 + 按内容类型选可视化 |
| D6 | 通用框架优先，PRD 工作台只是一个模板（两场景：dev-review / think-discuss）|
| D7 | 触发 = 异步唤醒（非同回合阻塞 poll）|
| D8 | 容错恢复 = 让网页成为控制面 + AI 侧自愈不丢状态（web-only 硬需求）|

**D3 解耦阶段②补充决策（2026-07）**：驱动改为 hybrid。默认仍走 `claude -p --resume` 的机器默认凭据；首跑非零退出或超时、且存在 `ANTHROPIC_API_KEY` 时，显式传 key 重试一次，并用 `driverSource: "sdk-fallback"` 与固定中文文案明示。该字段描述的是工作台可观察的凭据尝试路径，不冒充 Claude CLI 的最终认证或计费审计结果。公网部署同时增加 `--host` 与 `WORKBENCH_TOKEN` 共享口令门；非 localhost 裸启动直接拒绝。

**功能需求**
| ID | 需求 |
|---|---|
| FR-1 | 通用内容协议：block 原语 + 模板（markdown/diagram/choice/verdict/freetext/editable/comment）|
| FR-2 | 通用渲染器（按 block 类型；复用 mermaid/interact）|
| FR-3 | 通用框架 + 模板系统（dev-review 与 think-discuss 皆为模板）|
| FR-4 | 异步唤醒触发回路（超时 + 手动续跑兜底）|
| FR-5 | 双轨落盘（content.md + content.json + feedback.json）|
| FR-6 | 容错与恢复（持久队列+ack / 自愈监管 listener / 网页状态徽章 / 网页内重试）|
| FR-7 | 注意力路由（优先级分区呈现）★源自 v2 评审 |
| FR-8 | 轮次差异高亮（diff）★源自 v2 评审 |

**FR-7 注意力路由（优先级分区呈现）**：每个 block 带元数据 `needsDecision`(是否需用户决策) × `hasRecommendation`(有无推荐) × `importance`(重要性)，渲染器据此排序分区：
- **区 A（顶部·最需关注）**：需决策 + **无推荐** 的项（按重要性排）——完全没有预设答案的，最先告诉用户。
- **区 B**：需决策 + 有推荐 的项（按重要性排）。
- **区 C（底部·FYI）**：无需决策、已设好默认 的项——同意即跳过。

**FR-8 轮次差异高亮（diff）**：多轮迭代时明确标出本轮相对上一轮的 **新增/修改**（NEW/CHANGED 徽章 + "只看变更"过滤），避免老内容淹没新内容、避免用户遗漏。

> 这两条把"呈现"从"渲染内容"升级为"**编排注意力**"，是 think-discuss / dev-review 两模板共用的能力。

## 9. 接入选型对比

| 驱动法 | 特点 | 选用 |
|---|---|---|
| Hybrid CLI：默认凭据 + 显式 API key 单次托底 | 保留 `--resume`；失败时可恢复；每次托底明示 | ✅ D3 阶段② |
| Agent SDK `query()` | 零冷启动、控制力强 | 尚未引入；当前托底仍由 CLI 执行 |
| tmux + node-pty | 常驻交互会话；读输出靠 idle 计时、较脆 | 否 |
| OpenClaw 插件 | 功能全但 3.8 万行框架过重 | 否 |

## 10. MVP 范围与里程碑

**MVP（先验证通用框架 + think-discuss + 异步唤醒 + 基础容错）：**
- 通用 block 协议 v0 + 渲染器（markdown / diagram / choice / verdict / freetext / comment）
- think-discuss 模板（本对话即用例）
- 异步唤醒回路（后台监听→唤醒 + 超时兜底）
- 基础容错：持久队列 + 状态徽章 + 网页重试
- 双轨落盘

**暂不做（YAGNI）**：dev-review 模板重建（prd-studio 已覆盖该用例）、飞书载体统一、editable 块、daemon 化、账号级多人权限。公网阶段仅提供共享口令，不把它表述为完整账号系统。

**里程碑**：M1 协议+渲染器 → M2 异步唤醒回路 → M3 基础容错 → M4 dogfood 本类对话。

## 11. 风险

- ~~**§3.7**：订阅做自动化违反 Anthropic 消费者条款（有封号先例）。~~ **该说法有误，已作废（2026-08-30 王佳梁订正）**：订阅额度驱动的无人值守自动化是被允许的用法。云端 AI 自动续跑（模式②）是要做的核心能力，供顾问/客户在线改动反馈时由云端 AI 处理。
- 异步唤醒的 listener 生命周期：用监管自愈兜底（见 §6）。
- 通用化过度抽象风险：先落 think-discuss 一个模板验证，不预造模板。

## 12. 调研索引（来源）

- 本地仓库代码级核对：`feishu-claude-agents`（生产桥，control-plane 内核）、`prd-review-studio`（渲染技术）、`openclaw-agent-tmuxsession`（tmux 路线）、`repos/{openclaw,openclaw-lark,clawdbot-feishu,agent-feishu-channel,feishu-codex-bridge,wechat-claude-code}`（接入谱系参考）、`claude-code-agent`（4 月设计前传）。
- claude-mem 近两周对话：飞书桥架构决策、`lark-channel-bridge` 选型、§3.7 取舍、watchdog/每日重启踩坑。
