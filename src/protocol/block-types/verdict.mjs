export default {
  type: 'verdict', hashFields: [], validate() { return []; },
  render(block, { escHtml }) {
    const id = escHtml(block.id);
    return `<div class="verdict-group" role="group" aria-label="表态">
  <button class="verdict-btn" data-verdict="赞成" data-block-id="${id}" aria-label="赞成">✓赞成</button>
  <button class="verdict-btn" data-verdict="异议" data-block-id="${id}" aria-label="异议">✗异议</button>
  <button class="verdict-btn" data-verdict="疑问" data-block-id="${id}" aria-label="疑问">?疑问</button>
</div>
<div class="verdict-comment" hidden>
  <textarea class="verdict-reason" placeholder="请说明理由（推荐填写）" data-block-id="${id}" rows="2"></textarea>
</div>`;
  },
};
