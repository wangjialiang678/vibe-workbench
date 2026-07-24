# Vibe Workbench 协作协议（Codex / WorkBuddy 用）

> 把这段内容追加到你项目根目录的 `AGENTS.md`，或让安装脚本替你做（`integrations/install.sh`）。
> Codex 和 WorkBuddy 都会自动读取项目里的 `AGENTS.md`。

## 什么时候用工作台

需要人做选择、逐条表态、确认方案、评审 PRD/架构/原型、共创文档时——**不要在对话里堆 markdown 等人打字回复**，改用工作台：把这一轮思考渲染成网页，人在网页上就地点选/批注，提交后你读回结构化反馈继续干。

纯闲聊、单句问答、不需要人输入的输出，照常走对话。

## 三条命令

工作台仓库路径记为 `$WB`（安装脚本会在下面写死实际路径）：

```bash
# 渲染一轮，返回 URL（同步，立刻拿到）
node "$WB/bin/workbench.mjs" present <session> /path/to/content.json

# 等待提交（提交后打印 feedback JSON 并退出）
node "$WB/bin/workbench.mjs" wait <session> <round>

# 兜底：人说"提交了"但你没收到唤醒，直接读文件
cat "$WB/workspace/<session>/round-<N>/feedback.json"
```

把 `present` 返回的 `url`（**不带 round**）发给人——它跟随最新轮，你出新一轮时页面自动推进。

## content.json 怎么写

**完整协议在 `$WB/integrations/workbench-protocol.md`，动手前必须读。** 这里只给最小骨架：

```jsonc
{
  "session": "ses1", "round": 1, "title": "本轮主题",
  "blocks": [
    { "id": "b-思路", "type": "markdown", "body": "# 我的分析\n...", "needsDecision": false },
    {
      "id": "b-选方案", "type": "choice", "needsDecision": true, "hasRecommendation": true,
      "background": "一句话本质类比 + 现状：这东西是谁做的、现在什么状态、为什么要处置它",
      "why": "为什么需要人来定、为什么是现在（含四维自评：有无标准答案/置信度/重要性/可回退性）",
      "options": [
        { "id": "a", "label": "动词+名词（禁 Yes/No）", "pros": ["选了会发生什么好事"], "cons": ["代价/风险/不可逆之处"] },
        { "id": "b", "label": "另一个做法", "pros": ["..."], "cons": ["..."] }
      ],
      "recommendation": "a", "recommendReason": "为什么推荐它"
    }
  ]
}
```

## 三条最容易踩的坑

1. **决策块不写背景 = 产出伪决策**。人看不懂照样会点推荐项，你不敢采信，白费一轮。`background` / `why` / 每个选项的 `pros`+`cons` / `recommendReason` 四件套必须给齐，`present` 会 lint 并警告。
2. **选项讲后果，不讲机制**。✗"两套并存会互相合并冲突" ✓ `cons: ["会互相制造合并冲突、你要看两套待批准队列"]`。术语首次出现必须一句话解释"这是什么、跟我有什么关系、不办会怎样"。
3. **跨轮同议题必须复用同一个 block id**，否则轮次 diff（新增/改了什么）会失效。

## 被反馈自动唤醒（可选）

```bash
WORKBENCH_AGENT=codex node "$WB/bin/workbench.mjs" up --port 8099
```

`WORKBENCH_AGENT` 取值 `codex` | `workbuddy` | `claude`，不设则自动探测。人提交后 listener 会自动叫醒你续跑，结果写回 `workspace/<session>/`。
