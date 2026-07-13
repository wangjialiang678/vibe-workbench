// 作者侧 lint（iteration-brief 2026-07-13 · P1/P2/P3）：present 时 warn，**不阻断**。
// 每条规则都对应 docs/feedback-examples-2026-07-13.md 里的真实病例——
// 目的：把"让不了解细节的人也能判断"变成默认约束，而不是作者自觉。
// 浏览器安全（无 node 依赖），纯函数，可单测。

// 决策者语境里可直接使用、无需解释的常见缩写
const ACRONYM_ALLOW = new Set([
  'AI', 'UI', 'UX', 'API', 'PRD', 'MVP', 'HTTP', 'HTTPS', 'JSON', 'HTML', 'CSS', 'URL', 'ID', 'OK',
  'FR', 'AC', 'NFR', 'CLI', 'IDE', 'SDK', 'PR', 'QA', 'CPU', 'GPU', 'OS', 'MD', 'TXT', 'PDF',
  'CI', 'CD', 'P0', 'P1', 'P2', 'P3', 'TODO', 'APP', 'ASR', 'USB', 'RAM',
]);

function acronyms(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/\b[A-Z][A-Z0-9]{2,}\b/g)) {
    if (!ACRONYM_ALLOW.has(m[0])) out.add(m[0]);
  }
  return [...out];
}

export function lintBlock(block) {
  const w = [];
  const push = (rule, message) => w.push({ level: 'warn', blockId: block.id, rule, message });
  const isDecision = block.needsDecision === true;

  // —— P1 决策块结构化（病例 1/3/8）——
  if (isDecision && !block.background) {
    push('missing-background', '决策块缺 background（背景）：用户会在不懂上下文时"盲选"，产出零质量的伪决策（病例 1）');
  }
  if (isDecision && !block.why) {
    push('missing-why', '决策块缺 why（为什么需要你定）：用户不知道"这题为什么归我、错了多大事"（病例 8 四维自评）');
  }
  if (isDecision && block.type === 'choice') {
    const opts = block.options ?? [];
    const bare = opts.filter((o) => !(Array.isArray(o.pros) && o.pros.length) && !(Array.isArray(o.cons) && o.cons.length));
    if (bare.length) {
      push('missing-proscons', `${bare.length}/${opts.length} 个选项缺 pros/cons：选项只讲机制不讲后果，用户无法判断"选了会发生什么、能不能反悔"（病例 1）`);
    }
  }
  if (block.hasRecommendation === true && !block.recommendReason) {
    push('missing-recommend-reason', '有 recommendation 却缺 recommendReason：用户不知道你为什么推荐它');
  }

  // —— P2 确认场景低摩擦（病例 5：行为数据，editable 连续两轮无人应答）——
  if (isDecision && block.type === 'editable') {
    push('editable-for-confirm', '确认场景用 editable 是高摩擦（病例 5：R2 三个 editable 全部无人应答，改 verdict 后当轮通过）。只需"行/不行"时优先 verdict');
  }

  // —— 一块一问（病例 4：一个 freetext 塞三问，用户被迫自行编号作答，跨轮 diff 也失效）——
  if (block.type === 'freetext') {
    const t = `${block.title ?? ''}\n${block.body ?? ''}`;
    const marks = (t.match(/[①②③④⑤⑥]|(?:^|\n)\s*[1-9][.)、]/g) ?? []).length;
    if (marks >= 2) {
      push('multi-question', `freetext 里疑似塞了 ${marks} 个问题：建议一块一问（病例 4），否则答案与问题的对应关系要用户手工维护`);
    }
  }

  // —— P3 未解释的术语/缩写（病例 3：用户直接回"没听懂"）——
  const surface = [
    block.title, block.body,
    ...(block.options ?? []).map((o) => `${o?.label ?? ''} ${o?.desc ?? ''}`),
  ].join(' ');
  const explained = `${block.background ?? ''} ${block.why ?? ''} ${block.recommendReason ?? ''}`;
  const unexplained = acronyms(surface).filter((a) => !explained.includes(a));
  if (isDecision && unexplained.length) {
    push('unexplained-jargon', `疑似未解释的术语/缩写：${unexplained.join('、')}。面向决策者的文案，术语首次出现必须一句话解释"这是什么、跟我有什么关系"（病例 3）`);
  }

  return w;
}

export function lintContent(content) {
  const blocks = content?.blocks ?? [];
  return blocks.flatMap((b) => lintBlock(b ?? {}));
}

// 终端友好输出（present 时打到 stderr，不污染 stdout 的 JSON）
export function formatLint(warnings) {
  if (!warnings.length) return '';
  const lines = [`⚠️  作者侧 lint：${warnings.length} 条建议（warn，不阻断）`];
  for (const w of warnings) lines.push(`   · [${w.blockId}] ${w.rule} — ${w.message}`);
  lines.push('   规范见 docs/authoring-guide.md ｜ 病例见 docs/feedback-examples-2026-07-13.md');
  return lines.join('\n');
}
