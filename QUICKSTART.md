# 五分钟上手

这是一个**人机协作的共享工件层**：你的 AI 把每一轮思考渲染成一个网页，你在网页上点选、批注、改写，提交后 AI 读到结构化反馈继续干活。聊天框只是最弱的一种载体。

## 你需要什么

- **Node ≥ 20**（`node -v` 确认）。工作台本体零依赖，不用装任何 npm 包。
- **一个 AI 编码工具**：Claude Code、Codex、或 WorkBuddy（任选其一，用你自己的订阅）。
- macOS 或 Linux。Windows 请在 WSL 里跑。

## 1. 装起来

```bash
git clone https://github.com/wangjialiang678/vibe-workbench.git
cd vibe-workbench

npm test                    # 全绿说明环境没问题（零依赖，几秒钟）
bash integrations/install.sh   # 让你的 AI 学会用工作台
```

`install.sh` 会自动探测你装了哪个 AI 工具并配好协议。详见 [integrations/README.md](integrations/README.md)。

## 2. 起服务

```bash
node bin/workbench.mjs up --port 8099
```

默认只监听 `127.0.0.1`（本机），不设共享口令就不允许对外暴露。

## 3. 跑通第一轮

新开一个终端，进入**你自己的项目目录**，启动你的 AI，然后说：

> 用工作台把这个方案渲染出来让我确认

AI 会给你一个链接（形如 `http://127.0.0.1:8099/render/?session=xxx`），浏览器打开就能看到：

- **顶部**是需要你拍板的事——完全没有预设的排最前，有推荐的次之（推荐项已预选）
- **中间**是 AI 的思路、架构图这些给你看的东西
- **折叠区**是已经设好默认值的，你同意就不用管

选完、写完批注，点提交。AI 会被自动唤醒继续干活，页面状态徽章变「已回复」。

> 想手动验证一下渲染效果？`node bin/workbench.mjs present demo docs/examples/*.json`（如果仓库里有示例）或让 AI 随便渲染一轮。

## 4. 接到你自己的项目上

不用做任何配置——工作台是**跨项目**的：在任何项目目录里让 AI 调用 `bin/workbench.mjs` 即可，会话数据按 session 名隔离存在 `workspace/<session>/`。

想让「提交反馈」自动唤醒 AI，用哪个 AI 由环境变量决定：

```bash
WORKBENCH_AGENT=claude    node bin/workbench.mjs up --port 8099
WORKBENCH_AGENT=workbuddy node bin/workbench.mjs up --port 8099
WORKBENCH_AGENT=codex     node bin/workbench.mjs up --port 8099
```

不设则自动探测。

## 常见问题

**页面打不开 / 突然白屏**
server 偶尔会挂。自己起一个不会被杀的：
```bash
(nohup node bin/workbench.mjs serve --port 8099 >/tmp/wb.log 2>&1 & disown)
```

**我提交了，但 AI 没反应**
你的批注**永远存在磁盘上**，不会丢：
```
workspace/<session>/round-<N>/feedback.json
```
直接让 AI 读这个文件即可，不用等任何自动化。

**AI 给我的决策看不懂 / 全是术语**
这是 AI 侧的文案问题，不是工具问题。协议里明确要求每个决策块必须写清「背景 / 为什么需要你定 / 每个选项的利弊 / 推荐理由」，`present` 时会自动 lint 警告。你可以直接在批注里写「没看懂，请补背景」——这是有效反馈，AI 会重写。

**能给别人看吗？**
可以。绑定 `0.0.0.0` 必须设共享口令，否则服务会拒绝启动：
```bash
WORKBENCH_TOKEN='换成足够长的随机值' node bin/workbench.mjs up --host 0.0.0.0 --port 8099
```
公网入口请自行套 HTTPS 反代。详见 [README.md](README.md) 的「公网部署与共享口令」。

**端口被占了**
换一个端口即可，但**起服务和渲染要用同一个端口**——`present` 默认连 8099，不显式传就会指到错的地方：

```bash
node bin/workbench.mjs up --port 8123                      # 起服务
node bin/workbench.mjs present <session> content.json --port 8123   # AI 侧也要带上
```

告诉你的 AI「工作台在 8123 端口」，它就会在每次 `present` 时带上 `--port`。

## 下一步

- [integrations/workbench-protocol.md](integrations/workbench-protocol.md) —— AI 侧的完整协议（你也可以读，能帮你判断 AI 用得对不对）
- [docs/authoring-guide.md](docs/authoring-guide.md) —— 怎么写出让人看得懂的决策块（含真实病例）
- [docs/DESIGN.md](docs/DESIGN.md) —— 设计与协议细节
