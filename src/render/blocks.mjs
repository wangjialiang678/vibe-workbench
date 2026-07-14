// 渲染器：block → HTML 字符串。纯函数，零浏览器依赖，可 node 单测。
// 外层 <section data-block-id data-type data-change>，含「+批注」入口。
// 形状图标(◆/◇/＋/～)承载语义，不靠颜色单独传达（§13 P2 可访问性）。
import { mdToHtml } from './md.mjs';
import { changeBadge } from './diff-view.mjs';

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleHtml(block) {
  if (!block.title) return '';
  return `<h3 class="block-title">${escHtml(block.title)}</h3>`;
}

function commentEntry(blockId) {
  const id = escHtml(blockId);
  // 内联批注（飞书式三态：无→编辑→读）：点按钮就地展开，保存后显示读态，支持编辑/删除
  return `<div class="comment-area" data-comment-area="${id}">
  <button class="comment-btn" data-block-id="${id}" aria-expanded="false" aria-label="添加批注">+批注</button>
  <div class="comment-box" data-comment-box="${id}" hidden>
    <div class="comment-edit" data-comment-edit="${id}">
      <textarea class="comment-input" data-comment-for="${id}" rows="2" placeholder="写下你的批注…"></textarea>
      <div class="comment-actions">
        <button class="comment-save" data-comment-save="${id}" type="button">保存</button>
        <button class="comment-delete" data-comment-del="${id}" type="button">删除</button>
      </div>
    </div>
    <div class="comment-read" data-comment-read="${id}" hidden>
      <div class="comment-read-text" data-comment-text="${id}"></div>
      <div class="comment-actions">
        <button class="comment-edit-btn" data-comment-edit-btn="${id}" type="button">编辑</button>
        <button class="comment-delete" data-comment-del="${id}" type="button">删除</button>
      </div>
    </div>
  </div>
</div>`;
}

// ---------- 各 type 内容渲染 ----------

function renderMarkdown(block) {
  return mdToHtml(block.body ?? '');
}

function renderDiagram(block) {
  // body 里已是用户提供字符串，需转义后放 <pre>
  const escaped = escHtml(block.body ?? '');
  const rationalePart = block.rationale
    ? `<details class="diagram-rationale"><summary>设计依据</summary><div>${mdToHtml(block.rationale)}</div></details>`
    : '';
  return `<pre class="mermaid">${escaped}</pre>${rationalePart}`;
}

// 选项利弊（决策块结构化 · iteration-brief P1）：把"后果"讲清，替代把一切塞进 desc
function prosConsHtml(opt) {
  const pros = Array.isArray(opt.pros) ? opt.pros : [];
  const cons = Array.isArray(opt.cons) ? opt.cons : [];
  if (pros.length === 0 && cons.length === 0) return '';
  const items = (arr, cls) => arr.map((t) => `<li class="${cls}">${escHtml(t)}</li>`).join('');
  return `<div class="opt-proscons">
${pros.length ? `<ul class="opt-pros" aria-label="好处">${items(pros, 'pro')}</ul>` : ''}
${cons.length ? `<ul class="opt-cons" aria-label="代价 / 风险">${items(cons, 'con')}</ul>` : ''}
</div>`;
}

function renderChoice(block) {
  const options = block.options ?? [];
  const rec = block.recommendation;
  const multi = block.multi ?? false;
  const inputType = multi ? 'checkbox' : 'radio';
  const name = `choice-${escHtml(block.id)}`;

  const optionsHtml = options.map((opt) => {
    const isRec = opt.id === rec;
    const recAttr = isRec ? ' data-recommended="true"' : '';
    const recLabel = isRec ? ' <span class="rec-label">推荐</span>' : '';
    const desc = opt.desc ? `<span class="opt-desc">${escHtml(opt.desc)}</span>` : '';
    // 利弊放在 label 之外：避免点击利弊条目误触发选中
    return `<div class="choice-item">
<label class="choice-option${isRec ? ' choice-recommended' : ''}"${recAttr}>
  <input type="${inputType}" name="${name}" value="${escHtml(opt.id)}"${isRec ? ' data-default-check' : ''}>
  <span class="opt-label">${escHtml(opt.label)}${recLabel}</span>${desc}
</label>
${prosConsHtml(opt)}
</div>`;
  }).join('\n');

  return `<div class="choice-group" role="group">${optionsHtml}</div>`;
}

