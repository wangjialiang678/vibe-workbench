// 极简 markdown → HTML 转换器。浏览器安全，无 node 依赖，纯函数。
// 支持：# ## 标题、**粗体**、`代码`、```围栏代码块、- 列表、GFM 表格、链接、图片、段落/换行。
// 先转义 < > &，再处理 md 语法，保证 XSS 安全。

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeInlineUrl(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:https?:\/\/|\/)/i.test(raw)) return '#';
  return raw.replace(/"/g, '&quot;');
}

// 行内转换（图片、粗体、代码、链接）—— 在已转义的文本上操作
function inlineConvert(escaped) {
  return escaped
    // 图片 ![alt](url) —— 必须先于普通链接处理
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_all, alt, url) => (
      `<img class="md-image" src="${safeInlineUrl(url)}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy">`
    ))
    // 链接 [text](url)  —— 先处理（含方括号，避免和粗体冲突）
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_all, text, url) => `<a href="${safeInlineUrl(url)}">${text}</a>`)
    // 粗体 **text**
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 行内代码 `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function hasTablePipe(value) {
  let inCode = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '\\' && value[i + 1] === '|') {
      i += 1;
      continue;
    }
    if (char === '`') inCode = !inCode;
    else if (char === '|' && !inCode) return true;
  }
  return false;
}

function splitTableRow(value) {
  let row = String(value ?? '').trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);

  const cells = [];
  let cell = '';
  let inCode = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (char === '\\' && row[i + 1] === '|') {
      cell += '|';
      i += 1;
      continue;
    }
    if (char === '`') {
      inCode = !inCode;
      cell += char;
      continue;
    }
    if (char === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlignment(delimiter) {
  const value = delimiter.trim();
  if (!/^:?-{3,}:?$/.test(value)) return undefined;
  if (value.startsWith(':') && value.endsWith(':')) return 'center';
  if (value.endsWith(':')) return 'right';
  if (value.startsWith(':')) return 'left';
  return '';
}

function tableCellHtml(tag, value, alignment) {
  const className = alignment ? ` class="md-align-${alignment}"` : '';
  return `<${tag}${className}>${inlineConvert(escapeHtml(value))}</${tag}>`;
}

function tableAt(lines, start) {
  if (start + 1 >= lines.length || !hasTablePipe(lines[start])) return null;

  const headers = splitTableRow(lines[start]);
  const delimiters = splitTableRow(lines[start + 1]);
  if (!headers.length || headers.length !== delimiters.length) return null;

  const alignments = delimiters.map(tableAlignment);
  if (alignments.some((alignment) => alignment === undefined)) return null;

  const rows = [];
  let end = start + 2;
  while (end < lines.length && lines[end].trim() !== '' && hasTablePipe(lines[end])) {
    const cells = splitTableRow(lines[end]).slice(0, headers.length);
    while (cells.length < headers.length) cells.push('');
    rows.push(cells);
    end += 1;
  }

  const thead = `<thead><tr>${headers.map((cell, index) => tableCellHtml('th', cell, alignments[index])).join('')}</tr></thead>`;
  const tbody = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${row.map((cell, index) => tableCellHtml('td', cell, alignments[index])).join('')}</tr>`).join('')}</tbody>`
    : '';

  return {
    end,
    html: `<div class="md-table-scroll" role="region" aria-label="Markdown 表格" tabindex="0"><table class="md-table">${thead}${tbody}</table></div>`,
  };
}

export function mdToHtml(src) {
  if (!src) return '';
  const lines = src.split('\n');
  const out = [];
  let inList = false;
  let inFence = false;
  let fenceBuf = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const esc = escapeHtml(raw);

    // 围栏代码块 ```：整块原样等宽展示，不做任何行内转换
    if (/^```/.test(raw.trim())) {
      if (!inFence) {
        if (inList) { out.push('</ul>'); inList = false; }
        inFence = true;
        fenceBuf = [];
      } else {
        out.push(`<pre class="md-fence"><code>${fenceBuf.join('\n')}</code></pre>`);
        inFence = false;
      }
      continue;
    }
    if (inFence) { fenceBuf.push(esc); continue; }

    // GFM 表格：Markdown 仍是源数据，HTML 只负责语义化与响应式展示。
    const table = tableAt(lines, i);
    if (table) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(table.html);
      i = table.end - 1;
      continue;
    }

    // 标题
    const h2 = esc.match(/^## (.+)/);
    if (h2) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${inlineConvert(h2[1])}</h2>`);
      continue;
    }
    const h1 = esc.match(/^# (.+)/);
    if (h1) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h1>${inlineConvert(h1[1])}</h1>`);
      continue;
    }

    // 列表项
    const li = esc.match(/^- (.+)/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineConvert(li[1])}</li>`);
      continue;
    }

    // 空行 → 关闭列表或段落分隔
    if (esc.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      continue;
    }

    // 普通段落
    if (inList) { out.push('</ul>'); inList = false; }
    out.push(`<p>${inlineConvert(esc)}</p>`);
  }

  if (inFence && fenceBuf.length) {
    // 未闭合的围栏：按已开的代码块兜底输出，内容绝不丢失
    out.push(`<pre class="md-fence"><code>${fenceBuf.join('\n')}</code></pre>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
