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
resident-worker.service（本机推送唤醒 + 每 60 秒兜底轮询、全局串行）
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
| 项目注册表 | `workspace/projects.json` | 显式登记项目仓库与记忆路径；公开目录不返回服务器路径 |
| 项目仓库 | 注册表中的 `repoPath` | worker 按会话归属选择执行目录，不再固定到单一主业务仓库 |
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

版本会变化，排障时以第 7 节命令的实时输出为准。

## 3. 当前消息与进程语义

### 3.1 工作期间继续发消息会怎样

1. 新消息会立即持久化到该 session 的 `stream.jsonl`，页面不会丢消息。
2. 已运行的 `codex exec` 只拿到启动时生成的任务简报，不会自动收到后续消息。
3. worker 当前全局串行；正在运行的任务结束后，下一轮发现新消息，再启动一个新的 `codex exec`。
4. 新进程默认不是对上一个 Codex thread 的 `resume`，连续性来自工作台历史、仓库、文档和记忆，而不是同一个模型上下文。
5. 每个任务都带原 session，最终回答应回到同一个工作台对话。

产品层应明确显示“处理中 / 已排队”，避免用户把“已保存”误认为“已注入当前推理”。默认规则建议保持确定性：任务领取之后到达的消息进入下一个 turn；以后若要支持“追加到当前任务”，应作为显式能力单独设计。

### 3.2 项目路由与旧会话兼容

1. 项目必须显式写入 `workspace/projects.json`；会话通过各目录下的 `session.json.projectId` 归属项目。
2. worker 只用管理员口令读取 `/api/session-context`。参与者可以读取项目目录，但拿不到 `repoPath`、`memoryPath`。
3. worker 在推进事件游标前读取执行上下文；此时收到 SIGTERM 就不领取事件，重启后仍会再次发现。
4. 注册仓库存在时，`codex exec -C` 使用该目录；路径缺失、畸形或服务端尚未升级时，回退 `/home/ubuntu/cloud-codex-now`，不根据 session 名猜路径。
5. 没有 `session.json`、没有 `projectId` 或引用已移除项目的旧会话都保留为“待归类”；原 URL、轮次、反馈、附件和文档继续可用。
6. 服务端首次写入一轮时自动创建/合并 `session.json`，标题取本轮标题，默认 `kind:"work"`、`status:"active"`。命中项目 ID、`primarySession`、`aliases` 或既有有效 `projectId` 时归入该项目。
7. 未命中项目的新会话仍正常创建，但 API 返回 warning，远程 CLI 同步打印；页面立即可在“待归类”区找到，不再产生无元数据的隐形会话。

首次上线前先备份 `workspace/`，再在工作台仓库执行：

```bash
node scripts/migrate-projects-v1.mjs
```

脚本先确认预期的 24 个会话目录全部存在，再写注册表和会话元数据；不移动、不删除目录，可重复执行。若预检查报缺失，先核对生产数据，不要手工创建空会话冒充历史数据。

### 3.3 当前失败语义

| 故障 | 当前行为 | 缺口 |
|---|---|---|
| 工作台进程退出 | systemd 自动重启 | 需要外部可用性告警 |
| worker 主进程退出 | systemd 自动重启 | 已提前推进游标的任务可能遗失 |
| Codex 子进程非零退出 | 若路由仓库有脏改动，封存到 `codex-timeout-<UTC时间戳>`，切回原分支并写失败/续跑回执 | 不自动重试 |
| Codex 超过 30 分钟 | 终止进程组；按同一规则封存半成品并写超时/续跑回执 | 快照分支仍需人工审阅后续跑 |
| Git 快照失败 | 回执写明 Git 错误，立即停止后续清理并保留现场 | 需要人工检查当前分支和工作区 |
| 路由目录非 Git 或命中工作台 `workspace/` | 不执行任何 Git 操作，回执说明跳过原因 | 需要核对项目注册路径 |
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

## 6. 日志、审计与保留策略

### 6.1 当前实际情况（2026-07-23）

当前有三类容易被统称为“日志”的数据，必须分开治理：

1. **业务事实**：`workspace/<session>/stream.jsonl`、轮次、反馈、文档和附件。它们是产品数据和恢复源，不是可随手轮转的运行日志。
2. **进程日志**：工作台与 worker 的 stdout/stderr 进入 systemd journal；本机又把 journal 转发给 rsyslog，因此一部分内容同时出现在 `/var/log/syslog`。
3. **代码与交付记录**：Git commit 保存代码变更，但不覆盖被 Git 忽略的 `workspace/`。

