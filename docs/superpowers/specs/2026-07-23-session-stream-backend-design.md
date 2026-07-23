# 会话流第一期后端设计

## 目标与边界

在不改变现有轮次、反馈和默认 `wait` 行为的前提下，为每个会话增加 append-only 消息流、AI 回执、事件化等待、附件上传和历史留言迁移。实现保持纯 Node ESM、零新依赖；本期不做前端消息 UI、数据库、删除/编辑消息或附件管理。

## 方案选择

采用独立的 `workspace/<session>/stream.jsonl` 作为单一事件流。相比把消息混入各轮 `feedback.json`，它能表达跨轮消息和进度；相比 SQLite，它不增加依赖或部署状态。每行是完整 JSON，新增事件只追加，不原地更新。

`src/stream.mjs` 是唯一数据层入口，负责条目校验、ID/时间生成、追加、游标读取和迁移。服务端沿用现有请求身份、`isValidSessionName` 和 `{ exactSession: true }` 路径规则；CLI 本地模式直读文件，远程模式只走 `/api/feedback` 与 `/api/messages`。

## 数据与游标

条目形状固定为：

```js
{
  id,
  at,
  author: { id, name, role: 'owner' | 'participant' | 'ai' },
  kind: 'message' | 'receipt' | 'progress',
  text,
  refs: { round?, blockId? } // 可选
}
```

新条目 ID 使用 `randomUUID()`；迁移条目 ID 由会话、轮次、作者、提交时间确定性摘要生成，以保证重复迁移不重复。`since` 命中 ID 时返回其后的条目；传可解析时间戳时返回 `at` 严格晚于该时间的条目；缺省返回最后 100 条。读取时跳过空行，损坏 JSON 行不会阻止后续有效条目读取。

## API 与副作用

- `POST /api/messages`：owner/participant 均可；服务端从 `req.identity` 写实名作者；空白文本或超过 4000 个 Unicode 字符返回 400；成功返回 `{ok:true,entry}`，并异步投递 `message-posted`。
- `GET /api/messages`：校验 session，支持 `since`，缺省最后 100 条，返回 `{ok:true,entries}`。
- `POST /api/stream-events`：仅 owner；只接受 `receipt`/`progress`，作者固定为 AI。
- `POST /api/rounds`：轮次落盘后、成功响应前追加 AI `receipt`。
- `POST /api/feedback`：反馈落盘后、成功响应前追加 AI `receipt`，使用服务端实名作者。
- `POST /api/attachments?session=`：读取最多 5 MiB 原始二进制；只接受 PNG/JPEG/WebP/GIF/PDF；文件名取安全 ASCII slug、毫秒时间戳和 MIME 对应扩展，写入 `assets/uploads/`，返回既有 `/assets/` URL。

## wait 事件化

`cmdWait(..., {events:true})` 启动时记录流尾 ID。每轮先检查目标轮 feedback，再读取该 ID 之后的流条目；新流条目统一返回 `{ok:true,event:'message',session,round,message:<entry>}`。即使条目 kind 是 receipt/progress，外层事件仍为 `message`，由 `message.kind` 区分。无 `--events` 时不读取流，返回结构和轮询间隔均保持不变。

## 迁移

`migrateSessionComments(session)` 扫描精确会话目录下各轮规范 `feedback.json`。只迁移非空 `sessionComment`，作者取 `submittedBy`（旧数据缺失时回退管理员），时间取 `submittedAt`，引用写 `refs.round`。确定性 ID 与现有流 ID 去重，返回迁移数量。

## 错误与验证

API 沿用 `{ok:false,error}`；非法 session/文本/类型返回 400，participant 调管理员事件返回 403，过大附件返回 413，不支持的 MIME 返回 415。测试覆盖数据层、身份、边界、两类自动回执、管理员权限、附件、安全文件名、事件唤醒和迁移幂等，并跑完整 `node --test`。
