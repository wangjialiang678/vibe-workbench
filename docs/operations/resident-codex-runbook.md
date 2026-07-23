# 常驻 Codex 部署与运维上下文

> 更新时间：2026-07-23  
> 用途：让接手故障的人工或 Agent 在不依赖原会话记忆的情况下，理解当前架构、判断风险并安全恢复服务。  
> 安全边界：本文不保存任何口令、访问令牌、账号信息或私密邀请链接。

## 1. 结论先行

当前系统已经具备“进程退出后自动重启”，但还不具备真正的“任务级高可用”：

- `vibeloop-workbench.service` 和 `resident-worker.service` 都由 systemd 常驻，当前已启用自动重启。
- 每次接单都会新建一个独立的 `codex exec` 子进程；当前任务执行期间收到的新消息不会注入这个子进程，而会在当前任务结束后由下一次轮询启动新的子进程处理。
- Codex 的正式回答写回原工作台对话；即使执行者只把最终答复写到 stdout，worker 也会尝试把它兜底转发进对话。
- 当前 worker 在启动 Codex 前先推进本地消息游标。若 worker 在“推进游标”之后、“完成并回执”之前崩溃，该事件可能不会自动重试。这是任务可靠性的首要缺口。
- 当前不能直接多开 worker：不同实例会各自读取同一批事件，可能重复执行、重复改代码、重复回答。
- `workspace/` 和私密参与者配置被 Git 忽略。代码仓库镜像不能替代会话数据备份。

因此，目标不应是“多开几个独立 Agent API”，而应是：

> 工作台保存唯一、持久的任务状态；多个无状态 Runner 通过原子租约竞争任务；事件推送只负责唤醒，定时对账负责兜底；所有副作用用任务 ID 幂等。

## 2. 当前生产拓扑

```text
浏览器 / CLI
      │
      ▼
Vibe Workbench（127.0.0.1:8099，外部由 HTTPS 反代）
      │
      ├── workspace/<session>/stream.jsonl       对话记录
      ├── workspace/<session>/documents/         Markdown 文档
      ├── workspace/<session>/round-*/           轮次与反馈
      └── /api/messages、/api/stream-events 等
      │
      ▼
resident-worker.service（当前每 5 秒轮询、全局串行）
      │
      └── 每个任务 spawn 一个新的 codex exec（30 分钟超时）
              │
              ├── 读取两仓、记忆快照和任务简报
              ├── 必要时修改、测试、commit
              └── 经 /api/stream-events 回答原对话
```

当前关键组件：

| 组件 | 位置 / 标识 | 当前职责 |
|---|---|---|
| 工作台仓库 | `/home/ubuntu/apps/vibecoding-workbench` | 会话、文档、附件、反馈、渲染与 API |
| 主业务仓库 | `/home/ubuntu/apps/user-vibeloop` | Vibeloop 主业务代码 |
| 长期记忆 | `/home/ubuntu/agent-memory/` | 跨会话背景与用户决策快照 |
| worker 工作目录 | `/home/ubuntu/cloud-codex-now` | 常驻执行者约束、游标状态 |
| 工作台服务 | `vibeloop-workbench.service` | Node HTTP 服务，失败后约 3 秒重启 |
| Codex worker | `resident-worker.service` | 发现事件、生成任务简报、启动 Codex，失败后约 5 秒重启 |
| worker 实现 | `scripts/resident-worker.mjs` | 当前调度与回执逻辑 |
| worker 单元模板 | `scripts/resident-worker.service` | systemd 安装模板 |
| worker 约束模板 | `scripts/resident-AGENTS.md` | 云端执行者必须遵守的交付与安全规则 |

运行时基线：

- Node.js：生产当前为 v22.23.1；项目声明 Node.js `>=20`。
- 工作台：纯 ESM、运行时零第三方依赖，测试入口为 `npm test`。
- Codex CLI：生产当前为 0.145.0；使用 ChatGPT 登录态运行 `codex exec`。
- 机密只从受限环境文件和进程环境读取，不得写入仓库、文档、日志或对话。

版本会变化，排障时以第 6 节命令的实时输出为准。

## 3. 当前消息与进程语义

### 3.1 工作期间继续发消息会怎样

1. 新消息会立即持久化到该 session 的 `stream.jsonl`，页面不会丢消息。
2. 已运行的 `codex exec` 只拿到启动时生成的任务简报，不会自动收到后续消息。
3. worker 当前全局串行；正在运行的任务结束后，下一轮发现新消息，再启动一个新的 `codex exec`。
4. 新进程默认不是对上一个 Codex thread 的 `resume`，连续性来自工作台历史、仓库、文档和记忆，而不是同一个模型上下文。
5. 每个任务都带原 session，最终回答应回到同一个工作台对话。

