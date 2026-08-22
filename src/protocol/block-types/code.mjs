export default {
  type: 'code', hashFields: [], bodyAsContent: true, validate() { return []; },
  render(block, { escHtml }) { return `<pre class="code-block"><code class="lang-${escHtml(block.lang ?? '')}">${escHtml(block.body ?? '')}</code></pre>`; },
};
