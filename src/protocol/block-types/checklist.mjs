export default {
  type: 'checklist', hashFields: ['items', 'verdictLabels'],
  validate(block) {
    const errors = [];
    if (!Array.isArray(block.items) || block.items.length === 0) {
      errors.push('checklist requires non-empty items[]');
    } else {
      block.items.forEach((item, index) => {
        if (!item || !item.id) errors.push(`checklist items[${index}] requires id`);
        if (!item || !item.label) errors.push(`checklist items[${index}] requires label`);
      });
    }
    if (!Array.isArray(block.verdictLabels) || block.verdictLabels.length === 0) errors.push('checklist requires non-empty verdictLabels[]');
    return errors;
  },
  render(block, { escHtml }) {
    const blockId = escHtml(block.id ?? '');
    const items = block.items ?? [];
    const labels = block.verdictLabels ?? ['赞成', '异议', '疑问'];
    const itemsHtml = items.map((item) => {
      const itemId = escHtml(item.id ?? '');
      const itemLabel = escHtml(item.label ?? '');
      const itemBody = item.body ? `<div class="checklist-item-body">${escHtml(item.body)}</div>` : '';
      const buttonsHtml = labels.map((label) => {
        const labelEscaped = escHtml(label);
        return `<button class="checklist-verdict-btn"
  data-block-id="${blockId}"
  data-item-id="${itemId}"
  data-label="${labelEscaped}"
  type="button"
  aria-label="${labelEscaped}">${labelEscaped}</button>`;
      }).join('');
      return `<div class="checklist-item" data-checklist-item="${itemId}">
  <div class="checklist-item-header">
    <span class="checklist-item-label">${itemLabel}</span>
    <div class="checklist-verdict-group" role="group" aria-label="${itemLabel} 表态">${buttonsHtml}</div>
  </div>
  ${itemBody}
</div>`;
    }).join('\n');
    return `<div class="checklist-group" data-checklist="${blockId}">${itemsHtml}</div>`;
  },
};
