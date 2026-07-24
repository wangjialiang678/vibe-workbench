# integrations —— 让你的 AI 会用这个工作台

工作台本体是零依赖的 Node 程序，`git clone` 下来就能跑。但**你的 AI 需要知道"什么时候用它、content.json 怎么写"**——那份知识就在这个目录里。

## 一键安装

```bash
bash integrations/install.sh
```

自动探测你机器上有哪些 AI 编码工具并装好对应的协议。也可以指定：

```bash
bash integrations/install.sh claude-code            # Claude Code
bash integrations/install.sh codex ~/my-project     # Codex（写进该项目的 AGENTS.md）
bash integrations/install.sh workbuddy ~/my-project # WorkBuddy
```

重复执行会覆盖同一段落，不会重复追加。

## 三条链路装到哪、怎么生效

| AI 工具 | 协议装到哪 | 怎么生效 |
|---|---|---|
| **Claude Code** | `~/.claude/skills/workbench/` | 全局 skill，任何项目里说「用工作台确认方案」自动触发 |
| **Codex** | 你项目的 `AGENTS.md` | Codex 自动读项目 AGENTS.md，按项目生效 |
| **WorkBuddy** | 你项目的 `AGENTS.md` | 同上（WorkBuddy 内核是 CodeBuddy，同样读 AGENTS.md） |

## 目录里有什么

- `workbench-protocol.md` —— **唯一权威协议**（agent 无关）。三条链路装的都是同一份内容，改协议只改这里。
- `claude-code/SKILL.md` —— Claude Code skill 的入口（带 frontmatter），正文指向上面那份协议。
- `codex/AGENTS.md` —— 给 Codex / WorkBuddy 的协议片段，安装时会把 `$WB` 替换成你的实际路径。
- `install.sh` —— 安装脚本。

## 让「提交反馈」自动唤醒 AI（可选）

默认流程是你手动把 URL 发给对方、对方提交后你继续。想让它自动续跑：

```bash
node bin/workbench.mjs up --port 8099
```

`up` 会同时起 HTTP server 和唤醒 listener。用哪个 AI 由环境变量决定：

```bash
WORKBENCH_AGENT=claude    node bin/workbench.mjs up   # Claude Code
WORKBENCH_AGENT=workbuddy node bin/workbench.mjs up   # WorkBuddy / CodeBuddy
WORKBENCH_AGENT=codex     node bin/workbench.mjs up   # Codex
```

不设 `WORKBENCH_AGENT` 则自动探测（PATH 里有 `claude` 就用 claude，否则 `codebuddy`，否则 `codex`）。

二进制不在 PATH 里时，可以显式指定：

| 变量 | 用途 |
|---|---|
| `WORKBENCH_WORKBUDDY_BIN` | WorkBuddy/CodeBuddy CLI 路径（macOS 默认在 `/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`） |
| `WORKBENCH_AGENT` | 选哪条链路：`claude` / `workbuddy` / `codex` |

> ⚠️ 用订阅跑长时间无人值守的自动化可能触及各家服务条款，请自行确认。你在场的交互式协作不受影响。
