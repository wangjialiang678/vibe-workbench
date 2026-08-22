export default {
  type: 'editable', hashFields: [], validate() { return []; },
  lint(block, { isDecision }) {
    return isDecision ? [{ rule: 'editable-for-confirm', message: '确认场景用 editable 是高摩擦（病例 5：R2 三个 editable 全部无人应答，改 verdict 后当轮通过）。只需"行/不行"时优先 verdict' }] : [];
  },
  render(block, { escHtml }) {
    const value = escHtml(block.value ?? block.body ?? '');
    const id = escHtml(block.id);
    return `<textarea class="editable-input" data-editable data-block-id="${id}" rows="6">${value}</textarea>
<div class="editable-actions">
  <button class="editable-confirm" data-editable-confirm="${id}" type="button">✓ 保持原样即确认</button>
  <span class="edit-status" hidden>已编辑·未提交</span>
  <span class="editable-confirmed" data-editable-confirmed="${id}" hidden>✓ 已确认保持原样</span>
</div>`;
  },
};