function renderVerdict(block) {
  const bId = escHtml(block.id);
  return `<div class="verdict-group" role="group" aria-label="表态">
  <button class="verdict-btn" data-verdict="赞成" data-block-id="${bId}" aria-label="赞成">✓赞成</button>
  <button class="verdict-btn" data-verdict="异议" data-block-id="${bId}" aria-label="异议">✗异议</button>
  <button class="verdict-btn" data-verdict="疑问" data-block-id="${bId}" aria-label="疑问">?疑问</button>
</div>
<div class="verdict-comment" hidden>
  <textarea class="verdict-reason" placeholder="请说明理由（推荐填写）" data-block-id="${bId}" rows="2"></textarea>
</div>`;
}

function renderFreetext(block) {
  const ph = escHtml(block.placeholder ?? '请输入');
  return `<textarea class="freetext-input" placeholder="${ph}" data-block-id="${escHtml(block.id)}" rows="4"></textarea>`;
}

function renderEditable(block) {
  const val = escHtml(block.value ?? block.body ?? '');
  const bId = escHtml(block.id);
  // 「保持原样即确认」一键（iteration-brief P2 · 病例 5）：
  // editable 的默认动作语义是"改写"，对只想说"行"的用户是高成本操作 → 给一条零摩擦通路。
  return `<textarea class="editable-input" data-editable data-block-id="${bId}" rows="6">${val}</textarea>
<div class="editable-actions">
  <button class="editable-confirm" data-editable-confirm="${bId}" type="button">✓ 保持原样即确认</button>
  <span class="edit-status" hidden>已编辑·未提交</span>
  <span class="editable-confirmed" data-editable-confirmed="${bId}" hidden>✓ 已确认保持原样</span>
</div>`;
}

