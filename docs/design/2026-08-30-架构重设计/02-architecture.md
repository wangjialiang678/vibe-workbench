# 目标架构（2026-08-30）

> 依据已定决策 D1-D10（01-decisions.md）。原则：解决真实缺陷，不搭多余框架。
> 唯一新建的层是 storage/；其余是"拆干净现有的"+"给执行面补测试与开关"。

## 一、分层与依赖方向（中间态 · D1）

```
        protocol/            纯逻辑：类型/校验/指纹/diff/注意力路由/lint。零 I/O 零 DOM。前后端共享。
           ▲                 （现状已健康，只加 version 字段；不动语义）
           │
        storage/             唯一 fs 出口。对外只暴露业务动作，不暴露裸 read/write。
           ▲                 不变量（轮次不覆盖、feedback 历史件先写、原子 rename）焊死在这里。
           │
        core/  (薄)          只放"有不变量 / 跨入口共享"的用例：presentRound、submitFeedback。
           ▲                 简单读（status/content/sessions）不进 core，adapter 直接调 storage。
           │
     ┌─────┴─────┬───────────┐
  adapters/    adapters/   adapters/
   server       cli         loop        三个入口共用 core + storage。
     │                                   server=http↔core；cli=bin/workbench.mjs；loop=listener。
  render/        只 import protocol，由 adapters/server 静态托管。
```

**依赖只能向下，靠三条结构测试强制（不靠自觉）——这是本次的关键机制：**
1. `tests/guards/layering.test.mjs`：解析每个源文件 import，断言无向上依赖、无环。**今天就会红**（routes ↔ server.mjs 成环），修复即验收。
2. `tests/guards/fs-boundary.test.mjs`：`node:fs` 只允许出现在 storage/ 与 cli 入口；把今天散在 13 文件的 105 处 fs 收敛成一个可数集合。
3. `tests/guards/no-deps.test.mjs`：断言 package.json 的 dependencies 为空（D9）。

## 二、模块落点（改造，不是新建目录树）

| 目标模块 | 来源 | 动作 |
|---|---|---|
| `protocol/`（保持） | 现 protocol/ | 加 `PROTOCOL_VERSION` 常量 + content 顶层 version 字段（只读保险，无迁移机） |
| `storage/index.mjs`（新） | 现 workspace.mjs 的 paths + read/write 原语 | 升为唯一 fs 出口，导出**业务动作**：`createRound / readRound / appendFeedback / readFeedback / writeStatus / readStatus / listSessions / appendJournal / listRounds`。裸 readJSON/writeJSON 降为内部私有。 |
| `core/present.mjs`（新，薄） | 现 bin cmdRender + routes/session 的 rounds handler | 合并 CLI 与 HTTP 两条 present 路径为一条，走 `storage.createRound`（永不覆盖，CLI/HTTP 同一不变量）。修掉今天"CLI 能覆盖、HTTP 不能"的 bug。 |
| `core/submit.mjs`（新，薄） | 现 routes/feedback handler | feedback 落盘三步（历史件→主件→status）+ 错误分类，从 HTTP handler 搬进用例。 |
| `adapters/server`（改造） | 现 server.mjs + routes/ | 打断循环：server.mjs 里的共享 helper（鉴权/http/limits）拆成独立小模块，routes 与 server 都 import 它们，不再反向 import server.mjs。`export {}` 从 94 个符号降到 ≤5。 |
| `adapters/cli` | 现 bin/workbench.mjs | present/wait 两条命令改调 core。 |
| `adapters/loop` | 现 loop/ | listener 改调 core.submit 的下游；driver 保持可注入。 |
| `render/`（保持） | 现 render/ 纯模块 | 只依赖 protocol；app.mjs 后续抽薄（可延后，非本期硬指标）。 |

## 三、执行面：两套独立状态机，都保留 + 默认关 + 可测（D2/D3/D11/D12/D13）

评估核实：这里其实是**两套互不相干的状态机**，此前本文误写为一条链。都保留、都默认关、都补测试。

### 机 A · 反馈驱动的自动续跑（= 你要的"云端 AI"，D2/D3）
- 触发：`storage` 出现 `feedback 且无 ack 无 response` 的轮。
- 两个实现共用同一状态机：`loop/listener.mjs`（本机 `claude -p`）与 `scripts/resident-worker.mjs`（东京机 `codex exec`，已在跑、轮询 `/api/feedback`）。
- 落盘：`ack.json`（认领）→ `response.md`（AI 产出）→ 触发 AI 端 present 下一轮。
- **"下一轮"的所有者 = AI 侧**（present 只能由 `core.presentRound` 产生，见 §四）；worker 不直接写 content。
- **凭据模式（D11）**：driver 适配器读 `WB_CLOUD_AI_AUTH=subscription|apikey`（默认 subscription）。
  subscription→沿用 `claude -p --resume <id>`（登录态）；apikey→给 spawn 进程注入 `ANTHROPIC_API_KEY`（取自 api-vault，不硬编码）。

