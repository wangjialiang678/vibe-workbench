# 服务端路由顺序与鉴权边界

`routes/index.mjs` 的数组顺序与 2026-08-22 拆分前 `server.mjs` 中的 if/else 顺序一致。不要按字母顺序重排：`/api/inbox/`、`/api/participants/` 和 `/assets/` 是前缀匹配，末尾 `GET *` 是静态页面兜底。

所有请求先经过同一套前置处理：OPTIONS CORS 预检、页面 no-referrer、安全 token 解析和 identity 解析。开启 `WORKBENCH_TOKEN` 后，所有 `/api/*`、页面入口和 `/assets/*` 都在路由匹配前鉴权；所以无 token 的未知 API 也返回 **403**，不是 404。`/api/participants-public` 仅是参与者名册的公开读取接口，不绕过这一全局 token 门。

端点的原始顺序如下：

1. `* /api/health`
2. `GET /api/control-tower`
3. `* /api/inbox/…`（管理员 executor）
4. `POST /api/worker-heartbeat`（管理员 worker）
5. `GET|POST /api/documents`
6. `GET|POST /api/messages`
7. `GET /api/participants-public`
8. `POST /api/stream-events`
9. `POST /api/attachments`
10. `GET /api/assets`
11. `GET /api/sessions`、`GET /api/projects`、`GET /api/session-context`
12. `* /api/participants` 与 `* /api/participants/…`（管理员名册管理）
13. `POST /api/rounds`
14. `GET /api/feedback`
15. `GET /api/status`、`GET /api/content`
16. `POST /api/feedback`
17. `* /api/proxy`
18. `POST /api/retry`
19. `GET /assets/…`（会话资产；前缀匹配，必须在静态页面兜底前）
20. `GET *`（`/` 重定向与 `src/` 静态文件）

受额外角色限制的端点仍在各自 handler 内判断，而不是在路由查找时提前短路：控制塔、收件箱、worker heartbeat、session-context、participants 管理、stream-events、documents 发布、rounds、feedback/retry 都保留原有 owner/participant 语义。
