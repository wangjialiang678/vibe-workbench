// 极简 markdown → HTML 转换器。浏览器安全，无 node 依赖，纯函数。
// 支持：# ## 标题、**粗体**、`代码`、```围栏代码块、- 列表、链接、图片、段落/换行。
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