### 机 B · inbox 任务队列（多执行器路由，D13 保留但默认关）
- 触发：反馈/消息事件经 `dispatchExecutorEvent` 查会话所属项目的 `executor`；`resident`→发 webhook（走机 A），`pull`/`external-review`→入队 `workspace/inbox/<executor>/`。
- 状态机：`pending→claimed→done|failed`，`claimed` 超时退回 `pending`（租约）。
- 消费者：拉取型执行器（local-mac / github-actions PR 评审面）——目前未激活，故默认关。
- **保留理由**：重建是加法、但会丢掉已正确的租约逻辑与全仓唯一做对的原子写；折进 storage 层反当原子写范本。

### 统一开关
`WB_CLOUD_AI=off|on`（默认 off）。off 时：机 A 的 listener/worker 不启动自动驱动；机 B 的 `/api/inbox/*` 返回 503「未启用」；control-tower 显示"未启用"。上线给顾问/客户时置 on。
两套都要求 driver 抽象为可注入，测试注入假 driver，全链路在无真实 AI、无网络下跑通。

## 四、一轮 present→feedback 数据流（目标态）

1. AI 执行 `workbench present <s> content.json` → cli adapter → `core.presentRound(s, content)`。
2. core：`protocol.validateContent` + `lintContent` → `storage.createRound()`（原子 mkdir 占位，**唯一**写 round 入口，永不覆盖；CLI 与 HTTP 同一条）→ 返回 `{round, url}`。
3. 浏览器 `GET /render/` → server adapter 托管 index.html（assetsVersion + importmap 缓存击穿保留）。
4. `GET /api/content` → server adapter 鉴权 → `storage.readRound(r)` + `readRound(r-1)` → `protocol.computeDiff` → 按 identity 过滤可见块 → JSON。
5. `render/app.mjs` → `protocol.routeBlocks` 分区 → `blocks.blockHtml` 出 HTML；草稿写 localStorage。
6. `POST /api/feedback` → server adapter 解析+鉴权 → `core.submitFeedback(s,r,identity,payload)` → `storage.appendFeedback`（历史件→主件→status 原子三步）+ `storage.appendJournal(receipt)`。
7. **[WB_CLOUD_AI=on · 机 A]** listener/worker 扫到 `feedback 且无 ack 无 response` → 注入的 driver（按 D11 凭据模式）执行 → `storage.writeAck/writeResponse` → AI 侧据此 `core.presentRound` 产生下一轮 → `workbench wait` 返回。
   **[机 B]** 若该会话项目的 executor 是 pull 型 → 事件入 inbox 队列，由对应拉取执行器认领执行（默认关时不发生）。
   **[WB_CLOUD_AI=off]** 两台都不自动驱动；present→feedback 落盘照常，等人工或开启后处理。

任何环节崩溃，直接读 `workspace/<s>/round-N/` 下的文件即可重建状态并接管（文件即事实源，D8）。

## 五、迁移分期（绞杀式 · 每期独立可验收可回退 · D10）

| 期 | 范围 | 验收标准（硬） |
|---|---|---|
| 0 | 安全止血 | 已完成：_lab 删除、sessions/projects owner-only。622/622。（保留：/api/health 加 version） |
| 1 | 安全网先行 | `scripts/ab-compare.mjs`（新旧双服务器同数据对拍，≥60 请求含近似路径，2s 硬超时）+ golden fixtures（10 份代表性 content → computeDiff/routeBlocks/renderZones 落 golden）。**反向自检**：故意改坏必须报错。 |
| 2 | storage 层收口 | fs-boundary 测试通过；present 双写路径消灭（CLI/HTTP 同一不变量，二次 present 必抛 ROUND_EXISTS，两路各测）；20 并发 feedback 零丢失；写盘失败 5xx 且含真因；ab-compare 零差异。 |
| 3 | 服务端真拆 | layering 测试通过（无环）；server.mjs export ≤5、无 route 反向 import；ab-compare 零差异 + 冒烟。 |
| 4 | 执行面开关+测试 | WB_CLOUD_AI 开关生效（off 时机A不自动驱动、机B路由 503）；**机 A** 假 driver 端到端跑通 feedback→listener→driver→response→下一轮 + 凭据模式契约；**机 B** 租约状态机 + 入队路由；claim 改原子 rename 竞争。详见 04-contracts §四。关闭态回归零差异。 |
| 5 | 收尾 | app.mjs 抽薄（软目标）；/api/health 加 version；docs/DESIGN.md 按目标态重写。 |

**app.mjs 抽薄列为软目标**：它是"改造非重写"，风险收益比低于前四期，放最后，做多少看前面落地后的余量。
