export default {
  type: 'prototype', hashFields: ['mode', 'src', 'imageUrl', 'screen'],
  validate(block) {
    const errors = [];
    const validModes = ['wireframe', 'iframe', 'image'];
    if (!validModes.includes(block.mode)) errors.push(`prototype.mode must be one of: ${validModes.join(', ')}`);
    if (block.mode === 'iframe' && (!block.src || typeof block.src !== 'string')) errors.push('prototype with mode=iframe requires non-empty src string');
    if (block.mode === 'image' && (!block.imageUrl || typeof block.imageUrl !== 'string')) errors.push('prototype with mode=image requires non-empty imageUrl string');
    if (block.mode === 'wireframe' && (!block.screen || typeof block.screen !== 'object')) errors.push('prototype with mode=wireframe requires screen object');
    return errors;
  },
  render(block, { escHtml }) {
    const blockId = escHtml(block.id ?? '');
    const mode = block.mode ?? 'image';
    const modesBar = () => `<div class="proto-modes" data-proto-modes="${blockId}">
  <button type="button" class="proto-mode-btn active" data-proto-mode="annotate">🖊 批注</button>
  <button type="button" class="proto-mode-btn" data-proto-mode="edit">✥ 编辑（移动控件）</button>
  <button type="button" class="proto-reset" data-proto-reset="${blockId}" hidden>↺ 复位</button>
  <span class="proto-mode-hint" data-proto-hint="${blockId}">点图上任意处落 pin 批注</span>
</div>`;
    const svgOverlay = `<svg class="proto-overlay" data-proto-overlay="${blockId}" xmlns="http://www.w3.org/2000/svg"
  style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:all;overflow:visible">
  <g class="proto-pins" data-proto-pins="${blockId}"></g>
</svg>`;
    let innerHtml = '';
    if (mode === 'wireframe') {
      const screen = block.screen ?? { id: 'screen', name: '原型', widgets: [] };
      const screenName = escHtml(screen.name ?? '');
      const widgets = screen.widgets ?? [];
      const widgetsHtml = widgets.map((widget, index) => {
        const id = escHtml(widget.id ?? `w${index}`);
        const x = (widget.x ?? 0) * 100;
        const y = (widget.y ?? 0) * 100;
        const width = (widget.w ?? 0.1) * 100;
        const height = (widget.h ?? 0.05) * 100;
        const cls = escHtml(widget.cls ?? 'rect');
        const text = escHtml(widget.text ?? '');
        return `<div class="proto-widget proto-widget-${cls}" data-proto-widget="${blockId}" data-widget-id="${id}"
  style="left:${x}%;top:${y}%;width:${width}%;height:${height}%" title="${text}"><span class="pw-text">${text}</span><span class="pw-resize" data-proto-resize aria-hidden="true"></span></div>`;
      }).join('');
      const isPhone = block.frame === 'phone';
      const body = `<div class="proto-widgets">${widgetsHtml}</div>
  ${svgOverlay}`;
      const canvas = isPhone
        ? `<div class="proto-wireframe-canvas proto-phone" data-proto-canvas="${blockId}" data-mode="annotate">
  <div class="proto-notch" aria-hidden="true"></div>
  ${body}
</div>`
        : `<div class="proto-wireframe-canvas" data-proto-canvas="${blockId}" data-mode="annotate"
  style="position:relative;width:100%;padding-bottom:75%;background:#fff;border:1px solid var(--color-border);overflow:hidden">
  ${body}
  <div class="proto-screen-label">${screenName}</div>
</div>`;
      innerHtml = `${modesBar()}\n${canvas}`;
    } else if (mode === 'iframe') {
      const raw = block.src ?? '';
      const src = escHtml(raw);
      const height = block.height || 620;
      const isAbsolute = /^https?:\/\//i.test(raw);
      const iframeSrc = isAbsolute ? `/api/proxy?url=${encodeURIComponent(raw)}` : src;
      const isPhone = block.frame === 'phone';
      const wrapCls = isPhone ? 'proto-iframe-wrap proto-phone' : 'proto-iframe-wrap';
      const wrapStyle = isPhone ? '' : ` style="position:relative;height:${height}px"`;
      innerHtml = `<div class="${wrapCls}"${wrapStyle}>
  <iframe class="proto-iframe" src="${iframeSrc}"
    style="width:100%;height:100%;border:0" title="${src}"></iframe>
  ${svgOverlay}
</div>`;
    } else {
      const imageUrl = escHtml(block.imageUrl ?? '');
      innerHtml = `<div class="proto-image-wrap" style="position:relative;display:inline-block;max-width:100%">
  <img class="proto-image" src="${imageUrl}" alt="${escHtml(block.title ?? '原型截图')}"
    style="display:block;max-width:100%;height:auto">
  ${svgOverlay}
</div>`;
    }
    const hint = `<div class="proto-hint" style="font-size:12px;color:var(--color-text-muted);margin-top:4px">点击图上任意位置落 pin 批注；点已有 pin 编辑或删除</div>`;
    return `<div class="proto-container" data-proto="${blockId}">${innerHtml}${hint}</div>`;
  },
};
