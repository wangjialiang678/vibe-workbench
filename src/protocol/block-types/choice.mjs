export default {
  type: 'choice',
  hashFields: [],
  validate(block) {
    const errors = [];
    if (block.mode != null && !['quick', 'blind'].includes(block.mode)) errors.push('choice.mode must be quick or blind');
    if (block.judgmentKind != null && !['fact', 'preference', 'prediction'].includes(block.judgmentKind)) errors.push('choice.judgmentKind invalid');
    if (block.supersedes != null && (typeof block.supersedes !== 'string' || !block.supersedes.trim())) errors.push('choice.supersedes must be non-empty string');
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
    const options = Array.isArray(block.options) ? block.options : [];
    const incomplete = options.filter((option) => !isNonEmptyArray(option?.pros) || !isNonEmptyArray(option?.cons));
    const warnings = isDecision && incomplete.length ? [{
      rule: 'missing-proscons',
      message: `${incomplete.length}/${options.length} 个选项缺非空 pros/cons：选项只讲机制不讲后果，用户无法判断"选了会发生什么、能不能反悔"（病例 1）`,
    }] : [];
    if ((block.supersedes || /D\d+/.test(block.background ?? ''))
      && !['现行', '本次改', '不动'].every((keyword) => String(block.background ?? '').includes(keyword))) {
      warnings.push({ rule: 'missing-supersede-frame', message: '涉及既有决策但 background 缺 D36 三段式「现行／本次改／不动」；用户无法判断改动边界（warn，不阻断）' });
    }
    return warnings;
  },
  render(block, { escHtml }) {
    const blind = block.mode === 'blind';
    const options = block.judgmentKind === 'fact' && !(block.options ?? []).some((option) => option?.id === 'defer')
      ? [...(block.options ?? []), { id: 'defer', label: '转外部确认', desc: '暂不判断，转外部信源或客户确认' }]
      : (block.options ?? []);
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
    const factHint = block.judgmentKind === 'fact'
      ? '<aside class="choice-fact-hint" role="note">这是事实类问题，宜转外部信源/客户确认</aside>\n'
      : '';
    const capture = blind ? `
<div class="choice-blind-capture">
  <textarea data-choice-prediction="${escHtml(block.id)}" rows="2" placeholder="你预计这样选之后会发生什么？"></textarea>
  <textarea data-choice-premises="${escHtml(block.id)}" rows="2" placeholder="什么情况变了，这个决定要重新议？"></textarea>
</div>` : '';
    return `${factHint}<div class="choice-group" role="group">${options.map((option) => {
      const isRec = !blind && option.id === recommendation;
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
    }).join('\n')}</div>${capture}`;
  },
};
