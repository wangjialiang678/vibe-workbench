# notify-relay：工作台事件 → 飞书通知中继

把 vibe-workbench 的事件 webhook（`WORKBENCH_EVENT_WEBHOOK`）以及其他系统的事件 POST，格式化成中文通知，经外部 CLI（lark-cli）推送到飞书。凭证由 lark-cli 自管，中继本身不接触任何 secret。

`sirui_notify_relay.py` 是思锐 TMS 项目的实例（2026-08-20 上线）。**本仓库是它的唯一版本源**——部署副本必须与这里字节一致（此前它只活在服务器上，无版本控制，是被流程审计点名的反模式）。

## 事件与消息分支

| 事件 | 来源 | 通知 |
|---|---|---|
| `feedback-submitted` | 工作台（评审门户） | 「X 提交了第 N 轮反馈」+ 分诊指引 |
| `message-posted` | 工作台 | 「X 发来一条消息」；`author.role == 'ai'` 的跳过（不自我提醒） |
| `round-presented` | 工作台 | 「第 N 轮内容已发布」 |
| `feedback-created` + `source: "tms-demo"` | TMS 演示系统（`TMS_FEEDBACK_WEBHOOK`） | 分类/页面/联系方式/内容预览 + 分诊指引 |
| 其他（含 `{text}` 手工 POST） | curl 测试等 | 透传文本 |

## 部署（东京机现行）

- 路径：`~/apps/sirui-review-workbench/scripts/sirui_notify_relay.py`
- 服务：`sirui-notify-relay.service`（127.0.0.1:8125，仅本机）
- 环境：`~/.sirui-notify.env` 的 `NOTIFY_SEND_ARGV`（JSON argv 模板，`{text}` 占位；现行为 lark-cli 机器人私聊）
- 上游：`~/.sirui-review.env` 的 `WORKBENCH_EVENT_WEBHOOK=http://127.0.0.1:8125/`；演示系统经 systemd drop-in `sirui-demo-tms.service.d/webhook.conf` 的 `TMS_FEEDBACK_WEBHOOK`

更新流程：改本文件同目录脚本 → scp 到部署路径 → `sudo systemctl restart sirui-notify-relay` → **验证**（`md5` 比对 + 下方 e2e）。

## e2e 测试

```bash
# 服务器本机执行；成功 = {"ok": true} 且飞书收到一条【思锐评审门户】前缀消息
curl -s -X POST http://127.0.0.1:8125/ -H 'content-type: application/json' \
  -d '{"text":"中继 e2e 测试，请忽略"}'
```
