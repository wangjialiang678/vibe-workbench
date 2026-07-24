# Vibe Workbench 使用协议（给 AI 读）

> 这份文档是**唯一权威协议**，与具体 AI 工具无关。Claude Code、Codex、WorkBuddy 装的都是同一套内容，只是注入方式不同（见 `integrations/README.md`）。

你（AI）在跟人协作时，把"在聊天里堆 markdown 等对方打字回复"换成"渲染成可交互网页、人点选/批注、提交即唤醒你续跑"。

以下 `$WB` 指工作台仓库根目录。

## 何时用 / 不用

**用**：需要对方做选择、逐条表态、确认方案、评审 PRD/架构/测试、评审 UI/交互原型、共创或讨论文档 —— 任何"需要结构化输入"的场景。

**不用**：纯闲聊、单句问答、无需对方输入的普通输出。

| 你要做 | 模板 | 主力 block |
|---|---|---|
| 开发项目 / PRD 审核 | `dev-review` | verdict(逐条表态) + diagram(架构) + code(Gherkin 用例) |
| UI / 交互设计评审 | `design-review` | prototype(线框/截图/高保真，SVG 定位批注) + verdict/choice + checklist |
| 审阅 / 共创文档 · brainstorm | `think-discuss` | markdown + editable(就地改写) + verdict + 批注 |

## 一句话流程

`present 渲染一轮 → 把 URL 发给对方 → 等待 → 对方提交即唤醒你 → 读 feedback 续跑`

```bash
# 1) 组织 content（协议见下），写到临时文件（用写文件工具，避免 shell 转义换行的坑）

# 2) 一键渲染：确保 server 在跑 + 写这一轮 + 返回 URL
node "$WB/bin/workbench.mjs" present <session> /path/to/content.json
#    → {"ok":true,"session":"...","round":N,"url":"http://127.0.0.1:8099/render/?session=...", "urlPinned":"...&round=N"}
```

把 `url`（**不带 round**）发给对方——它跟随最新轮，你出新一轮时页面自动推进、无需换链接。仅当要对方回看某一固定轮时才用 `urlPinned`。

```bash
# 3) 等待提交（提交后打印 feedback JSON 并退出）
node "$WB/bin/workbench.mjs" wait <session> <round>
#    命中→ {"ok":true,"event":"feedback","feedback":{...}}   超时→ event:"timeout"
```

4) 收到反馈后据此续跑；需要下一轮就再 `present`（**同议题复用相同 block id**，diff 才准）。

> `present` 是同步的（立刻拿 URL）；`wait` 建议放后台，二者分开调用。

## content 协议速查

```jsonc
{ "session":"ses1", "round":1, "title":"本轮主题", "blocks":[ Block ... ] }
```

Block 通用字段 + 注意力元数据（决定呈现位置）：

```jsonc
{
  "id":"b-唯一稳定slug",       // 跨轮同议题必须复用同 id
  "type":"markdown",          // 见下
  "section":"架构",           // 可选：tab 分面类目（需求/架构/UI 设计/交互设计/测试/风险…）
  "title":"可选", "body":"...",
  "needsDecision": false,      // 是否要对方决策
  "hasRecommendation": false,  // 是否带推荐
  "recommendation": null,      // 推荐的 option id / 值
  "importance":"normal",       // high|normal|low
  "default": null              // 预设默认值（仅"已设默认"项给）
}
```

type 与字段：

- `markdown` body=md ｜ `diagram` lang:"mermaid",body=源 ｜ `choice` options:[{id,label,desc?}],multi?,recommendation ｜ `verdict`（✓赞成/✗异议/?疑问）｜ `freetext` ｜ `editable` value=md（就地可改）｜ `table` columns,rows ｜ `code` lang,body ｜ `embed` url,height?（**嵌真实网页产物，就地落点批注**）
- `prototype` mode:"wireframe"|"image"|"iframe" —— 线框/截图/高保真原型，SVG 定位批注（在图上点选落 pin 写意见）。wireframe→`screen:{id,name,widgets[]}` ｜ image→`imageUrl` ｜ iframe→`src`
- `checklist` items:[{id,label}], verdictLabels:[] —— 逐条三态清单

**呈现位置由元数据决定**（工作台的核心"注意力编排"）：

- `needsDecision:true` + 无推荐 → 顶部「需你定·无预设」（最先看）
- `needsDecision:true` + `hasRecommendation:true` → 「需你定·有推荐」（推荐项预选）
- `needsDecision:false` + 无 default → 可见的叙述/图表区（放你的思路、架构图）
- `needsDecision:false` + 有 default → 折叠「已设默认」（同意即跳过）

**tab 分面导航（可选）**：块带 `section` → 页面顶部出 tab 导航，上述四区在每个 tab 内部生效。每 tab 角标 = 未确认决策数。超过 4 个块或跨类目时建议打 section。

## ⚠️ 决策块必须写"人话"（否则对方会盲选 → 伪决策）

真实用户反馈：**"技术术语太多，描述不够详细，没有任何背景，需要让我了解决策的上下文、原因，以及不同决策的利弊。"**

没背景的决策块**不是"没人答"，而是产出零质量的伪决策**（对方照样点推荐项，你不敢采信，白费一轮）。`present` 会自动 lint 并 warn。

