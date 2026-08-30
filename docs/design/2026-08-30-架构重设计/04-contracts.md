# 实现契约（2026-08-30）——补齐 Codex 评估的 3 项放行条件

> Codex 方案评估（reviews/codex-eval-方案评估.md）放行条件：① fs 边界例外表；
> ② 两条状态机唯一数据流 + 开关矩阵 + "下一轮"所有者；③ 隔离夹具对拍 + adapter 续接契约。
> ②已在 02 §3/§4 定义。本文补 ① 与 ③，并给出 storage 原子写契约。

## 一、fs 边界例外表（守卫 fs-boundary.test.mjs 的可执行契约）

`node:fs` 允许出现的位置，白名单如下；其余任何文件出现 `fs.` 即测试失败。

| 位置 | 允许原因 | 迁移动作 |
|---|---|---|
| `storage/**` | 唯一业务数据出口（round/feedback/status/journal/inbox 队列/participants） | 现 workspace.mjs、executor-inbox.mjs 的原子写并入此处 |
| `adapters/server/static.mjs`（现 routes/pages.mjs 静态服务） | HTTP 静态托管必须读磁盘文件 | 单独隔离成一个模块，只读、限定在 SRC 下且**禁止 .mjs 源码可取**（见 03 §5） |
| `adapters/cli`（bin/workbench.mjs 入口） | CLI 需读入 content.json 参数文件 | 仅入口读参数；写盘一律转调 storage |
| `config/` 装载（participants 名册） | 启动期读配置 | 收进 storage 的 config 装载器 |
| 测试夹具 setup/teardown | 测试自身建/清临时目录 | 不计入生产边界 |

**明确归属**（回应评估"workspace/config/inbox I/O 分散于 6 个文件"）：
`projects.mjs`、`participants.mjs`、`stream.mjs`、`executor-inbox.mjs`、`control-tower.mjs`、
`loop/session-store.mjs` 现各自的 fs 调用**全部迁入 storage/**，对外只暴露业务动作。

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
2. **基线 = 冻结 tree-ish**：基线 server 从 `git worktree` 检出 `pre-rearch-2026-08-30` 或指定 SHA 起，
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

## 五、present 用例副作用契约（回应评估陷阱 #2：CLI/HTTP present 副作用不一致）

`core.presentRound(session, content, ctx)` 统一两条入口，副作用显式列全：

- 必做：`storage.createRound`（原子、永不覆盖）、`lintContent`、返回 `{round, url}`。
- HTTP 额外副作用（现 routes/session.mjs:83-121 有、CLI 没有）：写 project metadata、stream receipt、`dispatchExecutorEvent`。
  → 这些收进 `core.presentRound` 的**可选 hooks**，由 adapter 传入（CLI 传空、HTTP 传全），
  保证"同一 present 语义、副作用差异显式声明"，不再一路悄悄多做/少做。