function renderTable(block) {
  const cols = block.columns ?? [];
  const rows = block.rows ?? [];
  const thead = cols.length
    ? `<thead><tr>${cols.map((c) => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>`
    : '';
  const tbody = rows.length
    ? `<tbody>${rows.map((r) => `<tr>${(r ?? []).map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<table class="block-table">${thead}${tbody}</table>`;
}

function renderCode(block) {
  const lang = escHtml(block.lang ?? '');
  const body = escHtml(block.body ?? '');
  return `<pre class="code-block"><code class="lang-${lang}">${body}</code></pre>`;
}

export function renderEmbed(block) {
  const id = escHtml(block.id ?? '');
  const url = block.url ?? '';
  const escapedUrl = escHtml(url);
  const encodedUrl = encodeURIComponent(url);
  const height = block.height || 620;

  return `<div class="embed-wrap" data-block-id="${id}">
  <div class="embed-toolbar">
    <span class="embed-src">🔗 ${escapedUrl}</span>
    <span class="embed-hint">选中页面里的文字即可评论（飞书式）</span>
    <span class="embed-pin-count" data-embed-count="${id}">0 条批注</span>
  </div>
  <div class="embed-body">
    <div class="embed-frame" style="height:${height}px"><iframe class="embed-iframe" data-embed-iframe="${id}" src="/api/proxy?url=${encodedUrl}" style="width:100%;height:100%;border:0"></iframe></div>
    <aside class="embed-rail" data-embed-rail="${id}">
      <div class="rail-head"><span>批注</span><button class="rail-add" data-embed-add="${id}" type="button">+ 新增批注</button></div>
      <div class="rail-list" data-embed-rail-list="${id}"><div class="rail-empty">选中页面里的文字，点浮出的「💬 评论」添加；也可点「+ 新增批注」写整体意见。</div></div>
    </aside>
  </div>
</div>`;
}

// ---------- checklist block ----------

export function renderChecklist(block) {
  const bId = escHtml(block.id ?? '');
  const items = block.items ?? [];
  const labels = block.verdictLabels ?? ['赞成', '异议', '疑问'];

  const itemsHtml = items.map((item) => {
    const itemId = escHtml(item.id ?? '');
    const itemLabel = escHtml(item.label ?? '');
    const itemBody = item.body ? `<div class="checklist-item-body">${escHtml(item.body)}</div>` : '';

    const btnsHtml = labels.map((lbl) => {
      const lblEsc = escHtml(lbl);
      return `<button class="checklist-verdict-btn"
  data-block-id="${bId}"
  data-item-id="${itemId}"
  data-label="${lblEsc}"
  type="button"
  aria-label="${lblEsc}">${lblEsc}</button>`;
    }).join('');

    return `<div class="checklist-item" data-checklist-item="${itemId}">
  <div class="checklist-item-header">
    <span class="checklist-item-label">${itemLabel}</span>
    <div class="checklist-verdict-group" role="group" aria-label="${itemLabel} 表态">${btnsHtml}</div>
  </div>
  ${itemBody}
</div>`;
  }).join('\n');

  return `<div class="checklist-group" data-checklist="${bId}">${itemsHtml}</div>`;
}

// ---------- prototype block（自研零依赖 SVG pin 定位批注 + 线框编辑模式）----------

// 模式工具条（仅 wireframe）：批注 / 编辑（移动控件）——复刻 prd-studio 的 protoModes
function protoModesBar(bId) {
  return `<div class="proto-modes" data-proto-modes="${bId}">
  <button type="button" class="proto-mode-btn active" data-proto-mode="annotate">🖊 批注</button>
  <button type="button" class="proto-mode-btn" data-proto-mode="edit">✥ 编辑（移动控件）</button>
  <button type="button" class="proto-reset" data-proto-reset="${bId}" hidden>↺ 复位</button>
  <span class="proto-mode-hint" data-proto-hint="${bId}">点图上任意处落 pin 批注</span>
</div>`;
}

export function renderPrototype(block) {
  const bId = escHtml(block.id ?? '');
  const mode = block.mode ?? 'image';

  // SVG overlay：pin 点击落点，data-* 携带 blockId 和百分比坐标
  // 点击 overlay 的空白区域落新 pin；点击已有 pin 展开内联评论
  const svgOverlay = `<svg class="proto-overlay" data-proto-overlay="${bId}" xmlns="http://www.w3.org/2000/svg"
  style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:all;overflow:visible">
  <g class="proto-pins" data-proto-pins="${bId}"></g>
</svg>`;

  let innerHtml = '';
  if (mode === 'wireframe') {
    const screen = block.screen ?? { id: 'screen', name: '原型', widgets: [] };
    const screenName = escHtml(screen.name ?? '');
    const widgets = screen.widgets ?? [];
    const widgetsHtml = widgets.map((w, i) => {
      const wid = escHtml(w.id ?? `w${i}`);
      const x = (w.x ?? 0) * 100;
      const y = (w.y ?? 0) * 100;
      const ww = (w.w ?? 0.1) * 100;
      const wh = (w.h ?? 0.05) * 100;
      const cls = escHtml(w.cls ?? 'rect');
      const text = escHtml(w.text ?? '');
      // data-widget-id + 右下角缩放柄 → 支撑「编辑」模式（拖动/缩放控件，复刻 prd-studio）
      return `<div class="proto-widget proto-widget-${cls}" data-proto-widget="${bId}" data-widget-id="${wid}"
  style="left:${x}%;top:${y}%;width:${ww}%;height:${wh}%" title="${text}"><span class="pw-text">${text}</span><span class="pw-resize" data-proto-resize aria-hidden="true"></span></div>`;
    }).join('');

    const isPhone = block.frame === 'phone';
    const body = `<div class="proto-widgets">${widgetsHtml}</div>
  ${svgOverlay}`;

    const canvas = isPhone
      ? `<div class="proto-wireframe-canvas proto-phone" data-proto-canvas="${bId}" data-mode="annotate">
  <div class="proto-notch" aria-hidden="true"></div>
  ${body}
</div>`
      : `<div class="proto-wireframe-canvas" data-proto-canvas="${bId}" data-mode="annotate"
  style="position:relative;width:100%;padding-bottom:75%;background:#fff;border:1px solid var(--color-border);overflow:hidden">
  ${body}
  <div class="proto-screen-label">${screenName}</div>
</div>`;

    innerHtml = `${protoModesBar(bId)}\n${canvas}`;
  } else if (mode === 'iframe') {
    const raw = block.src ?? '';
    const src = escHtml(raw);
    const height = block.height || 620;
    // 同源相对路径（如工作台自托管的 /assets/<session>/ui/x.html）直接用，无需绕代理；
    // 外站绝对 URL 仍走 /api/proxy（绕过 X-Frame-Options）。
    const isAbsolute = /^https?:\/\//i.test(raw);
    const iframeSrc = isAbsolute ? `/api/proxy?url=${encodeURIComponent(raw)}` : src;
    // frame:'phone' → 360×740 手机壳呈现（对齐 prd-studio 的高保真观感）
    const isPhone = block.frame === 'phone';
    const wrapCls = isPhone ? 'proto-iframe-wrap proto-phone' : 'proto-iframe-wrap';
    const wrapStyle = isPhone ? '' : ` style="position:relative;height:${height}px"`;
    innerHtml = `<div class="${wrapCls}"${wrapStyle}>
  <iframe class="proto-iframe" src="${iframeSrc}"
    style="width:100%;height:100%;border:0" title="${src}"></iframe>
  ${svgOverlay}
</div>`;
  } else {
    // mode === 'image'
    const imgUrl = escHtml(block.imageUrl ?? '');
    innerHtml = `<div class="proto-image-wrap" style="position:relative;display:inline-block;max-width:100%">
  <img class="proto-image" src="${imgUrl}" alt="${escHtml(block.title ?? '原型截图')}"
    style="display:block;max-width:100%;height:auto">
  ${svgOverlay}
</div>`;
  }

  const hint = `<div class="proto-hint" style="font-size:12px;color:var(--color-text-muted);margin-top:4px">点击图上任意位置落 pin 批注；点已有 pin 编辑或删除</div>`;
  return `<div class="proto-container" data-proto="${bId}">${innerHtml}${hint}</div>`;
}

// ---------- 按 type 分派 ----------

function renderContent(block) {
  switch (block.type) {
    case 'markdown':   return renderMarkdown(block);
    case 'diagram':    return renderDiagram(block);
    case 'choice':     return renderChoice(block);
    case 'verdict':    return renderVerdict(block);
    case 'freetext':   return renderFreetext(block);
    case 'editable':   return renderEditable(block);
    case 'table':      return renderTable(block);
    case 'code':       return renderCode(block);
    case 'embed':      return renderEmbed(block);
    case 'checklist':  return renderChecklist(block);
    case 'prototype':  return renderPrototype(block);
    default:           return `<p class="unknown-type">未知 block 类型：${escHtml(block.type)}</p>`;
  }
}

// body 上屏（§5.0）：markdown/diagram/code 已把 body 当主内容，其余类型若有 body 则在 title 后额外渲染。
const BODY_AS_CONTENT_TYPES = new Set(['markdown', 'diagram', 'code']);

function bodyHtml(block) {
  if (BODY_AS_CONTENT_TYPES.has(block.type)) return ''; // 这三类已在 renderContent 里用 body
  if (!block.body) return '';
  return `<div class="block-body">${mdToHtml(block.body)}</div>`;
}

// 决策块结构化（iteration-brief P1 · 创始人加权最高优先级）
// 固定次序：背景 → 为什么需要你定 → 选项(含利弊) → 推荐及理由。缺失字段不渲染（向后兼容）。
// 病例依据：用户在零背景的决策块上"盲选"，产出伪决策（feedback-examples 案例 1/3）。
function decisionContextHtml(block) {
  const parts = [];
  if (block.background) {
    parts.push(`<section class="decision-seg decision-bg">
  <h4 class="decision-h">背景</h4>
  <div class="decision-text">${mdToHtml(block.background)}</div>
</section>`);
  }
  if (block.why) {
    parts.push(`<section class="decision-seg decision-why">
  <h4 class="decision-h">为什么需要你定</h4>
  <div class="decision-text">${mdToHtml(block.why)}</div>
</section>`);
  }
  return parts.length ? `<div class="decision-context">${parts.join('\n')}</div>` : '';
}

function recommendReasonHtml(block) {
  if (!block.recommendReason) return '';
  return `<section class="decision-seg decision-rec">
  <h4 class="decision-h">推荐及理由</h4>
  <div class="decision-text">${mdToHtml(block.recommendReason)}</div>
</section>`;
}

// 主导出：block → HTML 字符串
export function blockHtml(block) {
  const id = escHtml(block.id ?? '');
  const type = escHtml(block.type ?? '');
  const change = escHtml(block._change ?? 'unchanged');
  const badge = changeBadge(block);
  const content = renderContent(block);
  // 受众分层（P2）：audience:'tech' → 整块折叠进「技术细节」，不占决策者注意力（病例 2）
  const isTech = block.audience === 'tech';
  const liveAttr = block.live ? ' data-live="true"' : '';
  const liveBadge = block.live
    ? '<div class="live-badge" title="这是真实运行中的系统，你在里面的操作会真实生效">⚡ 实时系统 · 就地操作会真实生效</div>'
    : '';

  const inner = `${badge ? `<div class="change-badge">${badge}</div>` : ''}
${titleHtml(block)}
${liveBadge}
${bodyHtml(block)}
${decisionContextHtml(block)}
<div class="block-content">${content}</div>
${recommendReasonHtml(block)}
${commentEntry(block.id ?? '')}`;

  if (isTech) {
    return `<section data-block-id="${id}" data-type="${type}" data-change="${change}" data-audience="tech"${liveAttr} class="block block-${type} block-tech">
<details class="tech-fold">
  <summary class="tech-summary">🔧 技术细节${block.title ? `：${escHtml(block.title)}` : ''}（决策者可跳过·点开查看）</summary>
  ${inner}
</details>
</section>`;
  }

  return `<section data-block-id="${id}" data-type="${type}" data-change="${change}"${liveAttr} class="block block-${type}">
${inner}
</section>`;
}
