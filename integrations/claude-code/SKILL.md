---
name: workbench
description: 用网页工作台（Vibe Workbench）跟用户确认方案 / 做多选决策 / 逐条评审 / 共创文档 / brainstorm 讨论——把思考渲染成图文网页（注意力分区 + 轮次 diff + 容错），用户在网页就地选择/批注/改写，提交后异步唤醒你续跑。当需要用户做结构化决策或评审、而不该在聊天里堆 markdown 时使用。触发词：用工作台、present、确认方案、评审一下、让我选、共创文档、Vibe Workbench、把思考给我看。
---

# Vibe Workbench —— 人机交互工作台

把"在聊天里堆 markdown 等用户打字回复"换成"渲染成可交互网页、用户点选/批注、提交即唤醒你续跑"。

## 工作台在哪

安装脚本会把工作台仓库路径写进同目录的 `workbench-path.txt`。读它拿到 `$WB`：

```bash
WB="$(cat ~/.claude/skills/workbench/workbench-path.txt)"
```

没有这个文件就说明装歪了，让用户重跑 `integrations/install.sh`。

## 完整协议

**动手前先读同目录的 `workbench-protocol.md`** —— 它是唯一权威协议，包含：

- 何时用 / 不用，三种典型场景对应的模板
- `present` / `wait` 命令与一句话流程
- content.json 的 block 协议速查（12 种 block 类型 + 注意力元数据）
- **决策块必须写人话的硬要求**（背景 / 为什么需要你定 / 选项利弊 / 推荐理由四段式）——这条最容易踩坑，不读会产出"伪决策"
- 在真实产物上批注（embed）、feedback 形状、卡住了怎么自救

## 最小可用流程

```bash
WB="$(cat ~/.claude/skills/workbench/workbench-path.txt)"

# 1) 用写文件工具把 content.json 写到临时文件（别用 shell echo，转义换行会踩坑）
# 2) 渲染一轮，拿到 URL
node "$WB/bin/workbench.mjs" present <session> /path/to/content.json
# 3) 把返回的 url（不带 round）发给用户
# 4) 后台等待提交
node "$WB/bin/workbench.mjs" wait <session> <round>
# 5) 读 feedback 续跑；下一轮复用相同 block id
```

**只要用户说"提交了"，直接读 `$WB/workspace/<session>/round-<N>/feedback.json`**，别卡在等待步骤上。
