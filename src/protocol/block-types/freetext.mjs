export default {
  type: 'freetext', hashFields: [], validate() { return []; },
  lint(block) {
    const text = `${block.title ?? ''}\n${block.body ?? ''}`;
    const marks = (text.match(/[①②③④⑤⑥]|(?:^|\n)\s*[1-9][.)、]/g) ?? []).length;
    return marks >= 2 ? [{ rule: 'multi-question', message: `freetext 里疑似塞了 ${marks} 个问题：建议一块一问（病例 4），否则答案与问题的对应关系要用户手工维护` }] : [];
  },
  render(block, { escHtml }) { return `<textarea class="freetext-input" placeholder="${escHtml(block.placeholder ?? '请输入')}" data-block-id="${escHtml(block.id)}" rows="4"></textarea>`; },
};
