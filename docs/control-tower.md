# 控制塔（Control Tower）v1

控制塔是工作台的只读驾驶舱，入口为 `/control`。它回答两件事：项目现在是什么状态，以及 AI 刚刚做了什么。页面按手机阅读优先设计，默认使用人话；必要术语会在第一次出现时附简短说明。

## 访问边界

- `/control` 和 `GET /api/control-tower` 都只允许工作台管理员口令（`WORKBENCH_TOKEN`）访问。
- 参与者 token 与匿名请求均返回 `403`，即使参与者可访问普通工作台页面。
- 控制塔没有重启、触发、领取或写入动作；“刷新现状”只重新读取缓存快照。
- 各 VibeLoop 的管理员口令仅在服务器进程环境中读取，不会进入 API 响应、HTML、前端 JavaScript 或入口链接。

## 项目注册表契约

工作台 `workspace/projects.json` 的每个项目可增加 `controlTower` 字段。未配置时按 L0（仅工作台）处理；L0 不展示工单区。

```json
{
  "id": "ai-video",
  "displayName": "AI 视频剪辑",
  "executor": "cloud-codex",
  "primarySession": "ai-video-main",
  "controlTower": {
    "level": 2,
    "statusUrl": "https://loop.example.com/api/status",
    "tokenEnv": "VIBELOOP_ADMIN_TOKEN_AI_VIDEO",
    "links": {
      "feedback": "https://loop.example.com/feedback",
      "tickets": "https://loop.example.com/tickets",
      "session": "/render/?session=ai-video-main"
    },
    "serviceUnits": ["vibeloop-ai-video.service"]
  }
}
```

- `level` 是 0—4 的接入层级。L1—L4 必须配置 `statusUrl`；L0 不得配置它。
- `statusUrl` 必须是无查询参数、无口令、无片段的 `http(s)://…/api/status` 地址。
- `tokenEnv` 是环境变量**名称**，不是口令值。省略时默认使用 `VIBELOOP_ADMIN_TOKEN_<项目 ID 大写且连字符改下划线>`；例如 `ai-video` 对应 `VIBELOOP_ADMIN_TOKEN_AI_VIDEO`。
- `links` 只接受 `feedback`、`tickets`、`session` 三种入口。`session` 可以是同站相对路径；其他入口必须是无口令的 HTTP(S) 地址。
- `serviceUnits` 是该项目额外的 systemd（Linux 后台服务管理器）服务名。控制塔也会自动检查 `vibeloop-<项目>.service`、`workbench.service`、`resident-worker.service`、`notify-relay.service`。

## Loop 状态与审计事件契约

服务器只会对 L1—L4 项目的 `statusUrl` 发起 `GET /api/status`，并以 `X-Workbench-Token` 头携带该项目的服务器环境变量口令。单次拉取超时为 5 秒且拒绝跟随重定向；HTTP `200`、`401`、`403` 都表示服务仍可达，但后两者不会被当作已取得业务数据。远端状态会先按口令值和敏感字段名脱敏，再进入任何响应。

最小可用状态可以只有当前服务状态。若提供下列字段，控制塔会完整显示项目卡、待拍板数量和时间线：

```json
{
  "tickets": {
    "open": 2,
    "byStatus": { "awaiting_human": 1, "merged": 1 }
  },
  "decisions": { "open": 1, "overdue": 1 },
  "recentActivityAt": "2026-07-26T04:03:00.000Z",
  "service": { "label": "在线" },
  "events": [
    {
      "id": "ticket-fixed-42",
      "at": "2026-07-26T04:03:00.000Z",
      "actor": { "id": "cloud-codex", "name": "云端 Codex", "kind": "ai" },
      "location": { "ticketId": "t-export", "url": "https://loop.example.com/tickets/t-export" },
      "action": { "type": "ticket.fixed", "label": "修好了工单 t-export（导出失败）" },
      "result": { "status": "merged", "summary": "已排队等合入主线", "url": "https://github.com/org/repo/pull/7" },
      "raw": { "event": "ticket.fixed" }
    }
  ]
}
```

每个 `events` 项都必须具备审计五要素：

1. `at`：时间；
2. `actor`：谁做的；
3. `location`：在哪个项目、会话或工单；
4. `action`：做了什么；
5. `result`：结果和可选链接。

缺少任何要素的外部事件不会被写进时间线。默认层会把五要素合成一句可读的话；展开后才展示原始 JSON 和上下文链接。工作台还会只读合并会话流、最新决策卡和执行收件箱事件。

状态词在默认界面使用中文：`pending`（待处理）、`claimed`（已认领）、`awaiting_human`（等你拍板）、`fix_failed`（修复失败）、`merged`（已合入主线）。技术字段仍保留在展开详情中。

## 聚合、缓存与失败语义

- 控制塔缓存完整只读快照 20 秒；筛选、时间范围和分页在缓存快照上执行，不会重复拉取各 loop。
- 默认时间范围是最近 24 小时；API 可接受 `project`、`executor`、`type`、`window`（`24h` / `7d` / `30d` / `all`）、`page`、`pageSize`（最大 100）。
- 远端状态、systemd、磁盘或看门狗不可用时，一律显示“取不到”或“未知”，绝不把失败伪装成正常。
- 收件箱使用专门的无副作用读取路径：控制塔不会顺带回收超时任务或修改任何状态。

## 系统健康来源

系统健康由服务器侧采集，浏览器不执行命令：

- systemd 服务状态和最近启动时间通过固定参数的 `systemctl show` 获取；无法运行 systemd 的环境显示“未知”。
- 云端 worker 使用工作台已有心跳；本地监听器只在任务已经被认领或完成后才显示“有拉取记录”，仅入队不算拉取。
- GitHub Actions（云端自动运行的任务）读取已完成外部评审任务的最近结论；例如 CI（自动测试）的通过或失败。
- 磁盘水位使用服务器文件系统统计；无法读取时显示“未知”。
- 可选的 `CONTROL_TOWER_LOG_DIR` 可指定一个绝对日志目录。服务器会跳过符号链接、最多统计 10,000 个普通文件的占用量；未配置、不可读取或超过上限时显示“未知”。
- 可选的 `CONTROL_TOWER_WATCHDOG_FILE` 可指向一个不超过 64 KiB 的 JSON 文件：`{ "ok": true, "at": "ISO 时间" }` 或 `{ "result": "异常", "at": "ISO 时间" }`。未配置或无法读取时显示“未知”。

## 验证范围

自动化测试覆盖管理员口令门、参与者与匿名 `403`、聚合失败显式化、拒绝状态接口重定向、远端意外回显口令时的脱敏、20 秒缓存、时间线筛选与分页、L0 不展示工单区、五要素完整性，以及“仅入队不等于本地监听器已经拉取”的只读健康语义。
