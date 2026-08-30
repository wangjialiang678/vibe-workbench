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
