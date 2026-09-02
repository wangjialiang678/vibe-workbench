---
name: workbench
description: 用网页工作台（Vibe Workbench）跟用户确认方案 / 做多选决策 / 逐条评审 / 共创文档 / brainstorm 讨论——把思考渲染成图文网页（注意力分区 + 轮次 diff + 容错），用户在网页就地选择/批注/改写，提交后异步唤醒你续跑。当需要用户做结构化决策或评审、而不该在聊天里堆 markdown 时使用。触发词：用工作台、present、确认方案、评审一下、让我选、共创文档、/workbench、Vibe Workbench、把思考给我看。
---

# Vibe Workbench —— 人机交互工作台

把"在聊天里堆 markdown 等用户打字回复"换成"渲染成可交互网页、用户点选/批注、提交即唤醒你续跑"。

工作台位置（WB）：`/Users/michael/projects/AI 工作流/vibecoding 工作台`

## 何时用 / 不用

**用**：需要用户做选择、逐条表态、确认方案、评审 PRD/架构/测试、评审 UI/交互原型、共创/讨论文档或 brainstorm —— 任何"需要用户结构化输入"的场景。
**不用**：纯闲聊、单句问答、无需用户输入的普通输出。

### 三种典型用法 → 用哪个模板
| 你要做 | 模板 | 主力 block |
|---|---|---|
| 开发项目 / **PRD 审核** | `dev-review` | verdict(逐条表态) + diagram(架构) + code(Gherkin 用例) |
| **UI / 交互设计评审** | `design-review` | prototype(线框/截图/高保真，SVG 定位批注) + verdict/choice + checklist |
| **审阅 / 共创文档** · brainstorm | `think-discuss` | markdown + editable(就地改写) + verdict + 批注 |

## 一句话流程（默认模式①：IDE 内辅助）

`present 渲染一轮 → 把 URL 发给用户 → 后台 wait → 用户提交即唤醒你 → 读 feedback 续跑`

### 步骤

```bash
WB="/Users/michael/projects/AI 工作流/vibecoding 工作台"

# 1) 组织 content（见下"协议速查"），写到临时文件
#    （用 Write 工具写 content.json，避免 shell 转义换行的坑）

# 2) 一键渲染：确保 server + 写这一轮 + 返回 URL（输出 JSON 含 round/url）
node "$WB/bin/workbench.mjs" present <session> /path/to/content.json
#    → {"ok":true,"session":"...","round":N,"url":"http://127.0.0.1:8099/render/?session=...", "urlPinned":"...&round=N", ...}
#    present 会**自动在默认浏览器打开页面**（2026-08-13 起内建；--no-open 或 WORKBENCH_NO_OPEN=1 关闭）——不要再让用户自己点链接。
#    对话里提到 url 时（**不带 round**）：**裸写、独立成行、前后不加任何符号**（不加粗、不加反引号、不接标点）——
#    创始人已两次反馈"链接紧跟其他字符会不可点击"，这是硬规则。url 跟随最新轮，出新一轮页面自动推进、无需换链接。
#    仅当要用户回看某一固定轮时才用 urlPinned。round 字段留给下一步 wait 用。
```

3) **后台**运行 `wait`（用 Bash 的 run_in_background=true）——它在用户提交后退出并打印 feedback JSON，你会收到通知：
```bash
node "$WB/bin/workbench.mjs" wait <session> <round>
#    命中→ {"ok":true,"event":"feedback","feedback":{...items...}}  超时→ event:"timeout"
```
4) 收到通知后读取输出里的 feedback，据此续跑；需要下一轮就再 `present`（**同议题复用相同 block id**，diff 才准）。

> 关键：present 是同步的（立刻拿 URL）；wait 放后台跑（提交即唤醒你），二者分开调用。

## content 协议速查