产品层应明确显示“处理中 / 已排队”，避免用户把“已保存”误认为“已注入当前推理”。默认规则建议保持确定性：任务领取之后到达的消息进入下一个 turn；以后若要支持“追加到当前任务”，应作为显式能力单独设计。

### 3.2 当前失败语义

| 故障 | 当前行为 | 缺口 |
|---|---|---|
| 工作台进程退出 | systemd 自动重启 | 需要外部可用性告警 |
| worker 主进程退出 | systemd 自动重启 | 已提前推进游标的任务可能遗失 |
| Codex 子进程非零退出 | 写失败回执，worker 继续 | 不自动重试 |
| Codex 超过 30 分钟 | 终止进程组并写超时回执 | 不支持断点续作 |
| ChatGPT 登录失效 | `codex exec` 失败，但 worker 本身仍可能显示 active | 缺少 auth readiness 与专门告警 |
| 推送或网络瞬断 | 当前靠轮询后续发现 | 未来推送仍必须有持久队列兜底 |
| 多个现有 worker 同时运行 | 可能重复领取 | 无共享租约，禁止直接扩副本 |
| 主机或磁盘损坏 | systemd 无法处理 | `workspace/` 需要独立备份与恢复演练 |

## 4. 推荐目标架构

```text
消息/反馈成功提交
      │
      ├── 同一持久事务：追加源事件 + 创建 job(event_id)
      ▼
Durable Job Store（唯一事实源）
      │
      ├── push /wake（低延迟，可以丢）
      └── 60 秒 reconciliation（兜底）
      ▼
Runner A / Runner B / Runner C
      │
      ├── 原子 claim：pending → leased
      ├── lease TTL + heartbeat
      ├── 每 session 顺序锁；必要时再加 repo 写锁
      ├── 执行 codex exec
      └── 幂等写回答 + ack：leased → completed
```

### 4.1 必须满足的任务契约

- `job_id` 直接来自不可变事件 ID，或与事件 ID 一一映射。
- 原子领取：同一 job 同一时刻只能有一个有效 lease。
- lease 有过期时间；Runner 死亡后，其他实例可重新领取。
- 执行语义采用“至少一次”，通过 `job_id` 幂等保证用户可见结果近似“恰好一次”。
- 回答、commit、部署等副作用都记录 job ID；重试前先检查是否已完成。
- 同一 session 默认顺序处理，避免后发消息越过前一条。
- 同一仓库的写任务需要互斥或独立 worktree，避免多个 Runner 同时修改同一工作树。
- 超过重试上限进入 dead-letter，并在工作台显示可操作的失败状态。

存储可以是 SQLite、PostgreSQL 或具备同等原子条件更新能力的服务；具体选型属于后续架构决策。不要用每个 Runner 各自的 JSON 游标模拟共享队列。

### 4.2 独立 Agent API 的正确边界

独立 Agent API 适合作为“执行适配器”，不适合作为任务事实源。建议只暴露私网或 Unix socket 接口：

- `POST /wake`：通知 Runner 尽快去 claim，不直接携带完整可信任务。
- `GET /health/live`：进程是否活着。
- `GET /health/ready`：工作台可达、任务存储可达、仓库可写、Codex 登录预检通过。
- `GET /metrics`：队列深度、最老 pending 时长、lease 超时、成功率、失败率、执行耗时。

Codex CLI 已提供非交互 `codex exec`。官方也提供实验性的 `codex app-server`，但其文档明确说明主要面向本地开发/调试、可能变更；现阶段不应把生产可靠性押在该实验接口上。先把队列、租约和幂等做好，执行层以后可以在 `codex exec`、稳定版 app-server 或其他 Agent SDK 之间替换。

### 4.3 多实例与备用

- 第一阶段可以同机运行 2 个 Runner 验证 lease，但这不能抵御整机故障。
- 真正备用至少应跨主机或跨故障域，并共享同一个持久任务源。
- 备用实例可 active-active 抢租约，也可 active-passive；不应依赖人工判断哪个实例先启动。
- 外部 watchdog 必须位于工作台主机之外，否则主机掉电时它也会同时消失。
- 多套凭据不等于高可用。凭据应由 secret store 分发并可独立吊销，不能复制到运维文档。

## 5. 分级自愈与告警

### L0：进程监管（已具备）

- systemd 自动重启工作台和 worker。
- journal 保存结构化诊断线索。

### L1：确定性自愈（建议优先补）

- 健康检查连续失败后重启明确的 unit。
- lease 过期后自动重新入队。
- 部署后健康检查失败则回到“最后一个已验证版本”，并保留失败版本与日志。
- 定期备份 `workspace/`、私密参与者配置和必要的服务配置；备份必须加密并位于另一故障域。

