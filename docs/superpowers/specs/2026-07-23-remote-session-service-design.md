# 工作台远程会话服务化设计

## 目标

云端 workspace 成为远程模式的会话唯一事实源：CLI 通过 HTTPS 写入新轮次、轮询反馈；服务端在轮次呈现和反馈提交后发送可选 webhook。未配置远程地址时，本地 CLI 行为保持不变。

## 设计选择

采用“共享 workspace 写轮次函数 + 服务端薄路由 + CLI 传输适配器”。共享函数统一完成 round 分配、`validateContent`、`content.json` / `content.md` / `status.json` 写入，并允许服务端启用独占写；本地 `cmdRender` 保留原有可覆盖语义。没有采用 CLI/服务端各自复制写入逻辑，也没有让本地模式绕 HTTP，以免规则漂移或破坏离线行为。

## 数据流

1. 远程 `present` 把 CLI session 注入完整 content，经带口令 header 的 `POST /api/rounds` 发送到云端。
2. 服务端限制 JSON body 为 2 MiB，校验 session、schema 和决策完整性，再通过共享函数独占写入新轮次；成功后立即响应，并异步发送 `round-presented`。
3. 远程 `wait` 每 3 秒请求 `GET /api/feedback`；pending 保持 HTTP 200，命中后输出与本地 wait 一致的事件对象。
4. 浏览器原有 `POST /api/feedback` 成功落盘后，异步发送 `feedback-submitted`；投递失败只写日志。

## 错误与安全边界

- session 最长 80 字符、必须符合 `/^[A-Za-z0-9._-]+$/`，并额外拒绝 `.`、`..` 路径段；round 必须为正的安全整数。
- 服务端原子占用 round 目录，同轮次重复写返回 409；写入中途失败只回收本次占位，不以“先检查后覆盖”实现。
- body 超过 2 MiB 返回 413；无效 JSON、schema 或 lint 返回 400；口令门继续统一返回 403。
- webhook 使用原生 fetch、5 秒 AbortController 超时；HTTP 错误、网络错误和超时都只写服务端日志。
- 远程 CLI 把网络错误包装成中文可读错误；页面 URL 的 token 只由 CLI 从本地环境补到 query。

## 验证

新增 workspace 单测、server E2E、CLI 远程 E2E 和 webhook stub E2E。先确认新测试在旧实现上失败，再最小实现，最后运行 `npm test` 全量回归；不弱化既有断言。