```jsonc
{ "session":"ses1", "round":1, "title":"本轮主题", "blocks":[ Block ... ] }
```
Block 通用字段 + 注意力元数据（决定呈现位置）：
```jsonc
{
  "id":"b-唯一稳定slug",       // 跨轮同议题必须复用同 id
  "type":"markdown",          // 见下
  "section":"架构",           // 可选：tab 分面类目（需求/架构/UI 设计/交互设计/交互/测试/风险…）。任一块带 section → 页面出 tab 导航；空类目变灰、每 tab 角标显示未确认决策数。dev-review/design-review 已自动打 section
  "title":"可选", "body":"...",
  "needsDecision": false,      // 是否要用户决策
  "hasRecommendation": false,  // 是否带推荐
  "recommendation": null,      // 推荐的 option id / 值
  "importance":"normal",       // high|normal|low
  "default": null              // 预设默认值（仅"已设默认"项给）
}
```
type 与字段：
- `markdown` body=md ｜ `diagram` lang:"mermaid",body=源 ｜ `choice` options:[{id,label,desc?}],multi?,recommendation ｜ `verdict`（✓赞成/✗异议/?疑问）｜ `freetext` ｜ `editable` value=md（就地可改）｜ `table` columns,rows ｜ `code` lang,body ｜ `embed` url,height?（**嵌真实网页产物，就地落点批注**）
- `prototype` mode:"wireframe"|"image"|"iframe" —— 线框/截图/高保真原型，**自研 SVG 定位批注**（在图上点选落 pin 写意见）。wireframe→`screen:{id,name,widgets[]}` ｜ image→`imageUrl` ｜ iframe→`src`
- `checklist` items:[{id,label}], verdictLabels:[] —— 逐条三态清单（如 通过/存疑/不通过），completeness 自查用

## 在真实产物上批注（embed —— 重要）

当你产出的是**一个真实网页 / 部署好的可视化产物**（而非纯文字），不要只在抽象 block 上让用户表态——放一个 `embed` block 指向它，用户就能**在页面本身上就地圈点批注**：
```jsonc
{ "id":"b-page", "type":"embed", "title":"详情页（真实产物）", "url":"https://你的产物.html", "height":620, "needsDecision":false }
```
- 工作台会经 `/api/proxy` 反代该页（自动绕过 X-Frame-Options），iframe 同源嵌入。
- **飞书式批注**（无需切模式）：用户在页面上**选中文字**→浮出「💬 评论」→在**右侧评论栏**写评论；也可「+ 新增批注」写整体意见；每条评论可 **保存/编辑/删除**。
- 提交回来是 `{blockId,type:'pin',value:{quote},comment}`（`quote`=选中的原文，整体意见时为 null）——你拿到"引用原文 + 意见"，据此改产物、再 present 下一轮（同 block id 复用）。

**呈现位置由元数据决定**（这是工作台的核心"注意力编排"）：
- `needsDecision:true` + 无推荐 → 顶部「需你定·无预设」（最先看）
- `needsDecision:true` + `hasRecommendation:true` → 「需你定·有推荐」（推荐项预选）
- `needsDecision:false` + 无 default → **可见的叙述/图表区**（放你的思路、架构图）
- `needsDecision:false` + 有 default → 折叠「已设默认」（同意即跳过）

**tab 分面导航（可选叠加层）**：块带 `section`（需求/架构/UI 设计/交互设计/测试/风险…）→ 页面顶部出 **tab 导航**，上述四区在每个 tab 内部生效。canonical 类目全显、空类目灰 tab；每 tab 角标=未确认决策数（红=含必须确认/橙=只剩可接受/绿=已清零），切走也知哪面欠；提交时"必须决策"未确定会红字警示「还有 X 个必须决策没确定」。dev-review/design-review 已自动打 section。渲染页支持 `?facet=<面名>` 深链。

## ⚠️ 决策块必须写"人话"（否则用户会盲选 → 伪决策）

创始人实测反馈：**"技术术语太多，描述不够详细，没有任何背景，需要让我了解决策的上下文、原因，以及不同决策的利弊。"**
没背景的决策块**不是"没人答"，而是产出零质量的伪决策**（用户照样点推荐项，你不敢采信，白费一轮）。`present` 会自动 lint 并 warn。

