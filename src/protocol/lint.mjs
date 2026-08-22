// 作者侧 lint（iteration-brief 2026-07-13 · P1/P2/P3）：普通规则只 warn；
// present 对决策完整性硬阻断，可用显式开关临时绕过。
// 每条规则都对应 docs/feedback-examples-2026-07-13.md 里的真实病例——
// 目的：把"让不了解细节的人也能判断"变成默认约束，而不是作者自觉。
// 浏览器安全（无 node 依赖），纯函数，可单测。
import { getBlockType } from './block-types/index.mjs';

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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function missingDecisionFields(block) {
  if (!block || block.needsDecision !== true) return [];

  const missingFields = [];
  if (!isNonEmptyString(block.background)) missingFields.push('background（背景）');
  if (!isNonEmptyString(block.why)) missingFields.push('why（为什么需要人定）');

  const definition = getBlockType(block.type);
  missingFields.push(...(definition?.decisionMissingFields?.(block, { isNonEmptyArray }) ?? []));

  if (block.hasRecommendation === true && !isNonEmptyString(block.recommendReason)) {
    missingFields.push('recommendReason（推荐理由）');
  }

  return missingFields;
}

// present 专用：只检查新提交内容，不读取或扫描 workspace 历史轮次。
export function findIncompleteDecisions(content) {
  const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
  return blocks.flatMap((block) => {
    const missingFields = missingDecisionFields(block);
    if (!missingFields.length) return [];
    return [{ blockId: block?.id ?? '未提供 id', missingFields }];
  });
}

export function formatIncompleteDecisions(issues) {
  if (!issues.length) return '';
  const lines = ['决策块可读性校验失败，present 已拒绝渲染：'];
  for (const issue of issues) {
    lines.push(`- [${issue.blockId}] 缺少：${issue.missingFields.join('、')}`);
  }
  lines.push('如需临时放行，请显式添加 --allow-incomplete-decisions（仍会输出 lint 警告）。');
  return lines.join('\n');
}

export function lintBlock(block) {
  const w = [];
  const push = (rule, message) => w.push({ level: 'warn', blockId: block.id, rule, message });
  const isDecision = block.needsDecision === true;
  const definition = getBlockType(block.type);

  // —— P1 决策块结构化（病例 1/3/8）——
  if (isDecision && !isNonEmptyString(block.background)) {
    push('missing-background', '决策块缺 background（背景）：用户会在不懂上下文时"盲选"，产出零质量的伪决策（病例 1）');
  }
  if (isDecision && !isNonEmptyString(block.why)) {
    push('missing-why', '决策块缺 why（为什么需要你定）：用户不知道"这题为什么归我、错了多大事"（病例 8 四维自评）');
  }
  for (const warning of definition?.lint?.(block, { isDecision, isNonEmptyArray }) ?? []) push(warning.rule, warning.message);
  // —— ASCII 字符画检测（创始人 2026-07-23 实证反馈：框线在比例字体下必然散架）——
  // 命中 3 个以上制表/框线字符（U+2500–U+257F）即判定为字符画
  const artSource = [block.body, block.value, ...(Array.isArray(block.options) ? block.options.map((o) => o?.desc) : [])]
    .filter((s) => typeof s === 'string').join('\n');
  const boxChars = (artSource.match(/[─-╿]/g) || []).length;
  if (boxChars >= 3) {
    push('ascii-art', `检测到 ${boxChars} 个框线字符：ASCII/框线示意在网页比例字体下会散架，界面布局请用 prototype 线框/图片，流程请用 mermaid diagram 块`);
  }

  if (isDecision && block.hasRecommendation === true && !isNonEmptyString(block.recommendReason)) {
    push('missing-recommend-reason', '有 recommendation 却缺 recommendReason：用户不知道你为什么推荐它');
  }

  // —— P3 未解释的术语/缩写（病例 3：用户直接回"没听懂"）——
  const surface = [
    block.title, block.body,
    ...(Array.isArray(block.options) ? block.options : []).map((o) => `${o?.label ?? ''} ${o?.desc ?? ''}`),
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
