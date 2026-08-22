export default {
  type: 'embed', hashFields: [],
  validate(block) { return (!block.url || typeof block.url !== 'string') ? ['embed requires non-empty url string'] : []; },
  render(block, { escHtml }) {
    const id = escHtml(block.id ?? '');
    const url = block.url ?? '';
    const escapedUrl = escHtml(url);
    const encodedUrl = encodeURIComponent(url);
    const height = block.height || 620;
    // 同源相对路径直连（app.mjs 会自动补 token），仅外站绝对 URL 走 /api/proxy——
    // 与 prototype iframe 模式同规则。2026-08-14 客户门户实测：相对路径进 proxy 会被
    // ^https?:// 校验 400 拒绝，embed 全挂（发现于 sirui round1 独立验证）。
    const iframeSrc = url.startsWith('/') ? escapedUrl : `/api/proxy?url=${encodedUrl}`;
    return `<div class="embed-wrap" data-block-id="${id}">
  <div class="embed-toolbar">
    <span class="embed-src">🔗 ${escapedUrl}</span>
    <span class="embed-hint">选中页面里的文字即可评论（飞书式）</span>
    <span class="embed-pin-count" data-embed-count="${id}">0 条批注</span>
  </div>
  <div class="embed-body">
    <div class="embed-frame" style="height:${height}px"><iframe class="embed-iframe" data-embed-iframe="${id}" src="${iframeSrc}" style="width:100%;height:100%;border:0"></iframe></div>
    <aside class="embed-rail" data-embed-rail="${id}">
      <div class="rail-head"><span>批注</span><button class="rail-add" data-embed-add="${id}" type="button">+ 新增批注</button></div>
      <div class="rail-list" data-embed-rail-list="${id}"><div class="rail-empty">选中页面里的文字，点浮出的「💬 评论」添加；也可点「+ 新增批注」写整体意见。</div></div>
    </aside>
  </div>
</div>`;
  },
};