`needsDecision:true` 的块**必须**给齐（渲染为固定四段：背景 → 为什么需要你定 → 选项含利弊 → 推荐及理由）：
```jsonc
{
  "type":"choice", "needsDecision":true,
  "background":"一句话本质类比 + 现状：这东西是谁做的、现在什么状态、为什么突然要处置它",
  "why":"为什么需要人来定、为什么是现在。含四维自评：有无标准答案/置信度/重要性/**可回退性**",
  "options":[{ "id":"a","label":"动词+名词（禁 Yes/No/确定/取消）",
               "pros":["选了会发生什么好事"], "cons":["代价/风险/不可逆之处"] }],
  "recommendation":"a", "recommendReason":"为什么推荐它"
}
```
- **选项讲后果，不讲机制**。✗"两套并存会互相合并冲突" ✓ cons:["会互相制造合并冲突、你要看两套待批准队列"]
- **术语首次出现必须一句话解释**"这是什么、跟我有什么关系、不办会怎样"，否则用户回"没听懂"。同一概念全程同名。
- **一块一问**：别把三个问题塞进一个 freetext。
- **多条目清单（checklist）每一条同样要自带充分上下文**（2026-09-02 创始人反馈：「B21 给我的信息太少了，我不知道你指哪些环节。之后上决策台的内容要给出足够的上下文，否则没法决策」）：决策者只有屏幕上这些字——条目里的编号/代号必须当场展开成"这是什么、选项差在哪、不答会怎样"；一行 label 装不下就拆成独立 choice/verdict 块。**禁止要求决策者回忆旧对话或翻别的文档**。
- **面向决策者一律大白话**（2026-09-02 创始人补充）：卡片正文与选项文案不用行话；专业术语、项目代号、编号体系首次出现就地给一句话解释（括号内或背景区）。衡量标准＝**一个没跟过这个项目的人能看懂要在什么之间做选择**。大段材料进 background 折叠区，不塞进 label。
- **确认场景用 `verdict`，别用 `editable`**（实测 editable 连续两轮无人应答；改 verdict 后当轮通过）。
- **体验类决策（布局/交互/视觉）必须配可视化原型**（2026-07-23 创始人拍板为跨项目默认；⚠️ 2026-09-03 再犯病例：TMS round 2 的「概览指标合并」「默认语言」两块体验类决策只给了文字选项，创始人反馈「能不能直接展示两种不同设计的 UI 高保真？不然真的很难想象出来」——**写体验类 choice 前自查：每个选项有没有配图/线框/截图？没有就先做原型再 present**）：每个候选方案给 `prototype` 低保真线框或图片，推荐方案再给高保真（HTML mockup 截图 / iframe，手机场景 `frame:"phone"`）；图上开放批注、表态走相邻 verdict/choice。**严禁 ASCII/框线字符画**（"你已经是在 html 里了"，比例字体下必散架，lint `ascii-art` 会警告）；流程示意用 mermaid diagram 块。
- **默认给每个块打 `section` 类目**（需求/架构/UI 设计/交互设计/测试/风险，2026-07-23 创始人反馈"工作台本来有 tab 分类"后固化为默认）：带了 section 页面顶部才会出分面 tab 导航与未答角标；单一主题的短会话可省，超过 4 个块或跨类目时必打。
- 技术/配置/YAML 块加 `"audience":"tech"` → 自动折叠进「🔧 技术细节」，不占决策者注意力。
- 嵌**真实运行系统**必须加 `"live":true` → 红框 + 「⚡实时系统」角标（**文案救不了 affordance**：写了"真实产物"用户仍当样例）。
- 高保真原型：`prototype` + `mode:"iframe"` + `"frame":"phone"` → 360×740 手机壳呈现。

完整规范与病例：`<WB>/docs/authoring-guide.md` · `<WB>/docs/feedback-examples-2026-07-13.md`

## feedback 形状（wait 返回的）

```jsonc
{ "session","round","items":[
    {"blockId":"b-x","type":"select|verdict|comment|edit","value":..., "comment":"..."} ],
  "summary":"", "unanswered":["b-y"] }   // unanswered = 需决策但用户没动的块
```

## 模板（可选，省去手搓 blocks）

```bash
node --input-type=module -e '
import td from "'"$WB"'/templates/think-discuss.mjs";
const blocks = td({ title:"X", thoughtMd:"# 思路\n...", 
  diagrams:[{key:"arch",title:"架构",mermaid:"graph LR;A-->B"}],
  decisions:[{key:"trigger",question:"选哪个?",options:[{id:"a",label:"A"},{id:"b",label:"B"}],recommend:"a",importance:"high"}] });
process.stdout.write(JSON.stringify({session:"ses1",round:1,title:"X",blocks}));
' > /tmp/content.json
```
- `think-discuss({title,thoughtMd,diagrams,decisions,doc})` —— 思考共创 / 审阅文档（doc 段可 editable 就地改写）
- `dev-review({prdItems,archDiagrams,archAssertions,archAlternatives,testScenarios,testCases})` —— 研发评审 / **PRD 审核**（条目逐条表态 + 架构图/断言 + 备选方案 + 测试场景/Gherkin 用例）
- `design-review({screens,checklist})` —— **UI/交互设计评审**：`screens[i]={key,title,mode:"wireframe"|"image"|"iframe",（wireframe→screen / image→imageUrl / iframe→src）,verdict?,choice?}`；末尾可挂 completeness `checklist`。看原型/截图并就地圈点、选方案时用。

## 模式②（可选）：全自动 web 驱动

