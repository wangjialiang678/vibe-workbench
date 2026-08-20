#!/usr/bin/env python3
"""思锐评审门户 → 飞书通知中继。

接收 vibe-workbench 的事件 webhook（WORKBENCH_EVENT_WEBHOOK 指向本服务），
格式化成中文通知，经 NOTIFY_SEND_ARGV 指定的外部 CLI（lark-cli）发出。
凭证由 lark-cli 自管，本脚本不接触任何 secret。

环境变量：
  NOTIFY_SEND_ARGV  JSON 数组，argv 模板，其中 "{text}" 占位符会被替换为通知文本
用法：python3 sirui_notify_relay.py --port 8125
"""
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_BODY = 64 * 1024
PREFIX = "【思锐评审门户】"


def format_event(payload):
    """workbench 事件 → 通知文本；返回 None 表示不需要通知。"""
    event = payload.get("event")
    session = payload.get("session") or "?"
    at = payload.get("at") or ""
    if event == "feedback-submitted":
        who = (payload.get("submittedBy") or {}).get("name") or "匿名"
        rnd = payload.get("round")
        return (
            f"{PREFIX}{who} 提交了第 {rnd} 轮反馈（会话 {session}，{at}）\n"
            "→ 处理：按 系统运行手册 §三 分诊（BUG→Codex｜需求变更→台账七步｜新功能→确认清单）"
        )
    if event == "message-posted":
        author = payload.get("author") or {}
        if author.get("role") == "ai":
            return None  # 自家 AI 的回执/回访不用提醒自己
        name = author.get("name") or "有人"
        return f"{PREFIX}{name} 在会话 {session} 发来一条消息（{at}），去门户看看。"
    if event == "round-presented":
        rnd = payload.get("round")
        title = payload.get("title")
        suffix = f"：{title}" if title else ""
        return f"{PREFIX}第 {rnd} 轮内容已发布{suffix}（会话 {session}）"
    if event == "feedback-created" and payload.get("source") == "tms-demo":
        cat = payload.get("category") or "?"
        page = payload.get("page") or "?"
        contact = payload.get("contact") or "未留联系方式"
        preview = (payload.get("contentPreview") or "")[:120]
        return (
            "【思锐演示系统】客户提交了新反馈（" + str(cat) + "）\n"
            "页面：" + str(page) + "｜联系：" + str(contact) + "\n"
            "内容：" + str(preview) + "\n"
            "→ 全文：demo /api/feedback?status=NEW；按运行手册 §三 分诊"
        )
    # 未知事件/手工 POST：透传 title/text 字段，便于 curl 测试
    text = payload.get("text") or payload.get("title")
    if text:
        return f"{PREFIX}{text}"
    return f"{PREFIX}收到未识别事件：{json.dumps(payload, ensure_ascii=False)[:500]}"


def send_notification(text):
    argv_json = os.environ.get("NOTIFY_SEND_ARGV", "")
    if not argv_json:
        print("[relay] NOTIFY_SEND_ARGV 未配置，仅记录：", text, flush=True)
        return True
    try:
        argv = [a.replace("{text}", text) for a in json.loads(argv_json)]
    except (json.JSONDecodeError, TypeError) as e:
        print("[relay] NOTIFY_SEND_ARGV 解析失败：", e, flush=True)
        return False
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            print("[relay] 发送失败：", r.stderr[:500] or r.stdout[:500], flush=True)
            return False
        return True
    except Exception as e:  # noqa: BLE001 — 中继失败绝不影响门户主流程
        print("[relay] 发送异常：", e, flush=True)
        return False


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._reply(400, {"ok": False, "error": "bad length"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._reply(400, {"ok": False, "error": "bad json"})
            return
        text = format_event(payload if isinstance(payload, dict) else {})
        if text is None:
            self._reply(200, {"ok": True, "skipped": True})
            return
        ok = send_notification(text)
        self._reply(200 if ok else 502, {"ok": ok})

    def _reply(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # 只在异常路径打印，正常请求不刷日志
        pass


def main():
    port = 8125
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"[relay] sirui notify relay listening on 127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
