# 完整测试方案（2026-08-30）

> 创始人特别要求测试方案要完整。本文是重设计的验收骨架：每一期靠这里的测试门槛放行。
> 核心教训（都真实发生过）：① 618 条全绿仍漏掉挂起 bug → 需对拍 + 超时；
> ② 曾有"源码正则"假测试（断言源码含某行字 ≠ 行为对）→ 需真行为断言 + 把静态守卫单独计数；
> ③ 执行面从没端到端验证过 → 需假 driver 打通全链路。

## 一、测试分层（四类，各司其职）

| 层 | 测什么 | 位置 | 特点 |
|---|---|---|---|
| **契约（golden）** | protocol 的稳定输出：computeDiff / routeBlocks / renderZones / validateContent | `tests/golden/` + `tests/fixtures/golden/*.json` | 10 份代表性 content（覆盖 choice/verdict/markdown/prototype/diagram = 81% 真实用量）→ 输出快照。这是唯一能替代"源码正则"的东西 |
| **行为单测** | core 用例 + storage 不变量 + 纯函数 | `tests/unit/` | 注入假 storage/clock/driver；测不变量而非实现 |
| **e2e（真 HTTP）** | 鉴权、状态机、可见性、路由语义 | `tests/e2e/` | 真 startServer + fetch |
| **对拍（重构专用）** | 新旧行为逐字节一致 | `scripts/ab-compare.mjs` | 每期放行门槛 |
| **结构守卫** | 分层无环 / fs 边界 / 零依赖 | `tests/guards/` | 静态分析；**单独计数**，不混进行为测试总数 |

> 报告测试数时分开报："行为测试 N / 静态守卫 M"，不再用一个混合数字制造虚假安全感。

## 二、对拍 harness（第 1 期，动刀前必须先有）

`scripts/ab-compare.mjs`：起两个 server（基线 commit / 工作副本）指向**同一份只读 workspace 夹具**，
按请求清单逐条打、逐行 diff（归一化 ts/assetsVersion）。要求：

- 清单 **≥60 条**：owner / participant / 无 token × 全部端点。
- **显式含 12 条近似路径**：`/api/participants-public`、`/api/participant`、`/api/inbox`、`/api/sessionx`、`/assets`、`/render/x`——上次挂起 bug 就藏在这类邻居里。
- **每条 2s 硬超时，超时计为差异**——挂起 bug 的特征是连接永不结束，只 diff body 抓不到。
- **反向自检（验收 harness 自己有效）**：故意调换 routes 顺序 → 必须报差异；故意改一个 block 渲染 → golden 必须报错。harness 自己不可信，就不能用它放行。

## 三、storage 层测试（第 2 期）

| 测试 | 断言 |
|---|---|
| fs 边界守卫 | `node:fs` 仅出现在 storage/ 与 cli 入口（grep AST import） |
| 轮次不覆盖（CLI 路径） | `cli present` 同一轮二次调用抛 `ROUND_EXISTS`——今天 bin 默认 allowOverwrite:true，是真 bug |
| 轮次不覆盖（HTTP 路径） | `POST /api/rounds` 同一轮二次调用 409/拒绝 |
| 并发 feedback | 20 个并发 POST 后：历史件恰好 20 份、主件为最后一笔、零丢失 |
| 崩溃原子性 | 在每个写点后注入进程中断再重启：文件可读、无半个 content（临时文件 rename 保证） |
| 写盘失败传真因 | 磁盘写失败返回 5xx 且 message 含真实原因——今天被统一翻译成 "invalid JSON"（反调试） |

## 四、执行面测试（第 4 期 · D2/D12/D13 引出的重头）

执行面过去 0 端到端验证。两套状态机分开测（02 §3），核心是 **driver 可注入**：

```
假 driver（不调真 AI、不联网）：接收 {session, round, feedback} → 返回预设的下一轮 content
```

### 机 A · 反馈驱动自动续跑（listener + resident-worker）
| 测试 | 断言 |
|---|---|
| 全链路（假 driver） | feedback 落盘 → listener 扫到「有 feedback 无 ack 无 response」→ 假 driver 执行 → 写 ack/response → AI 侧 present 下一轮落盘 → `workbench wait` 返回。全程无真实 AI、无网络 |
| claim 幂等 | 两 worker 并发认领同一轮只一个成功。**注意现码是非原子 exists→writeJSON（listener.mjs:50-64），须先改 storage rename 竞争再测**（04 §四） |
| reconcile 对账 | worker 崩溃重启，未完成轮被重新处理，不重复不丢 |
| driver 失败落盘 | 假 driver 抛错 → error.json + 状态 error，可重试 |
| 冷启动接管 | 只给夹具文件（无内存状态）能处理完一轮——验证文件即事实源 |
| 凭据模式（D11） | subscription：argv 含 `-p --resume <id>`、无 API key；apikey：spawn 环境含 `ANTHROPIC_API_KEY`。均用假 driver 验证**选择逻辑**，不需真凭据（04 §四） |

### 机 B · inbox 任务队列（默认关）
| 测试 | 断言 |
|---|---|
| 开关 off（默认） | `POST /api/inbox/tasks` 返回 503「未启用」；机 A 的 present→feedback 照常 |
| 开关 on + 入队路由 | resident 型 executor → 走 webhook（机 A）；pull 型 → 入 inbox 队列 |
| 租约状态机 | pending→claimed→done/failed；claimed 超时退回 pending；并发认领只一个成功（rename 竞争） |
| 原子写 | inbox 写盘遵守 temp+rename（作为 storage 原子写范本，04 §二） |

### 统一开关
| 测试 | 断言 |
|---|---|
| WB_CLOUD_AI=off | 机 A listener/worker 不自动驱动；机 B 路由 503；control-tower 显示未启用 |
| WB_CLOUD_AI=on | 两机按各自触发条件工作 |

## 五、安全回归（已修的固化 + 持续守卫）

| 测试 | 状态 |
|---|---|
| 参与者 /api/sessions 空、/api/projects 不含他人客户标题 | ✅ 已加（session-listing-visibility.test.mjs，622/622） |
| /render/_lab/* 返回 404 | 待补（第 1 期并入静态资源守卫） |
| **可见性枚举表**（防"下一个漏网"） | 第 1 期新增：对每个 GET 端点用 participant token 各请求一次并快照；新端点不进枚举表就红——把"权限有机生长"从结构上堵住 |
| 静态根暴露面 | 第 3 期：断言 pages.mjs 不把 .mjs 源码当可取静态资源（今天 /render/app.mjs 可 HTTP 取） |

## 六、每期放行门槛（Gate）

```
快速行为单测 → storage 故障/并发 → e2e（鉴权+状态机）→ golden 契约 → ab-compare 零差异 → 冒烟一次
```
任一不过不进下一期。冒烟 = 真人在浏览器走一遍：首轮渲染 / diff / 提交 / 刷新后草稿在 / 反馈失败重试。

## 七、基线与目标数字

- 当前基线：**622 行为测试 / 0 失败**（含刚补的安全测试）。
- 每期净增测试，且**每期 ab-compare 对保留行为零差异**。
- 结束态：行为测试数显著上升，静态守卫 3 条（分层/fs/零依赖），"源码正则"假测试清零或降到个位数并标注为静态守卫。