`node "$WB/bin/workbench.mjs" up --port 8099` 起 serve + 常驻 listener；用户纯在网页交互，提交后 listener 用 `claude -p --resume` 自动驱动续跑（适合离开电脑/移动/无人值守）。这是给顾问/客户在线改动反馈、由云端 AI 自动续跑的核心模式。
> 说明（2026-08-30 王佳梁订正）：此前此处写「用订阅跑自动化触及消费者条款 §3.7、有封号先例」——**该说法有误，已删除**。订阅额度驱动的无人值守自动化是被允许的用法。

`WB_CLOUD_AI` 默认是关闭的；未设置或设为 `off` 时，反馈照常落盘，但 listener/inbox 不会自动认领。需要无人值守时，在相关服务环境中设 `WB_CLOUD_AI=on`；`WB_CLOUD_AI_AUTH=subscription`（默认）使用已登录的 Claude 订阅，设为 `apikey` 则从 api-vault 注入 Anthropic API key。完整启用、服务管理和验证步骤见 [05-上线与启用云端AI.md](../../docs/design/2026-08-30-架构重设计/05-上线与启用云端AI.md)。

## 万一卡住了怎么办

工作台有几个地方容易出岔子，但都有同一条退路：
**用户的批注永远存在磁盘上，直接读就行，不用等任何东西——**
`<WB>/workspace/<session>/round-<N>/feedback.json`

所以记住一句话：**只要用户说"提交了"，就去读这个文件，别卡在别的步骤上。**

几个我们真踩过的坑：
- **server 会莫名挂掉**（页面突然打不开）。别用 present 自动起的那个，自己起一个不会被杀的：
  `(nohup node "$WB/bin/workbench.mjs" serve --port 8099 >/tmp/wb.log 2>&1 & disown)`
- **后台 wait 有时没起来或超时**，你就收不到"已提交"的通知。没关系，读上面那个文件就有批注。
- **embed 只能放网址、不能放本地文件路径**。本地 HTML 先起个静态服务（同样方式：
  `(nohup python3 -m http.server 8200 --bind 127.0.0.1 --directory <目录> >/tmp/st.log 2>&1 & disown)`），
  再把 `http://127.0.0.1:8200/xxx.html` 放进 embed。
- **mermaid 图显示"Syntax error in text"炸弹 ≠ 语法错误**（2026-08-13 已修，见 DESIGN §6.5）。mermaid 把渲染期错误也标成"Syntax error"，历史病根是就地渲染在隐藏 tab 的零尺寸容器里崩掉 + vendor 脚本加载竞态。现在渲染端已改为脱离容器渲染 + 失败时展示真实错误和图源码。若复发：先在浏览器控制台跑 `mermaid.parse(源码)`——parse 能过就是渲染环境问题，去查 `data-wb-mermaid` 属性和容器可见性，别改图源码；作者侧无需为此规避 `<br/>`、子图、边标签或 tab 分面。
- **修了 bug 用户却说"还是坏的"→ 先看用户页面上的版本号/表现是不是旧代码**（DESIGN §6.6/§6.7）。已有三层防护：①版本握手（页面每 3s 比对 assetsVersion，变了自动整页刷新）②HTML 服务端注入版本+import map，所有 JS/CSS 带 ?v= 加载（击穿 headerless 时代的启发式历史缓存——那类缓存不询问服务器，响应头清不掉，只有改 URL 能绕开）③Clear-Site-Data 清本源缓存。若仍复发：查用户资源请求里有没有不带 ?v= 的（`performance.getEntriesByType('resource')`），以及是否还开着 2026-08-13 之前的僵尸标签页（关掉即可）。改了 `src/render/` 或 `src/server/` 记得重启 serve 进程（server.mjs 是常驻进程，不会热加载）。
  **通用教训：客户端修复的第一问是"它怎么到达用户"**——这是「运行面验证」原则的 Web 形态：测试证明的是仓库里那份代码，用户跑的那份要单独验（浏览器加载的资源版本、常驻进程是否重启）。远端部署的工作台同理：rsync 只覆盖 `src/`，`scripts/` 下的外围件与 env/服务配置要单独同步再重启。

## 备注
- **想在用户/客户提交时收到即时通知**（不用一直守着）：给 server 设 `WORKBENCH_EVENT_WEBHOOK=<接收端点>`，反馈提交 / 用户留言 / 新轮发布三类事件会 POST 出去（AI 自己发的消息不会触发，不会自我提醒）。开箱即用的飞书中继见 `$WB/integrations/notify-relay/`（含事件格式、部署与 e2e 验证）。
- 默认端口 8099；`present` 会自动确保 server 在跑（不在则后台拉起）。
- 完整设计/协议/容错细节见 `$WB/docs/DESIGN.md`。
- 跨项目可用：在任何项目目录里 shell 调用 `$WB/bin/workbench.mjs` 即可，你自己的上下文不受影响。
