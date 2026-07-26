# 执行面收件箱协议

本文定义工作台云端与拉取型执行器之间的跨端契约。目标是把“布置任务”和“执行器取任务”解耦，同时保持现有云端常驻 Codex 链路不退化。

## 1. 执行面目录与项目归属

`src/projects.mjs` 导出固定目录 `EXECUTORS`：

| id | displayName | kind | transport | 派发方式 |
|---|---|---|---|---|
| `cloud-codex` | 云端常驻 Codex | `resident` | — | 继续投递 `WORKBENCH_EVENT_WEBHOOK` |
| `local-mac` | 创始人 Mac | `pull` | — | 写入执行面收件箱，由本地监听器拉取 |
| `github-actions` | GitHub Actions 评审面 | `external-review` | `pr` | 仅接收评审请求并回传评审信号，不执行代码任务 |

项目注册表 `workspace/projects.json` 的每个项目条目新增 `executor`：

```json
{
  "id": "example-project",
  "displayName": "示例项目",
  "executor": "local-mac",
  "reviewPlane": { "executor": "github-actions" }
}
```

- 缺省值固定为 `cloud-codex`，兼容已有注册表。
- `executor` 必须命中 `EXECUTORS`，未知值会使注册表校验失败。
- `reviewPlane` 可选；存在时必须声明 `{ "executor": "<external-review executor>" }`。它独立于代码执行的 `executor`，只标记该项目使用的评审面。
- `/api/projects` 公开 `reviewPlane.executor`，但和 `repoPath`、`memoryPath` 一样不会公开任何服务器路径。
- 会话无项目归属、项目未声明 `executor`，或派发时无法安全解析归属时，一律回退 `cloud-codex`。

## 2. 文件数据

每个任务独占一个 JSON 文件：

```text
workspace/inbox/<executor>/<task-id>.json
```

`inbox` 是 workspace 的系统保留目录，不允许再作为 session 名称，也不会出现在会话枚举中。

任务 ID 是服务端生成的 UUID。文件通过“同目录临时文件 + `rename`”原子替换，临时文件权限为 `0600`。

任务结构：

```json
{
  "id": "346153d5-6529-41bd-b1ea-5d25a6e9769d",
  "executor": "local-mac",
  "session": "example-session",
  "type": "message-posted",
  "title": "会话新消息",
  "payload": {
    "event": "message-posted",
    "session": "example-session"
  },
  "status": "pending",
  "createdAt": "2026-07-24T12:00:00.000Z",
  "claimedAt": null,
  "claimedBy": null,
  "leaseExpiresAt": null,
  "completedAt": null,
  "result": null,
  "history": []
}
```

状态只允许：

```text
pending -> claimed -> done
                   \-> failed
claimed --超时--> pending
```

`claim` 是有时限的租约，不是执行器对任务的永久所有权。超时回退会清空 `claimedAt`、`claimedBy`、`leaseExpiresAt`，并向 `history` 追加：

```json
{
  "event": "claim-expired",
  "at": "2026-07-24T12:31:00.000Z",
  "claimedAt": "2026-07-24T12:00:00.000Z",
  "claimedBy": "founder-mac"
}
```

## 3. 通用 HTTP 约定

- 所有 `/api/inbox/*` 端点都要求已配置的管理员口令，通过 `X-Workbench-Token` 或既有 API query token 传递。
- 未配置管理员口令、口令无效、或使用参与者口令，统一返回 `403`。
- 成功响应包含 `ok: true`；业务校验失败返回 `400`，资源不存在返回 `404`，状态冲突返回 `409`。
- `payload` 限额按 `JSON.stringify(payload)` 的 UTF-8 字节数计算，最大 `65536` 字节。

## 4. API

### 4.1 入队

```http
POST /api/inbox/tasks
Content-Type: application/json
X-Workbench-Token: <admin-token>

{
  "executor": "local-mac",
  "session": "example-session",
  "type": "message-posted",
  "title": "会话新消息",
  "payload": {}
}
```

校验：

- `executor` 必须已注册。
- `session` 使用工作台既有 session 白名单。
- `type`、`title` 必须是非空字符串。
- 必须显式提供 `payload`，且序列化后不超过 64 KiB。
- `external-review` 执行面只接受 `type: "review-request"`，且 `payload` 必须包含非空字符串 `repo`、`branch` 和正整数 `pr`。

成功返回 `201`：

```json
{ "ok": true, "task": { "...": "完整任务对象" } }
```

### 4.2 列表

```http
GET /api/inbox/tasks?executor=local-mac&status=pending
X-Workbench-Token: <admin-token>
```

- `executor` 必填且必须已注册。
- `status` 可选；提供时必须为 `pending|claimed|done|failed`。
- 返回按 `createdAt`、`id` 升序排列。
- 列表前会执行一次超时领取回退。

```json
{ "ok": true, "tasks": [] }
```

### 4.3 领取

```http
POST /api/inbox/tasks/<task-id>/claim
Content-Type: application/json
X-Workbench-Token: <admin-token>

{ "claimedBy": "founder-mac" }
```

- `claimedBy` 必须是非空字符串。
- 只有 `pending` 可以领取。
- `claimed`、`done`、`failed` 均返回 `409`。
- `external-review` 任务永远不可领取；pull 型监听器必须只拉取 `kind: "pull"` 的执行面，尝试领取外部评审任务返回 `409`。
- server 必须先把 canonical 任务文件原子 rename 为本次领取的唯一临时名，rename 成功后才允许读取和解析任务内容。rename 失败的竞争者返回 `409`，不得读取、完成或写失败结果。
- 成功后写入 `status: "claimed"`、`claimedAt`、`claimedBy`、`leaseExpiresAt`，返回完整任务。

