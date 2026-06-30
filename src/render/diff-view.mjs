// diff 视图辅助渲染。纯函数，无 DOM 依赖。
// changeBadge: block → 徽章 HTML（new/changed/unchanged）
// prevCompareHtml: changed 时字段级对照折叠
// diffToggleHtml: 「只看变更」开关

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 形状图标 + 文字双重语义（§13 P2 可访问性）
export function changeBadge(block) {
  const c = block._change;
  if (c === 'new') {
    return `<span class="badge badge-new" aria-label="新增">＋NEW</span>`;
  }
  if (c === 'changed') {
    return `<span class="badge badge-changed" aria-label="有改动">～CHANGED</span>`;
  }
  // unchanged → 空字符串
  return '';
}

// 字段级对照折叠（仅 changed 块有意义）
export function prevCompareHtml(block) {
  if (block._change !== 'changed' || !block._prev) return '';
  const fields = block._changedFields ?? Object.keys(block._prev);
  const rows = fields.map((f) => {
    const oldVal = block._prev[f] ?? '';
    return `<tr><th class="field-name">${escHtml(f)}</th><td class="field-old">${escHtml(String(oldVal))}</td></tr>`;
  }).join('');
  return `<details class="prev-compare">
  <summary>看上轮对照</summary>
  <table class="prev-table"><thead><tr><th>字段</th><th>上轮内容</th></tr></thead><tbody>${rows}</tbody></table>
</details>`;
}

// 「只看变更」开关 —— DOM 事件由 app.mjs 绑定
export function diffToggleHtml() {
  return `<label class="diff-toggle">
  <input type="checkbox" id="diff-only-changed" role="switch" aria-label="只看变更">
  <span>只看变更</span>
</label>`;
}
