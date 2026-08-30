# 实现契约（2026-08-30）——补齐 Codex 评估的 3 项放行条件

> Codex 方案评估（reviews/codex-eval-方案评估.md）放行条件：① fs 边界例外表；
> ② 两条状态机唯一数据流 + 开关矩阵 + "下一轮"所有者；③ 隔离夹具对拍 + adapter 续接契约。
> ②已在 02 §3/§4 定义。本文补 ① 与 ③，并给出 storage 原子写契约。

## 一、fs 边界例外表（守卫 fs-boundary.test.mjs 的可执行契约）

**穷尽**：以下是当前所有含 `node:fs` 生产调用的 12 个文件（grep 核实，2026-08-30）。
守卫规则 = 只有"归属 storage"与"显式例外"两类允许出现 `fs.`，其余一律失败。
**这张表是权威；02 §1 的"仅 storage/CLI"表述以此为准修正为"storage + 本表显式例外"。**

| 现文件 | fs 调用 | 迁移归属 |
|---|---|---|
| `src/workspace.mjs` | mkdir/read/write/readdir/rm/stat/access | **并入 storage/**（round/status/paths 主体） |
| `src/executor-inbox.mjs` | 18 处含 temp+rename | **并入 storage/**（inbox 队列；其原子写作 storage 范本） |
| `src/stream.mjs` | append/mkdir/read/stat | **并入 storage/**（journal/stream + 附件 receipt） |
| `src/participants.mjs` | write/read/rename/rm/mkdir | **并入 storage/**（config 名册装载器） |
| `src/projects.mjs` | write/read/rename/rm/exists/mkdir | **并入 storage/**（会话索引 + executor 字段） |
| `src/documents.mjs` | write/read/readdir/mkdir | **并入 storage/**（documents 目录读写） |
| `src/control-tower.mjs` | read/readdir/stat/lstat/statfs | **并入 storage/**（只读聚合器；statfs 磁盘用量作只读探针留在 storage） |
| `src/loop/session-store.mjs`(经 loop) | — | 会话 id 持久化 **并入 storage/** |
| `src/server/server.mjs` | 21 处（上传 open/close/fstat、realpath 等） | 上传落盘 **并入 storage/**（writeAttachment）；其余静态相关移入下条 |
| `src/server/routes/pages.mjs` | createReadStream/read/readdir/stat | **例外：`adapters/server/static.mjs`**（HTTP 静态托管；只读、限 SRC 下、禁 .mjs 源码可取） |
| `src/loop/agent-exec.mjs` | accessSync/statSync（探测 CLI 可执行文件是否存在） | **例外：driver 适配器**——探测二进制是可执行文件解析，非业务数据 I/O；单列白名单，仅允许 access/stat 只读探测 |
| `bin/workbench.mjs` | 读入 content.json 参数（具名 import） | **例外：CLI 入口**（仅读参数；写盘转调 storage） |
| `scripts/import-prd-project.mjs` | 具名 import：readFile/mkdir/writeFile/copyFile；读外部 PRD、写 workspace 轮次、拷贝资产 | **例外：CLI 导入工具**——workspace 轮次写入**转调 storage.createRound**（不裸 writeFileSync）；仅"读外部 PRD 文件 + 拷贝资产到 assets"作为工具自有 I/O 留在白名单 |
| `scripts/local-listener.mjs`、`scripts/resident-worker.mjs` | 状态文件/租约 I/O | **例外：独立进程状态**——其 worker 本地状态（lastFeedbackKey 等）不属工作台事实源；单列白名单，或改调 storage 的 worker-state API（二选一，见 §6） |

无第三类。任何新增文件要碰 fs → 要么进 storage，要么进本表新增一条例外并说明理由，否则守卫红。

**守卫扫描范围（关键）**：`fs-boundary.test.mjs` 必须同时匹配两种用法——
`fs.<call>`（命名空间）**和** `import { … } from 'node:fs'` / `from 'fs'`（具名 import）。
本表的穷尽性正是靠具名 import 才补全（import-prd/bin 都用具名，`fs.` grep 会漏）。
扫描范围 = `src/**`、`scripts/**`、`bin/**` 的 `.mjs`（测试夹具目录除外），逐文件比对白名单。

## 二、storage 原子写契约（回应评估"writeFileSync 非原子、中断测试会测假"）

storage 所有写入遵守统一原子协议（以 inbox 现有实现为范本，executor-inbox.mjs:112-127）：

- 单文件写：同目录临时文件 `.<name>.<pid>.<rand>.tmp`（0600）→ `fs.rename` 原子替换。
- 轮次目录：`fs.mkdir`（不带 recursive 的占位）竞争，`EEXIST` = 已存在 → 抛 `ROUND_EXISTS`（永不覆盖）。
- feedback 三步顺序固定：历史件（唯一命名，见下）→ 主件（rename）→ status。
- **历史件唯一命名**：不用进程内自增 seq（多进程/重启会碰撞，routes/feedback.mjs:128 现状）；
  改为 `<ISO 时间>-<单调计数或 8 位随机>-<身份 slug>.json`，并断言并发下文件名唯一、每笔可回读。
- 故障注入点：在"临时文件已写未 rename""主件已 rename、status 未写"两处注入中断重启，
  断言恢复后文件可读、无半个 content、状态可由 storage 重建。

## 三、对拍隔离夹具契约（回应评估"共用只读夹具跑 POST 会互相写脏"）

`scripts/ab-compare.mjs` 修正为：

1. **每个 server 各持一份夹具副本**：把只读种子夹具 `cp -r` 成两份独立可写目录，
   基线 server 指向副本 A、工作副本 server 指向副本 B。
2. **基线 = 冻结 SHA**：基线 server 从 `git worktree` 检出 **`29efa23`**（tag pre-rearch-2026-08-30 的实际 commit），
   不用当前工作树（回应评估"基线未冻结"）。
3. **请求分两类**：
   - GET/只读：直接逐条 diff。
   - POST/写：成对执行同一请求，diff **响应 + 该请求在两副本产生的文件树变化**（状态迁移对拍），
     每条后重置该副本或按序设计不互污染的清单。
4. **归一化白名单**：只归一化 `ts`、`assetsVersion`；其余 header、status、body、**连接终止方式**必须一致。
5. **2s 硬超时计入差异**；**反向自检**：故意调换路由顺序 / 改一个 block 渲染 → 必须报差异，否则 harness 无效。

## 四、driver 适配器续接契约（回应评估"只测 driver 被调用，不足以证明 D3"）

除"假 driver 打通全链路"外，另加 driver 适配器**契约单测**（不需真实凭据/网络）：

| 断言 | 依据现码 |
|---|---|
| subscription 模式：spawn argv 含 `-p` 与 `--resume <session-id>`，不含 API key | agent-exec.mjs:17-20 |
| apikey 模式：spawn 环境含 `ANTHROPIC_API_KEY`，argv 不依赖登录态 | 新增（D11） |
| session id 持久化与续接 | loop/session-store.mjs:20-39、listener.mjs:76-99 |
| driver 非零退出 / 超时 → 落 error.json 且状态 error，可重试 | listener.mjs 错误分类 |
| claim 幂等：并发认领同一轮只一个成功 | **注意**：机 A 现用 `exists→writeJSON`（listener.mjs:50-64）**非原子**，
  须改为 storage 的 rename 竞争（对齐机 B inbox 的正确实现），否则多 worker 会双领 |

**D11 凭据边界（回应评估 v2 点 4）：**
- **可注入的 vault 解析器**：apikey 来源经一个可注入接口从 api-vault 取（测试注入假 resolver）；
  缺失/无效凭据 → 明确失败（不静默降级），落 error 且 body 不含密钥。
- **env 最小化**：subscription 模式必须从 spawn 子进程 env **移除继承的 `ANTHROPIC_API_KEY`**
  （只查 argv 不够）；apikey 模式只注入该 key，不带无关 env。
- **不泄漏**：密钥绝不进 journal / status / error.json / HTTP 响应 / 日志；加断言测试。
- **per-driver 适用性**：`workbench-continue`(claude) 适用 subscription|apikey；
  `code-exec`(codex) 用 **Codex 自有鉴权，不受 WB_CLOUD_AI_AUTH 影响**，须显式标注，
  不能让 Anthropic key 模式隐式作用到 Codex worker。
- **apikey 完整 argv**：由 driver 适配器显式定义（含 `--resume` 语义、session id 命名空间与
  subscription 是否同一），并断言 agent 切换不复用异 agent 的 session id（session-store.mjs:20-24）。

## 五、present 用例副作用契约（回应评估陷阱 #2：CLI/HTTP present 副作用不一致）

`core.presentRound(session, content, ctx)` 统一两条入口，副作用显式列全：

- 必做：`storage.createRound`（原子、永不覆盖）、`lintContent`、返回 `{round, url}`。
- HTTP 额外副作用（现 routes/session.mjs:83-121 有、CLI 没有）：写 project metadata、stream receipt、`dispatchExecutorEvent`。
  → 这些收进 `core.presentRound` 的**可选 hooks**，由 adapter 传入（CLI 传空、HTTP 传全），
  保证"同一 present 语义、副作用差异显式声明"，不再一路悄悄多做/少做。


## 六、机 A 统一契约：一个触发 + 原子认领 + 可插拔 driver（回应评估 v2 点 2）

评估核实：`loop/listener.mjs` 与 `scripts/resident-worker.mjs` **不是一套状态机的两个实现**——
listener 用 `claude -p` 产出工作台下一轮（写 ack/response）；resident-worker 用 `codex exec`
在目标项目仓库做真实代码改动（产出 commit，不产出工作台下一轮）。二者只共享"反馈触发"。

**统一模型**：机 A = 一个触发 + 一套认领机制 + 可插拔 driver。

- 触发（共享）：storage 出现 `feedback 且无 ack 无 response` 的轮。
- 认领（共享，storage 提供）：**原子 rename 竞争**（不是现 listener 的 `exists→writeJSON`，那非原子），
  写 `ack.json`（owner=认领的 worker id）+ 租约到期时间；崩溃/超时 → 租约释放可重认领。
- driver 接口：`driver.process({session, round, feedback, memory}) → result`。两个实现：
  | driver | 行为 | 写回 | 适用凭据 |
  |---|---|---|---|
  | `workbench-continue`（listener） | `claude -p --resume` 生成下一轮 content | `response.md` + AI 侧经 `core.presentRound` 落下一轮 | subscription 或 apikey（Anthropic，D11） |
  | `code-exec`（resident-worker） | `codex exec` 在目标 repo 改代码 | 目标 repo commit + 工作台 `response.md` 记录摘要 receipt | Codex 自有鉴权（**非 Anthropic key**，见 §四） |
- "下一轮"所有者：**始终是 AI 侧经 `core.presentRound`**，worker 不直接写 content.json。
- 假 driver 测试同时覆盖两个实现的选择与写回；resident-worker 的 `codex exec` 也经此接口，
  故第 4 期 e2e 能同时证明 listener 支路与东京 worker 支路，不再只证明其一。

## 七、开关矩阵（回应评估 v2 点 2"开关只是文字规则"）

`WB_CLOUD_AI=off|on`（默认 off）× `WB_CLOUD_AI_AUTH=subscription|apikey`（默认 subscription，仅作用于 Anthropic driver）。

| 入口 / 组件 | off（默认） | on |
|---|---|---|
| listener（本机自动驱动） | 不启动 | 启动，按触发认领 |
| resident-worker（东京机） | 不认领（空转或不部署自动驱动） | 认领并执行 code-exec driver |
| `POST /api/inbox/tasks`（机 B 入队） | 503「未启用」 | 正常入队 |
| `GET /api/inbox/*`（机 B 查询/认领） | 503 | 正常 |
| `dispatchExecutorEvent`（派发点） | 只落盘、不派发 | 按 project.executor 派发（resident→webhook / pull→inbox） |
| control-tower | 显示"未启用" | 显示状态 |
| driver 凭据 | 不适用 | Anthropic driver 读 AUTH；Codex driver 用自有鉴权 |

矩阵每格一条测试（off 断言禁用/503/不驱动；on 断言启用），构成第 4 期验收。

## 八、错误分类表（回应评估 v2 点 3"写盘错误误归类为 invalid JSON"）

现 `feedbackPost` 整段异步 catch 一律回 400 `invalid JSON`（routes/feedback.mjs:173-175），
掩盖磁盘错误且反馈可能已落盘一半。契约化映射（**02 §5 第2期"5xx 含真因"以此表替代**）：

| 失败类型 | HTTP | 客户端可见 | 服务端 |
|---|---|---|---|
| 请求体 JSON 解析失败 | 400 | "请求体不是合法 JSON" | 记录 |
| 业务校验失败（schema/字段） | 400/422 | 具体校验信息（不含内部路径） | 记录 |
| 鉴权/可见性 | 403 | 通用拒绝语 | 记录 identity |
| 资源不存在 | 404 | not found | — |
| 状态冲突（轮已存在/已提交） | 409 | 冲突说明 | 记录 |
| **storage/errno（写盘失败等）** | **500** | **通用"服务端存储错误，请重试"——不含绝对路径/密钥/errno 细节** | **记录 cause + errno + 真实路径** |

守卫测试：注入磁盘写失败 → 断言返回 500 且 body 不含绝对路径/密钥；解析失败仍 400；两者不混。