### 4.4 续租

```http
POST /api/inbox/tasks/<task-id>/renew
Content-Type: application/json
X-Workbench-Token: <admin-token>

{ "claimedBy": "founder-mac" }
```

- 只有 `claimed` 且 `claimedBy` 与当前租约持有标识一致时可以续租。
- 成功后保持原 `claimedAt`，把 `leaseExpiresAt` 延长为“本次续租时间 + 配置时限”。
- 任务已回退、已完成或标识不匹配返回 `409`。
- 长任务的消费者应在租约过半前续租；停止续租后，任务会自然回退供其他消费者再次领取。

### 4.5 完成

```http
POST /api/inbox/tasks/<task-id>/complete
Content-Type: application/json
X-Workbench-Token: <admin-token>

{ "ok": true, "summary": "已完成实现并通过测试" }
```

- 首次完成只有 `claimed` 可以转换；`pending` 返回 `409`，已有 `done|failed` 按下述幂等规则返回。
- `ok` 必须是布尔值，`summary` 必须是非空字符串。
- `ok: true` 写入 `status: "done"`；`ok: false` 写入 `status: "failed"`。
- `completedAt` 写完成时间，`result` 固定保存 `{ok, summary}`。
- 成功任务向对应 session 追加 AI `receipt`：`任务执行完成：<summary>`。
- 失败任务向对应 session 追加 AI `message`：`任务执行失败：<summary>`。
- `complete` 幂等：任务已经是 `done` 或 `failed` 时返回 `200` 和当前任务状态，并标记 `idempotent: true`；不得覆盖首次 `result`，也不得重复写会话流回执。
- 此公开完成接口不能完成 `external-review` 任务；该类任务只能由服务端评审回传接收器代为完成，详见 §8。

## 5. 领取超时

- 环境变量 `WORKBENCH_INBOX_CLAIM_TIMEOUT_MS` 配置领取时限，必须为正整数毫秒。
- 缺省值为 `1800000`（30 分钟）；非法配置回退缺省值。
- server 启动后周期扫描；默认扫描间隔不超过 60 秒，并在较短超时配置下相应缩短。
- 列表、领取、续租和完成前也会做一次惰性扫描，避免边界时刻误判。
- 这是 **at-least-once** 协议：租约超时、worker 崩溃或网络重试都可能让同一任务被执行多次。消费者必须以稳定 `task.id` 自证业务副作用幂等；队列不承诺 exactly-once。

## 6. 事件派发分流

原有三个事件派发点保持不变：

- `message-posted`
- `round-presented`
- `feedback-submitted`

路由规则：

1. 根据 `payload.session` 查 session 元数据与项目注册表。
2. `resident`：保持原事件体，异步投递 `WORKBENCH_EVENT_WEBHOOK`。
3. `pull`：不投递 webhook；把原事件体作为任务 `payload` 入队，`type` 等于事件名，并向 session 流追加 AI `progress`：`已入队待本地执行：<任务标题>`。
4. `external-review` 不消费这三类普通会话事件；评审面只通过显式的 `review-request` 入队。
5. 无归属、缺省 executor 或路由解析异常：继续走 webhook，保证云端链路兼容。

事件动作的主业务写入已经成功后才执行派发；派发失败只记服务端错误日志，不回滚已经完成的消息、轮次或反馈写入。

## 7. 文件系统边界与架构优势

执行面只允许通过本协议的 HTTP API 入队、列表、领取、续租和完成，**永远不得直接挂载或读写 server 的 `workspace/inbox/`**。任务文件只由控制面 server 在自己的本地文件系统操作。

这条边界让未来 macOS、Windows 或其他 worker 的文件系统语义与队列正确性彻底解耦，也规避了 NFS/SMB 网络盘以及 Windows 默认 rename 覆盖不原子的已知坑。相关依据包括 [claytonia 的真实 claim race 修复](https://github.com/lentago/claytonia/pull/62)、[AWS SQS visibility timeout/续租语义](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) 和 [Windows rename 原子性差异](https://stackoverflow.com/questions/167414/is-an-atomic-file-rename-with-overwrite-possible-on-windows)。

如果未来有人提出“让 worker 直接访问共享任务目录”，必须视为架构变更重新评审，不能作为监听器实现捷径。

## 8. external-review 评审面

`github-actions` 的 `kind` 为 `external-review`、`transport` 为 `pr`。它是评审面的注册表入口，**只产生信号，不产生代码事实**：评审任务表示开 PR 或触发 workflow，GitHub 回传的评审结论只供后续 judge 作为软信号使用；合并、发布和代码写入仍由权威服务器的执行面负责。

外部评审任务的状态机是受限特例：可由服务端创建为 `pending`，但没有 `claimed` 租约，也不能被本地/远程 pull 监听器领取或续租。服务器收到并验证 GitHub review / CI 回传后，才会代为将该任务从 `pending` 标记为 `done` 或 `failed`。公开的 `/api/inbox/tasks/:id/complete` 对该类任务一律返回冲突，避免评审执行面直接写入完成状态。

回传结果固定为信号字段：`{ ok, summary, verdict, ciStatus }`。其中 `summary` 是审查意见摘要，`verdict` 是评审结论，`ciStatus` 是 CI 状态；结果对象不接受、也不保存 patch、文件内容、代码变更或合并信息。服务端评审回传接收器是唯一可调用内部完成路径的组件。
