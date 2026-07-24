# 对话流内嵌决策卡协议（D20）

本文档是工作台、常驻 worker 与其他写流客户端之间的跨仓契约。内嵌决策卡只处理一个问题、2—4 个选项的简单取舍；复杂决策继续使用整轮工作台卡片。

## 1. 写入 ask

仅持有管理员口令的 AI/worker 可调用：

```http
POST /api/stream-events
x-workbench-token: <管理员口令>
content-type: application/json
```

请求体：

```json
{
  "session": "demo-session",
  "kind": "ask",
  "text": "请选择发布方式",
  "ask": {
    "id": "deploy-mode",
    "question": "这次使用哪种发布方式？",
    "options": [
      {
        "id": "rolling",
        "label": "滚动发布",
        "desc": "风险较低，但发布时间更长。"
      },
      {
        "id": "direct",
        "label": "直接发布",
        "desc": "速度更快，但故障影响面更大。"
      }
    ],
    "multi": false,
    "recommendation": "rolling"
  }
}
```

字段约束：

- `text` 仍为必填非空字符串，是问题的纯文本摘要，供旧客户端降级显示。
- `ask.id` 是 session 内唯一的卡片 ID；重复写入返回 `409`。
- `ask.question` 必须是非空字符串。
- `ask.options` 必须有 2—4 项。
- 每个 option 的 `id`、`label`、`desc` 都必须是非空字符串，且 option ID 不可重复。`desc` 必须说明含代价的解释；缺失时返回 `400`。
- D20 只支持单选，`ask.multi` 必须为 `false`。
- `ask.recommendation` 可省略；提供时必须等于某个 option ID，否则返回 `400`。
- 作者由服务端固定为 `{ "id": "ai", "name": "AI", "role": "ai" }`，客户端传入的 `author` 无效。

成功响应中的 `entry.kind` 为 `ask`，并原样包含规范化后的 `ask` 对象。

## 2. 回答 ask

管理员和实名参与者都通过既有消息接口回答：

```http
POST /api/messages
x-workbench-token: <管理员或参与者口令>
content-type: application/json
```

请求体：

```json
{
  "session": "demo-session",
  "answerTo": "deploy-mode",
  "answerValue": "rolling"
}
```

`answerValue` 的协议类型为 option ID 字符串或 option ID 数组。D20 的 ask 固定为 `multi:false`，因此数组形式当前只接受单元素数组：

```json
{
  "session": "demo-session",
  "answerTo": "deploy-mode",
  "answerValue": ["rolling"]
}
```

服务端行为：

- `answerTo` 与 `answerValue` 必须同时出现。
- `answerTo` 必须引用同一 session 中存在的 ask；不存在时返回 `400`。
- `answerValue` 必须引用该 ask 的合法 option ID；非法值、空数组、多选数组返回 `400`。
- 同一个 ask 只接受第一份回答；再次回答返回 `409`，且不追加流条目。
- 回答人的 `author` 由服务端根据口令实名写入，忽略客户端伪造身份。
- 成功后追加 `kind:"answer"` 条目，包含 `answerTo`、`answerValue` 和服务端生成的 `text`。`text` 是所选 option label 的纯文本摘要，旧客户端仍可读。
- 普通消息请求保持原契约：未提供 answer 字段时，`text` 仍必填且最多 4000 个 Unicode 字符。

成功落流示例：

```json
{
  "id": "5df16a8e-2ea3-4eb3-a049-2cbb4097b987",
  "at": "2026-07-24T10:00:00.000Z",
  "author": {
    "id": "alice",
    "name": "小艾",
    "role": "participant"
  },
  "kind": "answer",
  "text": "滚动发布",
  "answerTo": "deploy-mode",
  "answerValue": "rolling"
}
```

## 3. 唤醒与兼容

- answer 成功后沿用 `/api/messages` 的 `message-posted` webhook，事件额外带 `kind:"answer"`；现有 resident worker 推送和轮询链路无需新增事件类型。
- worker 按真人身份接收 answer，完整 answer JSON 进入下一次任务简报的“事件原文”；answer 也进入 D19 最近对话记忆。
- worker 写入 ask 后必须结束本次运行并等待回答。ask 被视为本次运行已经产生的实质 AI 条目，worker 不再补发 stdout message 或兜底 receipt。
- 不认识 `ask`/`answer` 的旧客户端仍可使用每条流事件的 `text` 做纯文本降级。
