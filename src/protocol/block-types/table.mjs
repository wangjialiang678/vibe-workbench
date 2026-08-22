export default {
  type: 'table', hashFields: [],
  validate(block) {
    const errors = [];
    if (!Array.isArray(block.columns)) errors.push('table requires columns[]');
    if (!Array.isArray(block.rows)) errors.push('table requires rows[]');
    return errors;
  },
  render(block, { escHtml }) {
    const columns = block.columns ?? [];
    const rows = block.rows ?? [];
    const head = columns.length ? `<thead><tr>${columns.map((column) => `<th>${escHtml(column)}</th>`).join('')}</tr></thead>` : '';
    const body = rows.length ? `<tbody>${rows.map((row) => `<tr>${(row ?? []).map((cell) => `<td>${escHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>` : '';
    return `<table class="block-table">${head}${body}</table>`;
  },
};
