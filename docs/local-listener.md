# 本地监听器安装与排查

本地监听器运行在创始人的 Mac 上，定时从云端工作台收件箱拉取 `executor=local-mac` 的 `pending` 任务，领取后单并发执行，最后通过 HTTP API 回执。它绝不挂载、读取或写入云端的 `workspace/inbox/`；任务列表、领取、续租和完成全部走 `/api/inbox/*`。

## 前置条件

- macOS、Node.js 20 或更高版本。
- 云端工作台管理员口令，即服务端配置的 `WORKBENCH_TOKEN`；参与者口令不能访问收件箱。
- 执行 `codex-task` 需要 `tcd` 在 launchd 的 `PATH` 中；执行 `claude-task` 需要 `claude` 在 `PATH` 中。
- `notify` 使用系统自带的 `osascript`，不需要额外安装依赖。

## 配置

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `WORKBENCH_URL` | 否 | `http://127.0.0.1:8099` | 工作台 HTTP/HTTPS 地址；会去掉尾部 `/`、查询串和 fragment。 |
| `WORKBENCH_TOKEN` | 是 | 无 | 管理员口令，只放在本机 plist 或受保护的环境中。 |
| `LISTENER_EXECUTOR` | 否 | `local-mac` | 要拉取的执行面 ID。 |
| `POLL_MS` | 否 | `30000` | 空闲轮询间隔，单位毫秒，必须是正整数。 |
| `LISTENER_REPO_MAP` | 是（代码任务） | `{}` | JSON 对象，键为 `projectId`，值为本机仓库绝对路径。 |

例如：

```json
{"vibeloop":"/Users/founder/src/vibeloop","landing-page":"/Users/founder/src/landing-page"}
```

映射只接受绝对路径。任务必须显式携带 `payload.projectId`（兼容顶层 `projectId`），监听器不会根据 session 名称猜仓库，也不会把未映射任务放到工作台仓库或其他默认目录执行。

## 支持的任务负载

云端任务的公共字段由收件箱协议负责；下面是本地监听器识别的 `type` 与 `payload`：

```json
{
  "type": "codex-task",
  "payload": {
    "projectId": "vibeloop",
    "prompt": "实现并测试本轮需求",
    "timeoutMinutes": 45
  }
}
```

- `codex-task`：执行 `tcd start -p codex --worktree -d <repo> -m <prompt>`，随后轮询 `tcd check <task-id>`。超时上限是 `payload.timeoutMinutes`，未提供时为 45 分钟。
- `claude-task`：在映射仓库内执行 `claude -p <prompt> --output-format text`，最长 30 分钟；stdout 最多 4000 字作为完成摘要。执行前后会向对应 session 写一条带 `『本地监听器』` 标记的 progress。
- `notify`：只执行 macOS 系统通知，不需要 `projectId`。负载可用 `message`、可选 `title`：

  ```json
  {"type":"notify","payload":{"title":"工作台","message":"有任务需要处理"}}
  ```

不支持的 type、缺少项目映射、CLI 不存在或启动失败，都会通过 `complete {"ok":false,"summary":"..."}` 回执，不会让监听器进程退出。

## 手动运行

先确认 CLI 和路径：

```bash
which node
which tcd
which claude
test -d /Users/founder/src/vibeloop
```

从仓库根目录运行：

```bash
WORKBENCH_URL=https://workbench.example.com \
WORKBENCH_TOKEN='本机管理员口令' \
LISTENER_REPO_MAP='{"vibeloop":"/Users/founder/src/vibeloop"}' \
node scripts/local-listener.mjs
```

日志位于 `~/.vibeloop-listener/listener.log`。启动时如果主日志超过 5 MiB，会先轮转为 `listener.log.old`。

## launchd 安装