现场快照：

- 整台主机的 journal 当前占用约 2.3 GiB；这是全机数据，不全属于工作台。
- journald 没有显式配置 `SystemMaxUse` 或 `MaxRetentionSec`，当前主要依赖发行版默认的磁盘比例上限。
- rsyslog 的 `/var/log/syslog` 当前按周轮转、保留 4 份；与 journal 存在重复存储。
- worker 曾经每 5 秒打印一条空轮询结果：一次约 5 小时的观测产生了 3,334 条完全相同的空闲日志，而真正启动的任务只有 4 个。现在已改成本机推送加 60 秒兜底轮询；这类心跳仍应只做指标，不应恢复逐条日志。
- 仓库主分支已合入“本机事件推送 + 60 秒兜底轮询”，但当前已安装并正在运行的 systemd unit 仍设置 `POLL_MS=5000`，工作台 unit 也尚未配置事件 webhook。也就是说代码已具备新路径，生产配置还未完成切换；应在当前任务结束后做受控部署和健康验证。
- worker 的任务日志目前只有 session、事件数、退出码、signal 和超时标记；缺少稳定的 `job_id`、attempt、排队时长、执行耗时和结果引用，无法可靠串起一次任务。
- 工作台没有统一 HTTP 访问日志，也没有 request ID、路由模板、状态码和延迟记录；现有 `/api/health` 只是存活检查，不是依赖就绪检查。
- Codex stdout/stderr 只在 worker 内存里保留最后约 32 KiB。失败时，stderr 尾部最多 300 字会成为用户可见回执；这不适合作为诊断日志，也扩大了意外泄露内部信息的风险。
- 完整任务简报目前作为 `codex exec` 命令行参数传递。它虽然没有被 worker 主动写入 journal，但会暂时出现在进程参数中；后续应改为 stdin 或仅当前用户可读的临时文件。
- `workspace/` 当前约 2.3 MiB、目标 session 的 `stream.jsonl` 约 25 KiB，容量暂时很小，但没有生命周期、异地备份或恢复校验。当前也未发现工作台 workspace 的专门备份任务。
- 根分区当前使用率约 79%，inode 使用率约 20%。容量还未耗尽，但已经应该进入预警区。

### 6.2 推荐的数据分层与默认保留期

以下是当前规模下的起始默认值；若未来出现合同、隐私或合规要求，应以更严格的要求覆盖：

| 数据层 | 应保存的内容 | 默认保留 |
|---|---|---|
| 业务事实源 | 对话、反馈、文档、附件、最终回答、job 最终状态与结果引用 | workspace 生命周期内长期保存；删除后保留 30 天可恢复副本 |
| 安全与变更审计 | 管理员动作、权限拒绝、部署/回滚、配置版本、备份/恢复、登录就绪状态变化 | 365 天 |
| 任务执行摘要 | job 创建/领取/开始/完成/重试/dead-letter、attempt、队列等待、耗时、模型、退出分类 | 90 天 |
| HTTP 元数据 | 时间、路由模板、方法、状态码、延迟、请求/响应字节数、request ID、身份角色 | 30 天；安全拒绝类提升到 90 天 |
| 调试与失败诊断 | 脱敏后的 stack、失败子进程尾部、临时 debug 事件 | 7 天；debug 必须有自动关闭时间 |
| 指标 | 队列深度、最老任务、成功率、延迟、重启、磁盘、备份新鲜度 | 原始粒度 30 天；日聚合 13 个月 |

业务事实应通过版本化、加密、异地备份保护，而不是复制进日志系统。建议备份保留为每日 30 份、每周 12 份、每月 12 份，并至少每季度做一次隔离恢复演练。

### 6.3 统一结构化事件

应用日志应改成单行 JSON；每条至少有：

```json
{
  "ts": "ISO-8601",
  "severity": "info",
  "event": "job.completed",
  "service.name": "resident-worker",
  "service.version": "git-sha",
  "service.instance.id": "opaque-instance-id",
  "environment": "production",
  "request_id": "opaque-id",
  "job_id": "immutable-id",
  "event_id": "source-event-id",
  "session_ref": "pseudonymous-ref",
  "attempt": 1,
  "status": "success",
  "duration_ms": 1234
}
```

关键事件包括：

