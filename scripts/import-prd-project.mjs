#!/usr/bin/env node
/**
 * scripts/import-prd-project.mjs
 *
 * 一次性转换脚本（DESIGN §1.5）：
 * 读取 prd-review-studio 的 demo.js（window.PROJECT_DATA = {...} 赋值），
 * 按 §1.3 映射逐面生成 Vibe block 数组，
 * 落成 workspace/imported-demo/round-1/content.json。
 *
 * 纯数据转换，无 UI，零运行时依赖，纯 ESM。
 *
 * 面映射（§1.3）：
 *   prd.sections[].items[]         → verdict block（b-prd-<id>）
 *   arch.diagrams[]                → diagram block（b-arch-<id>）
 *   arch.assertions[]              → verdict block（b-assert-<id>）
 *   arch.alternatives[]            → choice block（b-alt-<id>）
 *   test.scenarios[]               → verdict block（b-test-<id>）
 *   completeness.*（journey/frSlots/wildFeatures/reconcile）→ checklist blocks（b-chk-<group>）
 *   proto.screens[]                → prototype block（b-proto-<id>，mode:'wireframe'）
 * （ui 面在 demo.js 中无独立数据，略过）
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 路径 ──────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// 输入：prd-review-studio 的 demo.js（绝对路径）
const DEMO_JS_PATH =
  process.argv[2] ??
  resolve(
    '/Users/michael/projects/组件模块/prd-review-studio/public/projects/demo.js',
  );

// 输出：vibecoding 工作台 workspace
const SESSION = 'imported-demo';
const ROUND = 1;
const OUT_DIR = resolve(ROOT, 'workspace', SESSION, `round-${ROUND}`);
const OUT_FILE = resolve(OUT_DIR, 'content.json');

// ── 从 demo.js 提取 PROJECT_DATA ─────────────────────────────────────────

function extractProjectData(filePath) {
  const src = readFileSync(filePath, 'utf8');

  // demo.js 的赋值形式：window.PROJECT_DATA = { ... };
  // 正则：取出 = 后的 JS 对象字面量（贪婪匹配到最后一个 };）
  const m = src.match(/window\.PROJECT_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error(`Cannot find window.PROJECT_DATA assignment in ${filePath}`);

  // 用 Function 构造器在隔离上下文里求值（沙箱）
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m[1]})`)();
}

// ── slug ──────────────────────────────────────────────────────────────────

function slug(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

// ── 重要性映射 ─────────────────────────────────────────────────────────────

function importance(item) {
  return item.important ? 'high' : 'normal';
}

// ── default/recommendation 映射 ────────────────────────────────────────────
// demo.js 用 defaultVerdict: 'ok'|'no'|'q'

const VERDICT_MAP = { ok: '赞成', no: '异议', q: '疑问' };

function defaultVerdict(item) {
  return item.defaultVerdict ? (VERDICT_MAP[item.defaultVerdict] ?? null) : null;
}

// ── 逐面转换 ──────────────────────────────────────────────────────────────

function convertPrd(prd, blocks) {
  if (!prd || !Array.isArray(prd.sections)) return;
  for (const section of prd.sections) {
    for (const item of section.items ?? []) {
      const id = slug(item.id ?? item.cid ?? item.title);
      blocks.push({
        id: `b-prd-${id}`,
        type: 'verdict',
        title: item.title ?? null,
        body: item.body ?? null,
        needsDecision: true,
        hasRecommendation: false,
        recommendation: null,
        default: defaultVerdict(item),
        importance: importance(item),
      });
    }
  }
}

function convertArchDiagrams(arch, blocks) {
  for (const diag of arch.diagrams ?? []) {
    const id = slug(diag.id ?? diag.title);
    blocks.push({
      id: `b-arch-${id}`,
      type: 'diagram',
      title: diag.title ?? null,
      body: diag.mermaid ?? '',
      lang: 'mermaid',
      rationale: diag.rationale ?? null,
      needsDecision: false,
      hasRecommendation: false,
      recommendation: null,
      default: defaultVerdict(diag),
      importance: importance(diag),
    });
  }
}

function convertArchAssertions(arch, blocks) {
  for (const a of arch.assertions ?? []) {
    const id = slug(a.id ?? a.text);
    blocks.push({
      id: `b-assert-${id}`,
      type: 'verdict',
      title: a.text ?? null,
      body: null,
      needsDecision: true,
      hasRecommendation: false,
      recommendation: null,
      default: defaultVerdict(a),
      importance: importance(a),
    });
  }
}

function convertArchAlternatives(arch, blocks) {
  if (!Array.isArray(arch.alternatives) || arch.alternatives.length === 0) return;

  // 所有 alternatives → 1 个 choice block（chosen:true → recommendation）
  const options = arch.alternatives.map((alt) => ({
    id: slug(alt.id ?? alt.title),
    label: alt.title ?? alt.id,
    body: alt.desc ?? null,
  }));
  const chosen = arch.alternatives.find((a) => a.chosen);
  const recommendation = chosen ? slug(chosen.id ?? chosen.title) : null;
  const hasRec = recommendation != null && options.some((o) => o.id === recommendation);

  blocks.push({
    id: 'b-alt-storage',
    type: 'choice',
    title: '存储方案选择？',
    body: null,
    options,
    recommendation: hasRec ? recommendation : null,
    hasRecommendation: hasRec,
    needsDecision: true,
    importance: 'normal',
  });
}

function convertTestScenarios(test, blocks) {
  for (const s of test.scenarios ?? []) {
    const id = slug(s.id ?? s.name);
    blocks.push({
      id: `b-test-${id}`,
      type: 'verdict',
      title: s.name ?? null,
      body: s.expect ?? null,
      needsDecision: true,
      hasRecommendation: false,
      recommendation: null,
      default: defaultVerdict(s),
      importance: importance(s),
    });
  }

  // test.cases → code block (lang: 'gherkin')
  for (const c of test.cases ?? []) {
    const id = slug(c.id ?? c.title);
    blocks.push({
      id: `b-case-${id}`,
      type: 'code',
      title: c.title ?? null,
      body: c.gherkin ?? '',
      lang: 'gherkin',
      needsDecision: false,
      hasRecommendation: false,
      recommendation: null,
      default: defaultVerdict(c),
      importance: importance(c),
    });
  }
}

function convertCompleteness(completeness, blocks) {
  if (!completeness) return;

  // journey → checklist block（b-chk-journey）
  if (Array.isArray(completeness.journey) && completeness.journey.length > 0) {
    blocks.push({
      id: 'b-chk-journey',
      type: 'checklist',
      title: '用户旅程覆盖',
      group: 'journey',
      verdictLabels: ['已覆盖', '明确不做', '待定'],
      items: completeness.journey.map((j) => ({
        id: slug(j.id ?? j.label),
        label: j.label ?? j.id,
        body: [j.body, j.gap].filter(Boolean).join(' | ') || null,
        default: defaultVerdict(j),
      })),
      needsDecision: true,
      importance: 'normal',
    });
  }

  // frSlots → checklist block（b-chk-frSlots）
  if (Array.isArray(completeness.frSlots) && completeness.frSlots.length > 0) {
    blocks.push({
      id: 'b-chk-frslots',
      type: 'checklist',
      title: 'FR 三件套完整性（状态/逆流/错误恢复）',
      group: 'frSlots',
      verdictLabels: ['已覆盖', '明确不做', '待定'],
      items: completeness.frSlots.map((fr) => ({
        id: slug(fr.id ?? fr.fr ?? fr.title),
        label: `${fr.fr ? fr.fr + ' ' : ''}${fr.title ?? ''}`.trim(),
        body: [
          fr.states ? `状态：${fr.states}` : null,
          fr.inverseFlow ? `逆流：${fr.inverseFlow}` : null,
          fr.errorRecovery ? `错误恢复：${fr.errorRecovery}` : null,
          fr.note ?? null,
        ]
          .filter(Boolean)
          .join('\n') || null,
        default: defaultVerdict(fr),
      })),
      needsDecision: true,
      importance: 'normal',
    });
  }

  // wildFeatures → checklist block（b-chk-wildFeatures）
  if (Array.isArray(completeness.wildFeatures) && completeness.wildFeatures.length > 0) {
    blocks.push({
      id: 'b-chk-wildfeatures',
      type: 'checklist',
      title: '未确认功能清单（补需求/删功能/待定）',
      group: 'wildFeatures',
      verdictLabels: ['补需求', '删功能', '待定'],
      items: completeness.wildFeatures.map((w) => ({
        id: slug(w.id ?? w.title),
        label: w.title ?? w.id,
        body: [w.body, w.risk].filter(Boolean).join(' 风险：') || null,
        default: null,
      })),
      needsDecision: true,
      importance: 'normal',
    });
  }

  // reconcile → checklist block（b-chk-reconcile）
  if (Array.isArray(completeness.reconcile) && completeness.reconcile.length > 0) {
    blocks.push({
      id: 'b-chk-reconcile',
      type: 'checklist',
      title: '稿↔FR↔代码 三方对账',
      group: 'reconcile',
      verdictLabels: ['已对齐', '需修改', '待定'],
      items: completeness.reconcile.map((r) => ({
        id: slug(r.id ?? r.title),
        label: r.title ?? r.id,
        body: [
          r.spec ? `原型：${r.spec}` : null,
          r.code ? `代码：${r.code}` : null,
          r.action ? `建议：${r.action}` : null,
        ]
          .filter(Boolean)
          .join('\n') || null,
        default: defaultVerdict(r),
      })),
      needsDecision: true,
      importance: 'normal',
    });
  }
}

function convertProto(proto, blocks) {
  if (!proto || !Array.isArray(proto.screens)) return;
  for (const screen of proto.screens) {
    const id = slug(screen.id ?? screen.name);
    blocks.push({
      id: `b-proto-${id}`,
      type: 'prototype',
      title: screen.name ?? null,
      mode: 'wireframe',
      screen: {
        id: screen.id ?? id,
        name: screen.name ?? null,
        // demo.js 控件坐标是相对手机内屏(约 340×720)的 px；renderPrototype 期望 0-1 比例(它再 ×100)，
        // 故按屏幕尺寸归一化，否则 px 被当比例 ×100 会飞出画布外(如 x=20 → 2000%)。
        widgets: (screen.widgets ?? []).map((w) => ({
          id: w.id ?? slug(w.text ?? ''),
          cls: w.cls ?? 'box',
          x: (w.x ?? 0) / 340,
          y: (w.y ?? 0) / 720,
          w: (w.w ?? 100) / 340,
          h: (w.h ?? 40) / 720,
          text: w.text ?? '',
          goto: w.goto ?? null,
        })),
      },
      needsDecision: false,
      hasRecommendation: false,
      importance: 'normal',
    });
  }
}

// ── 主逻辑 ────────────────────────────────────────────────────────────────

// ── UI 面 → prototype(iframe) 高保真屏（此前整个 convertUI 缺失，导致 10 个高保真屏进不来）──
// prd-studio 的 ui.screens[].src 是相对路径（'ui/b-home.html'）→ 转成绝对 URL，Vibe 经 /api/proxy 嵌入。
function convertUI(ui, blocks, uiBase) {
  if (!ui || !Array.isArray(ui.screens)) return;
  for (const sc of ui.screens) {
    const raw = sc.src ?? '';
    const src = /^https?:\/\//i.test(raw) ? raw : new URL(raw, uiBase).href;
    blocks.push({
      id: 'b-ui-' + slug(sc.id ?? sc.name ?? 'screen'),
      type: 'prototype',
      mode: 'iframe',
      title: sc.name ?? null,
      src,
      frame: 'phone',            // 手机壳呈现（对齐 prd-studio 观感）
      height: 740,
      needsDecision: false,
      hasRecommendation: false,
      recommendation: null,
      importance: 'normal',
    });
  }
}

// ── 块 → tab 分面类目（DESIGN §15）──
const SECTION_BY_PREFIX = [
  ['b-prd-',    '需求'],
  ['b-arch-',   '架构'],
  ['b-assert-', '架构'],
  ['b-alt-',    '架构'],
  ['b-ui-',     'UI 设计'],
  ['b-proto-',  '交互设计'],
  ['b-test-',   '测试'],
  ['b-case-',   '测试'],
  ['b-chk-',    '风险'],
];

function sectionFor(id) {
  const hit = SECTION_BY_PREFIX.find(([p]) => String(id).startsWith(p));
  return hit ? hit[1] : undefined;
}

function convert(projectData, opts = {}) {
  const blocks = [];
  const uiBase = opts.uiBase ?? 'http://127.0.0.1:8088/';

  convertPrd(projectData.prd, blocks);
  convertArchDiagrams(projectData.arch ?? {}, blocks);
  convertArchAssertions(projectData.arch ?? {}, blocks);
  convertArchAlternatives(projectData.arch ?? {}, blocks);
  convertUI(projectData.ui, blocks, uiBase);          // ← 新增：高保真 UI 面
  convertProto(projectData.proto, blocks);
  convertTestScenarios(projectData.test ?? {}, blocks);
  convertCompleteness(projectData.completeness, blocks);

  // 打 section → 页面出 tab 分面导航（需求/架构/UI 设计/交互设计/测试/风险）
  for (const b of blocks) {
    const s = sectionFor(b.id);
    if (s) b.section = s;
  }

  return {
    session: opts.session ?? SESSION,
    round: ROUND,
    title: projectData.title ?? 'Imported PRD',
    sections: ['需求', '架构', 'UI 设计', '交互设计', '测试', '风险'],
    blocks,
  };
}

// ── 执行 ──────────────────────────────────────────────────────────────────

// CLI: import-prd-project.mjs <project.js> [--session <name>] [--ui-base <url>]
function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const projectData = extractProjectData(DEMO_JS_PATH);
const session = argOf('--session', projectData.id ? `prd-${projectData.id}` : SESSION);
const uiBase = argOf('--ui-base', 'http://127.0.0.1:8088/');

const content = convert(projectData, { session, uiBase });

const outDir = resolve(ROOT, 'workspace', session, `round-${ROUND}`);
const outFile = resolve(outDir, 'content.json');
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(content, null, 2), 'utf8');

const bySection = {};
for (const b of content.blocks) { const s = b.section ?? '其他'; bySection[s] = (bySection[s] ?? 0) + 1; }

console.log(`[import-prd-project] 生成完成：${outFile}`);
console.log(`  session: ${session}`);
console.log(`  blocks : ${content.blocks.length} 个`);
console.log(`  types  : ${[...new Set(content.blocks.map((b) => b.type))].join(', ')}`);
console.log(`  分面   : ${Object.entries(bySection).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
console.log(`  UI 稿  : 经 ${uiBase} 取（需 prd-studio 的静态服务在跑）`);
