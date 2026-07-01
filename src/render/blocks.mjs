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
    return `<label class="choice-option${isRec ? ' choice-recommended' : ''}"${recAttr}>
  <input type="${inputType}" name="${name}" value="${escHtml(opt.id)}"${isRec ? ' data-default-check' : ''}>
  <span class="opt-label">${escHtml(opt.label)}${recLabel}</span>${desc}
</label>`;
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
  return `<textarea class="editable-input" data-editable data-block-id="${bId}" rows="6">${val}</textarea>
<span class="edit-status" hidden>已编辑·未提交</span>`;
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

// ---------- 按 type 分派 ----------

function renderContent(block) {
  switch (block.type) {
    case 'markdown': return renderMarkdown(block);
    case 'diagram':  return renderDiagram(block);
    case 'choice':   return renderChoice(block);
    case 'verdict':  return renderVerdict(block);
    case 'freetext': return renderFreetext(block);
    case 'editable': return renderEditable(block);
    case 'table':    return renderTable(block);
    case 'code':     return renderCode(block);
    case 'embed':    return renderEmbed(block);
    default:         return `<p class="unknown-type">未知 block 类型：${escHtml(block.type)}</p>`;
  }
}

// 主导出：block → HTML 字符串
export function blockHtml(block) {
  const id = escHtml(block.id ?? '');
  const type = escHtml(block.type ?? '');
  const change = escHtml(block._change ?? 'unchanged');
  const badge = changeBadge(block);
  const content = renderContent(block);

  return `<section data-block-id="${id}" data-type="${type}" data-change="${change}" class="block block-${type}">
${badge ? `<div class="change-badge">${badge}</div>` : ''}
${titleHtml(block)}
<div class="block-content">${content}</div>
${commentEntry(block.id ?? '')}
</section>`;
}