- `message.accepted`、`job.created`、`job.claimed`、`job.started`、`job.completed`、`job.retry_scheduled`、`job.dead_lettered`；
- `answer.persisted`、`commit.created`、`deploy.started`、`deploy.succeeded`、`deploy.rolled_back`；
- `auth.readiness_changed`、`backup.completed`、`backup.failed`、`restore.verified`；
- `service.started`、`service.stopping`、`service.crashed`。

heartbeat、空轮询和正常 readiness 探测只更新 metrics；仅在状态变化或持续异常时记日志。日志、指标和未来 trace 使用同一 request/job ID 关联，但日志本身不保存消息正文。

### 6.4 明确禁止进入运行日志的内容

- 访问令牌、Cookie、设备码、密码、密钥、认证缓存和环境文件内容；
- HTTP query 中的 token、完整请求/响应 body、完整任务简报、对话正文和附件正文；
- 模型隐式推理过程；最终回答已经存在对话事实源中，无需再复制；
- 未脱敏的 stderr、Git remote 凭据、内部连接串；
- 原始 IP、文件路径或个人身份信息，除非诊断确有必要且已有访问控制；通常应截断、哈希或用稳定的匿名引用替代。

用户可见回执只给稳定错误码、可理解原因和下一步；详细错误写入受限诊断日志，并通过 `job_id` 关联。所有外部输入在进入单行日志前都要清理换行和分隔符，防止日志注入。

### 6.5 落地顺序

1. **保持降噪并补限额**：不要恢复每 5 秒空轮询日志；明确 journal 为唯一主机日志源，避免工作台日志再复制到 syslog；给 journal 设置大小与时间双限额。以当前 59 GiB 根盘为起点，可评估 `SystemMaxUse=512M`、`SystemKeepFree=8G`、`MaxRetentionSec=30day`，实施前需确认不会影响同机其他服务。
2. **补结构化任务日志**：先随 durable job 引入 `job_id`、attempt 和状态机，再记录队列时长、执行时长、退出分类和结果引用。
3. **补 readiness 与 metrics**：区分 live/ready；监控 pending、dead-letter、auth、磁盘、备份和重复回执，不用日志模拟指标。
4. **集中告警而非先上重平台**：当前规模可继续用 journald + 轻量指标采集；达到多机 Runner 后，再接 OpenTelemetry Collector 和集中日志/指标后端。
5. **落实访问与删除制度**：生产日志只允许受限运维身份读取；导出、查询和删除日志本身也要有审计记录。

建议阈值：根盘使用率 75% warning、85% critical；最老 pending 超过 2 分钟 warning、10 分钟 critical；auth readiness 一次状态变化即告警；dead-letter 非零、备份超过 26 小时或恢复校验失败立即告警。

## 7. 安全排障清单

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

## 8. 备份与恢复范围

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

## 9. 建议实施顺序

1. **P0：任务可靠性**——把“游标前移”改成持久 job + lease + ack；修复同轮重复提交对 worker 不可见的问题。
2. **P0：数据保护**——为 `workspace/` 建立加密异地备份并做一次恢复演练。
3. **P1：低延迟**——代码已合入本机事件推送和 60 秒对账兜底；补齐生产 unit 配置、受控重启并验证“推送成功 + 轮询兜底”后才算完成。
4. **P1：可观察性**——增加 live/ready、队列指标、auth readiness 和外部告警。
5. **P2：多 Runner**——先同机验证竞争与幂等，再部署跨主机备用。
6. **P2：受限诊断 Agent**——基于本文和 allowlist 自动诊断、重启、验证；代码修复走候选 commit 与健康门槛。

这套顺序先消除“消息已经收到了但任务永远消失”的风险，再追求零延迟和多实例。事件推送、独立 Agent API 与自动修复都可以保留，但必须建立在持久任务和幂等执行之上。

## 10. 相关源码与官方依据

- 当前 worker：`scripts/resident-worker.mjs`
- systemd 模板：`scripts/resident-worker.service`
- worker 约束：`scripts/resident-AGENTS.md`
- 对话数据：`src/stream.mjs`
- 工作台 API：`src/server/server.mjs`
- 当前测试：`tests/unit/resident-worker.test.mjs`
- Codex CLI 非交互命令：[Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-exec)
- Codex 登录、缓存与 headless 设备登录：[Codex authentication](https://learn.chatgpt.com/docs/auth)
- journal 大小与时间保留配置：[systemd journald.conf](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html)
- 日志关联与服务实例字段：[OpenTelemetry Logs](https://opentelemetry.io/docs/specs/otel/logs/) · [Service attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/service/)
- 敏感数据排除、日志注入防护与访问控制：[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
