export default {
  type: 'diagram',
  hashFields: [],
  bodyAsContent: true,
  validate() { return []; },
  render(block, { escHtml, mdToHtml }) {
    const escaped = escHtml(block.body ?? '');
    const rationalePart = block.rationale
      ? `<details class="diagram-rationale"><summary>设计依据</summary><div>${mdToHtml(block.rationale)}</div></details>`
      : '';
    return `<pre class="mermaid">${escaped}</pre>${rationalePart}`;
  },
};