1. 复制模板：

   ```bash
   mkdir -p "$HOME/.vibeloop-listener" "$HOME/Library/LaunchAgents"
   cp scripts/local-listener.plist.template \
     "$HOME/Library/LaunchAgents/com.vibeloop.local-listener.plist"
   ```

2. 编辑 plist，把 `__NODE_BIN__`、`__LISTENER_SCRIPT__`、`__WORKBENCH_DIR__`、`__WORKBENCH_URL__`、`__WORKBENCH_TOKEN__`、`__LISTENER_REPO_MAP_JSON__` 和 `__HOME__` 替换为本机值。XML 中的 `&`、`<`、`>`、引号需要转义；管理员口令不要提交到 Git。

3. 保护配置并加载：

   ```bash
   chmod 600 "$HOME/Library/LaunchAgents/com.vibeloop.local-listener.plist"
   launchctl bootstrap "gui/$(id -u)" \
     "$HOME/Library/LaunchAgents/com.vibeloop.local-listener.plist"
   launchctl print "gui/$(id -u)/com.vibeloop.local-listener"
   tail -f "$HOME/.vibeloop-listener/listener.log"
   ```

4. 停止或重新加载：

   ```bash
   launchctl bootout "gui/$(id -u)/com.vibeloop.local-listener"
   launchctl bootstrap "gui/$(id -u)" \
     "$HOME/Library/LaunchAgents/com.vibeloop.local-listener.plist"
   ```

launchd 的 `RunAtLoad` 负责登录后启动，`KeepAlive` 负责进程异常退出后的拉起。收到 SIGTERM 时监听器停止拉新，等待当前任务最多 60 秒；如果仍未收尾，会中止本地子进程但不发送完成回执，云端租约超时后会把任务退回 `pending`。

## 排查

### 没有拉到任务

- 查看 `listener.log` 是否有 `工作台请求失败`、HTTP `403` 或 `404`。
- 确认 `WORKBENCH_URL` 是能从本机访问的地址，且 `WORKBENCH_TOKEN` 是管理员口令。
- 在云端确认任务的 `executor` 是 `local-mac`、状态是 `pending`；列表 API 会按执行面和状态过滤：

  ```bash
  curl --fail-with-body \
    -H "X-Workbench-Token: $WORKBENCH_TOKEN" \
    "$WORKBENCH_URL/api/inbox/tasks?executor=local-mac&status=pending"
  ```

### 领取后一直没有完成

- 长任务每 10 分钟续租一次；日志中的 `任务续租失败` 表示应先检查网络、口令和云端租约。
- 任务是 at-least-once 语义：进程崩溃或租约超时后可能再次执行，任务本身的外部副作用应设计为幂等。
- `tcd` 或 `claude` 不在 launchd 的 PATH 时，手动 shell 能运行但 launchd 仍可能失败；把 `which` 得到的 node/CLI 路径加入 launchd 环境，或使用绝对路径的启动脚本。

### 代码任务仓库错误

- `LISTENER_REPO_MAP 未配置项目`：检查任务 `payload.projectId` 与 JSON 键是否完全一致。
- `cwd` 不存在、不是仓库或 CLI 自己拒绝执行，会以失败摘要完成回执；监听器不会回退到其他目录。

### Claude 没有出现在对话流

监听器会尝试写两条 `progress`，但流事件写入失败不会阻断任务执行。检查 `/api/stream-events` 的管理员权限、session 名称和 `listener.log`；最终 `/complete` 成功后云端还会追加标准任务回执。

### launchd 状态异常

```bash
launchctl print "gui/$(id -u)/com.vibeloop.local-listener"
tail -100 "$HOME/.vibeloop-listener/launchd.stderr.log"
tail -100 "$HOME/.vibeloop-listener/launchd.stdout.log"
plutil -lint "$HOME/Library/LaunchAgents/com.vibeloop.local-listener.plist"
```

修改 plist 后必须先 `bootout` 再 `bootstrap`；只编辑文件不会自动更新已加载的 launchd job。
