#!/usr/bin/env python3
"""sirui_notify_relay.format_event 的零依赖回归测试。"""
import unittest

from sirui_notify_relay import format_event


class RelayFormatTest(unittest.TestCase):
    def test_legacy_tms_payload_without_new_fields(self):
        text = format_event({
            "event": "feedback-created",
            "source": "tms-demo",
            "category": "BUG",
            "page": "/orders",
            "contact": "13800000000",
            "contentPreview": "列表打不开",
        })
        self.assertIn("【思锐演示系统】客户提交了新反馈（BUG）", text)
        self.assertIn("页面：/orders｜联系：13800000000", text)
        self.assertNotIn("提交人：", text)
        self.assertNotIn("定位：", text)

    def test_new_tms_payload_renders_all_fields(self):
        anchor = "订单详情页的保存按钮" * 20
        text = format_event({
            "event": "feedback-created",
            "source": "tms-demo",
            "category": "需求",
            "page": "/legacy",
            "reporterRole": "调度员",
            "reporterIdentity": "王师傅",
            "pageRoute": {"page": "/orders/detail", "query": "id=42&tab=route"},
            "anchorText": anchor,
            "buildVersion": "tms-2026.08.31",
            "contact": "wang@example.com",
            "contentPreview": "希望保存后保留当前标签页",
        })
        self.assertIn("提交人：王师傅（调度员）", text)
        self.assertIn("页面：/orders/detail?id=42&tab=route｜联系：wang@example.com", text)
        self.assertIn("定位：" + anchor[:120], text)
        self.assertNotIn(anchor[:121], text)
        self.assertIn("内容：希望保存后保留当前标签页", text)
        self.assertTrue(text.endswith("按运行手册 §三 分诊｜版本：tms-2026.08.31"))

    def test_new_fields_missing_none_or_wrong_type_never_raise(self):
        variants = [
            {},
            {"reporterRole": None, "reporterIdentity": None, "pageRoute": None,
             "anchorText": None, "buildVersion": None},
            {"reporterRole": [], "reporterIdentity": {}, "pageRoute": "bad",
             "anchorText": 123, "buildVersion": []},
        ]
        for fields in variants:
            with self.subTest(fields=fields):
                payload = {
                    "event": "feedback-created",
                    "source": "tms-demo",
                    "page": "/legacy",
                    **fields,
                }
                text = format_event(payload)
                self.assertIsInstance(text, str)
                self.assertIn("页面：/legacy", text)

        for payload in (None, [], "bad", 123):
            with self.subTest(payload=payload):
                self.assertIsInstance(format_event(payload), str)

    def test_tms_attachments_render_count_and_full_urls(self):
        text = format_event({
            "event": "feedback-created",
            "source": "tms-demo",
            "contentPreview": "有截图的反馈",
            "attachmentCount": 2,
            "attachmentPaths": [
                "/api/feedback/attachments/first",
                "/api/feedback/attachments/second",
            ],
        })
        self.assertIn("截图：2 张", text)
        self.assertIn("https://demo.ai-opc.studio/api/feedback/attachments/first", text)
        self.assertIn("https://demo.ai-opc.studio/api/feedback/attachments/second", text)
        self.assertLess(text.index("内容："), text.index("截图："))
        self.assertLess(text.index("截图："), text.index("→ 全文："))

    def test_tms_attachments_missing_fields_keeps_legacy_output(self):
        text = format_event({
            "event": "feedback-created",
            "source": "tms-demo",
            "contentPreview": "没有截图字段",
        })
        self.assertNotIn("截图：", text)

    def test_tms_attachments_limit_urls_and_report_remainder(self):
        paths = [f"/api/feedback/attachments/{number}" for number in range(8)]
        text = format_event({
            "event": "feedback-created",
            "source": "tms-demo",
            "attachmentCount": 8,
            "attachmentPaths": paths,
        })
        self.assertEqual(text.count("https://demo.ai-opc.studio/api/feedback/attachments/"), 6)
        self.assertIn("…另 2 张", text)
        self.assertNotIn("https://demo.ai-opc.studio/api/feedback/attachments/6", text)

    def test_tms_attachment_paths_string_is_ignored_without_raising(self):
        text = format_event({
            "event": "feedback-created",
            "source": "tms-demo",
            "attachmentCount": 1,
            "attachmentPaths": "/api/feedback/attachments/not-a-list",
        })
        self.assertNotIn("截图：", text)


if __name__ == "__main__":
    unittest.main()
