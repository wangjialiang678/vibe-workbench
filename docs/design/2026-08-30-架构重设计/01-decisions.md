# 架构重设计 · 已定决策（2026-08-30，创始人拍板）

> 本文冻结创始人已确认的决策，作为设计方案与 Codex 评估的对齐基准。
> 评审报告见 reviews/（opus / codex / fable 预判）；简报见 00-briefing.md。

## 拍板记录

| # | 议题 | 决定 | 出处 |
|---|---|---|---|
| D1 | 分层粒度 | **中间态**：新增 storage/ 存储层 + 打断 server↔routes 循环依赖；只给 present/提交这类有不变量、跨入口（CLI+HTTP）共享的操作建薄用例层，简单读接口直接调 storage。**不做完整六边形/全量依赖注入。** | AskUserQuestion 2026-08-30 |
| D2 | 执行面（executor-inbox / local-listener / resident-worker / control-tower，约 7000 行） | **保留，不删。默认关闭 + 补真正的端到端测试。** 顾问/客户即将在线改动反馈，云端 AI 是必需品；现在先不启用。 | 创始人 2026-08-30 |
| D3 | 云端 AI 自动续跑（模式②，`claude -p --resume`） | **核心必需能力，近期启用。** 此前"§3.7 有封号先例"的说法有误、已全部作废——订阅额度驱动的无人值守自动化被允许。 | 创始人 2026-08-30 |
| D4 | owner-token RCE（inbox 任务被 `--dangerously-skip-permissions` 执行） | **不额外处理**（创始人明示"没关系"）。inbox 仍 owner-only。默认关闭进一步降低暴露面。 | 创始人 2026-08-30 |
| D5 | 跨客户会话名泄漏（/api/sessions、/api/projects） | **已修已上线**（owner-only 过滤，非 owner 返回空清单）。commit 4cc3199。 | 已完成 |
| D6 | _lab 客户数据经 HTTP 可达 | **已删已上线**（本地+两台服务器 404/403）。commit 009d162。 | 已完成 |
| D7 | 部署自动化（不可变发布包 + 三机比对） | **划掉**（创始人指出属越界的过度设计）。仅保留 /api/health 返回版本号这一项（可调试，非部署自动化）。 | 创始人 2026-08-30 |
| D8 | 存储介质 | **文件系统即事实源，不上 DB。** 三方评审一致。 | 三方一致 |
| D9 | 零依赖 + 无构建前端 | **保留，并写成硬约束**（加测试禁止 package.json dependencies）。 | 三方一致 |
| D10 | 迁移方式 | **绞杀式，不绿地重写。** 门户在跑不能停；且无任何模块需要从头写。先建对拍安全网再动刀。 | 三方一致 |

## 由 D2 引出的设计重点：执行面怎么测

执行面过去最大的问题不是"没用"，而是**从没被端到端验证过**（0 任务 = 0 真实验证）。
既然要留、要用，"这部分怎么测"从边角料升为设计的重头。测试方案见 03-test-plan.md 的
"执行面测试"专章：核心是把 driver（`claude -p` / `codex exec`）抽象成可注入的假实现，
让整条 present→inbox→claim→execute→writeback→next-round 链路能在无真实 AI、无网络下跑通。

## 过度设计红线（评估与实现都按此把关）

评审报告里以下建议**明确不采纳**（避免过度设计）：
- Codex 的完整六边形（domain/application/ports/composition-root + 全量 DI）
- 给每个端点都套用例层（简单读直接调 storage）
- protocol 的多版本迁移机制（只加 version 字段做保险）
- journal 的事件回放/事件溯源引擎（只 append 那几个状态变更）
- 不可变发布包 + manifest + 三机 SHA 比对（见 D7）

---

## 追加决策（2026-08-30，评估之后）

| # | 议题 | 决定 |
|---|---|---|
| D11 | 云端 AI 凭据模式 | **订阅 / API Key 可切换。** 配置项 `WB_CLOUD_AI_AUTH=subscription\|apikey`（默认 subscription）。subscription 模式沿用现 `claude -p`（登录态）；apikey 模式给 spawn 的进程注入 `ANTHROPIC_API_KEY`（来源走 api-vault，不硬编码）。理由：无人值守给顾问/客户跑时 API Key 更稳（不受个人额度波动、不混上下文），自己调试时订阅更省。落在 driver 适配器层，天然可测。 |
| D12 | 澄清：云端 AI ≠ inbox 任务队列 | 评估核实：**"云端 AI 自动续跑"是反馈驱动**（`loop/listener.mjs` 本机 + `scripts/resident-worker.mjs` 云端，后者已在东京机运行、轮询 `/api/feedback`）。**inbox 任务队列（executor-inbox + routes/inbox，约 1500 行，pending/claimed/done）是另一套、从未使用、消费者仅控制塔。** 02 §4 原把两者混写为一条链，属错误，需改。 |
| D13 | inbox 任务队列去留 | **建议砍**（与 D2 不冲突：D2 要保留的是反馈驱动的云端 AI，不是 inbox 队列）。inbox 与云端 AI 无关、零使用；控制塔依赖它则一并降级。**待创始人最终确认；未否决即按砍执行。** |

## 由 D11/D12 引出的设计与测试影响

- **02 架构**：§3 执行面改写——明确"反馈驱动自动续跑"为保留主体（listener + resident-worker 两实现），
  inbox 队列按 D13 处理；driver 适配器新增凭据模式维度（subscription/apikey）。
- **03 测试**：执行面假 driver 链路的入口从"present→inbox→claim"更正为
  "feedback 落盘 → listener 扫到(有feedback 无ack 无response) → driver → response → 下一轮"；
  新增 driver 凭据模式契约测试：subscription 模式 argv 含 `-p --resume <id>` 且不带 API key；
  apikey 模式 spawn 环境含 `ANTHROPIC_API_KEY` 且不依赖登录态。两种模式都用假 driver 验证选择逻辑，不需真实凭据。