`needsDecision:true` 的块**必须**给齐（渲染为固定四段：背景 → 为什么需要你定 → 选项含利弊 → 推荐及理由）：

```jsonc
{
  "type":"choice", "needsDecision":true,
  "background":"一句话本质类比 + 现状：这东西是谁做的、现在什么状态、为什么突然要处置它",
  "why":"为什么需要人来定、为什么是现在。含四维自评：有无标准答案/置信度/重要性/可回退性",
  "options":[{ "id":"a","label":"动词+名词（禁 Yes/No/确定/取消）",
               "pros":["选了会发生什么好事"], "cons":["代价/风险/不可逆之处"] }],
  "recommendation":"a", "recommendReason":"为什么推荐它"
}
```

- **选项讲后果，不讲机制**。✗"两套并存会互相合并冲突" ✓ cons:["会互相制造合并冲突、你要看两套待批准队列"]
- **术语首次出现必须一句话解释**"这是什么、跟我有什么关系、不办会怎样"。同一概念全程同名。
- **一块一问**：别把三个问题塞进一个 freetext。
- **确认场景用 `verdict`，别用 `editable`**（实测 editable 连续两轮无人应答；改 verdict 后当轮通过）。
- **体验类决策（布局/交互/视觉）必须配可视化原型**：每个候选给 `prototype` 低保真线框或图片，推荐方案再给高保真（HTML mockup 截图 / iframe，手机场景 `frame:"phone"`）。**严禁 ASCII/框线字符画**（比例字体下必散架，lint `ascii-art` 会警告）；流程示意用 mermaid diagram 块。
- 技术/配置/YAML 块加 `"audience":"tech"` → 自动折叠进「🔧 技术细节」，不占决策者注意力。
- 嵌**真实运行系统**必须加 `"live":true` → 红框 + 「⚡实时系统」角标（**文案救不了 affordance**：写了"真实产物"用户仍会当样例）。

完整规范与病例：`$WB/docs/authoring-guide.md` · `$WB/docs/feedback-examples-2026-07-13.md`

## 在真实产物上批注（embed）

当你产出的是**一个真实网页 / 部署好的可视化产物**（而非纯文字），不要只在抽象 block 上让对方表态——放一个 `embed` block 指向它：

```jsonc
{ "id":"b-page", "type":"embed", "title":"详情页（真实产物）", "url":"https://你的产物.html", "height":620, "live":true }
```

工作台会经 `/api/proxy` 反代该页并同源嵌入。对方在页面上**选中文字**→浮出「💬 评论」→在右侧评论栏写评论。提交回来是 `{blockId,type:'pin',value:{quote},comment}`——你拿到"引用原文 + 意见"，据此改产物、再 present 下一轮（复用同 block id）。

> `embed` 只能放网址，不能放本地文件路径。本地 HTML 先起个静态服务再嵌。

## feedback 形状

```jsonc
{ "session","round","items":[
    {"blockId":"b-x","type":"select|verdict|comment|edit","value":..., "comment":"..."} ],
  "summary":"", "unanswered":["b-y"] }   // unanswered = 需决策但对方没动的块
```

## 模板（省去手搓 blocks）

- `think-discuss({title,thoughtMd,diagrams,decisions,doc})` —— 思考共创 / 审阅文档
- `dev-review({prdItems,archDiagrams,archAssertions,archAlternatives,testScenarios,testCases})` —— 研发评审 / PRD 审核
- `design-review({screens,checklist})` —— UI/交互设计评审

```bash
node --input-type=module -e '
import td from "'"$WB"'/templates/think-discuss.mjs";
const blocks = td({ title:"X", thoughtMd:"# 思路\n...",
  decisions:[{key:"trigger",question:"选哪个?",options:[{id:"a",label:"A"},{id:"b",label:"B"}],recommend:"a"}] });
process.stdout.write(JSON.stringify({session:"ses1",round:1,title:"X",blocks}));
' > /tmp/content.json
```

## 万一卡住了

**对方的批注永远存在磁盘上，直接读就行，不用等任何东西**：

```
$WB/workspace/<session>/round-<N>/feedback.json
```

**只要对方说"提交了"，就去读这个文件，别卡在别的步骤上。**

几个真踩过的坑：

- **server 会莫名挂掉**（页面突然打不开）。自己起一个不会被杀的：
  `(nohup node "$WB/bin/workbench.mjs" serve --port 8099 >/tmp/wb.log 2>&1 & disown)`
- **后台 wait 有时没起来或超时**，你就收不到"已提交"的通知。没关系，读上面那个文件。
- 默认端口 8099；`present` 会自动确保 server 在跑（不在则后台拉起）。

## 异步唤醒（可选，让提交自动叫醒你）

起 `node "$WB/bin/workbench.mjs" up --port 8099` 会同时跑 server 和 listener：对方提交后，listener 自动用你所在的 AI CLI 续跑，结果写回 `workspace/<session>/`，网页状态徽章变「已回复」。

用哪个 AI 由环境变量 `WORKBENCH_AGENT` 决定（`claude` | `workbuddy` | `codex`），不设则自动探测。详见 `integrations/README.md`。

> ⚠️ 用订阅跑长时间无人值守自动化可能触及各家服务条款，请自行确认。交互式协作（你在场、手动续跑）不受影响。
