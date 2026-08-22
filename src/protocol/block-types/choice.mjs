export default {
  type: 'choice',
  hashFields: [],
  validate(block) {
    const errors = [];
    if (!Array.isArray(block.options) || block.options.length === 0) errors.push('choice requires non-empty options[]');
    else block.options.forEach((option, index) => {
      if (!option || !option.id) errors.push(`choice option[${index}] requires id`);
      if (option && option.pros != null && !Array.isArray(option.pros)) errors.push(`choice option[${index}].pros must be array`);
      if (option && option.cons != null && !Array.isArray(option.cons)) errors.push(`choice option[${index}].cons must be array`);
    });
    if (block.hasRecommendation && block.recommendation != null) {
      const ids = (block.options || []).map((option) => option && option.id);
      if (!ids.includes(block.recommendation)) errors.push('choice.recommendation must match an option id');
    }
    return errors;
  },
  decisionMissingFields(block, { isNonEmptyArray }) {
    return (Array.isArray(block.options) ? block.options : []).flatMap((option, index) => [
      ...(!isNonEmptyArray(option?.pros) ? [`options[${index}].pros（选项优点）`] : []),
      ...(!isNonEmptyArray(option?.cons) ? [`options[${index}].cons（选项缺点）`] : []),
    ]);
  },
  lint(block, { isDecision, isNonEmptyArray }) {
    if (!isDecision) return [];
    const options = Array.isArray(block.options) ? block.options : [];
    const incomplete = options.filter((option) => !isNonEmptyArray(option?.pros) || !isNonEmptyArray(option?.cons));
    return incomplete.length ? [{
      rule: 'missing-proscons',
      message: `${incomplete.length}/${options.length} 个选项缺非空 pros/cons：选项只讲机制不讲后果，用户无法判断"选了会发生什么、能不能反悔"（病例 1）`,
    }] : [];
  },
  render(block, { escHtml }) {
    const options = block.options ?? [];
    const recommendation = block.recommendation;
    const inputType = (block.multi ?? false) ? 'checkbox' : 'radio';
    const name = `choice-${escHtml(block.id)}`;
    const prosConsHtml = (option) => {
      const pros = Array.isArray(option.pros) ? option.pros : [];
      const cons = Array.isArray(option.cons) ? option.cons : [];
      if (pros.length === 0 && cons.length === 0) return '';
      const items = (list, cls) => list.map((text) => `<li class="${cls}">${escHtml(text)}</li>`).join('');
      return `<div class="opt-proscons">
${pros.length ? `<ul class="opt-pros" aria-label="好处">${items(pros, 'pro')}</ul>` : ''}
${cons.length ? `<ul class="opt-cons" aria-label="代价 / 风险">${items(cons, 'con')}</ul>` : ''}
</div>`;
    };
    return `<div class="choice-group" role="group">${options.map((option) => {
      const isRec = option.id === recommendation;
      const recAttr = isRec ? ' data-recommended="true"' : '';
      const recLabel = isRec ? ' <span class="rec-label">推荐</span>' : '';
      const desc = option.desc ? `<span class="opt-desc">${escHtml(option.desc)}</span>` : '';
      return `<div class="choice-item">
<label class="choice-option${isRec ? ' choice-recommended' : ''}"${recAttr}>
  <input type="${inputType}" name="${name}" value="${escHtml(option.id)}"${isRec ? ' data-default-check' : ''}>
  <span class="opt-label">${escHtml(option.label)}${recLabel}</span>${desc}
</label>
${prosConsHtml(option)}
</div>`;
    }).join('\n')}</div>`;
  },
};