### L2：诊断 Agent

诊断 Agent 可以根据本文自动执行只读检查、汇总日志、运行定向测试并提出修复或生成候选 commit。默认不应拥有以下无限制权限：

- 读取或输出全部机密；
- 任意删除数据；
- 无审查修改认证方式；
- 无健康门槛直接部署大范围代码变更。

适合自动执行的动作应采用 allowlist，例如重启指定 unit、清理已确认过期的 lease、运行固定测试、收集脱敏诊断。登录失效、凭据轮换、数据恢复和不可逆回滚仍需要明确授权。

### 必备告警

- `/health/ready` 连续失败；
- 最老 pending job 超过目标时限；
- dead-letter 非零；
- Codex auth readiness 失败；
- 磁盘空间或 inode 低水位；
- 最近一次备份过旧或恢复校验失败；
- 5xx、任务失败率、重复回执率异常。

## 6. 安全排障清单

以下命令不需要输出任何口令：

```bash
# 服务与重启计数
systemctl show vibeloop-workbench.service resident-worker.service \
  -p Id -p ActiveState -p SubState -p MainPID -p NRestarts -p Restart

# 最近日志
journalctl -u vibeloop-workbench.service --since "-30 min" --no-pager
journalctl -u resident-worker.service --since "-30 min" --no-pager

# 运行时与认证方式；不要读取或打印 auth.json
node --version
codex --version
codex login status

# 仓库与测试
git -C /home/ubuntu/apps/vibecoding-workbench status --short
git -C /home/ubuntu/apps/vibecoding-workbench log -5 --oneline
cd /home/ubuntu/apps/vibecoding-workbench
env -u WORKBENCH_REMOTE_URL -u WORKBENCH_URL -u WORKBENCH_TOKEN npm test
```

全量测试要清除当前执行者继承的远程工作台变量，否则本地 CLI 测试可能误连生产服务，得到与代码无关的鉴权或重复数据失败。

已确认是单纯进程故障时：

```bash
sudo systemctl restart vibeloop-workbench.service
sudo systemctl restart resident-worker.service
```

若 `codex login status` 失败，远程无图形环境优先由授权人员使用设备码重新登录：

```bash
codex login --device-auth
```

不要让修复 Agent 把认证缓存、环境文件或设备码内容写进日志、工单、文档或 Git。

## 7. 备份与恢复范围

代码仓库镜像只覆盖 Git 已跟踪内容。至少还要备份：

- `/home/ubuntu/apps/vibecoding-workbench/workspace/`：对话、附件、文档、轮次和反馈；
- 私密参与者配置：必须加密，恢复后保持权限；
- systemd unit 与非机密部署配置；
- 长期记忆快照；
- 必要时备份凭据，但只能进入专用 secret/credential backup，不能与普通文档归档混放。

最低要求：

- 增量备份有明确频率、保留期和异地副本；
- 每次备份记录完成时间与校验；
- 定期在隔离目录做恢复演练；
- 恢复顺序为：停写 → 恢复数据 → 校验权限与结构 → 启动工作台 → 启动 Runner → 对账 pending jobs。

## 8. 建议实施顺序

1. **P0：任务可靠性**——把“游标前移”改成持久 job + lease + ack；修复同轮重复提交对 worker 不可见的问题。
2. **P0：数据保护**——为 `workspace/` 建立加密异地备份并做一次恢复演练。
3. **P1：低延迟**——新事件成功提交后 push `/wake`，60 秒对账保留为兜底。
4. **P1：可观察性**——增加 live/ready、队列指标、auth readiness 和外部告警。
5. **P2：多 Runner**——先同机验证竞争与幂等，再部署跨主机备用。
6. **P2：受限诊断 Agent**——基于本文和 allowlist 自动诊断、重启、验证；代码修复走候选 commit 与健康门槛。

这套顺序先消除“消息已经收到了但任务永远消失”的风险，再追求零延迟和多实例。事件推送、独立 Agent API 与自动修复都可以保留，但必须建立在持久任务和幂等执行之上。

## 9. 相关源码与官方依据

- 当前 worker：`scripts/resident-worker.mjs`
- systemd 模板：`scripts/resident-worker.service`
- worker 约束：`scripts/resident-AGENTS.md`
- 对话数据：`src/stream.mjs`
- 工作台 API：`src/server/server.mjs`
- 当前测试：`tests/unit/resident-worker.test.mjs`
- Codex CLI 非交互命令：[Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-exec)
- Codex 登录、缓存与 headless 设备登录：[Codex authentication](https://learn.chatgpt.com/docs/auth)
