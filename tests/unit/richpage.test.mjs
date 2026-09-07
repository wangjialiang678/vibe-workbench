import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { blockFingerprint, validateBlock, validateContent } from '../../src/protocol/schema.mjs';
import { computeDiff } from '../../src/protocol/diff.mjs';
import { lintBlock } from '../../src/protocol/lint.mjs';
import { blockHtml } from '../../src/render/blocks.mjs';
import { feedbackItems } from '../../src/render/submit-payload.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));

function validRichpage(overrides = {}) {
  return {
    id: 'b-panorama',
    type: 'richpage',
    title: 'VibeLoop 全景与路线',
    summary: '结论先行。',
    sections: [{
      id: 'built',
      heading: '已建成并在运行的',
      kicker: '平台底座',
      items: [{ kind: 'md', body: '正文' }],
    }],
    sources: [{ n: 1, text: '来源说明', url: 'https://example.com/source' }],
    ...overrides,
  };
}

test('richpage validate 接受全部九种受控原语', () => {
  const block = validRichpage({
    toc: true,
    sections: [{
      id: 'all-primitives',
      heading: '全部原语',
      kicker: '安全结构化页面',
      items: [
        { kind: 'md', body: '**正文**' },
        { kind: 'table', columns: ['能力', '状态'], rows: [['闭环', '运行']] },
        { kind: 'pills', items: [{ label: '运行', tone: 'ok' }, { label: '等待', tone: 'wait' }] },
        { kind: 'kpi', items: [{ value: '40', label: '发现' }] },
        { kind: 'callout', tone: 'doing', title: '处理中', body: '说明' },
        { kind: 'lane', title: '近期', body: '- 一件事' },
        { kind: 'steps', items: ['第一步', '第二步'] },
        { kind: 'bars', unit: '条', series: [{ label: '独有', value: 37 }], max: 40 },
        { kind: 'diagram', lang: 'mermaid', body: 'flowchart LR; A-->B' },
      ],
    }],
  });
  assert.deepEqual(validateBlock(block), { ok: true, errors: [] });
});

test('richpage validate 拒绝未知 kind、非法或重复 section id', () => {
  const unknown = validRichpage({ sections: [{ id: 'ok', heading: '标题', items: [{ kind: 'html', body: '<b>x</b>' }] }] });
  assert.match(validateBlock(unknown).errors.join('\n'), /unknown kind: html/);

  const illegal = validRichpage({ sections: [{ id: 'Not_Slug', heading: '标题', items: [] }] });
  assert.match(validateBlock(illegal).errors.join('\n'), /section\.id invalid/);

  const duplicate = validRichpage({ sections: [
    { id: 'same', heading: '一', items: [] },
    { id: 'same', heading: '二', items: [] },
  ] });
  assert.match(validateBlock(duplicate).errors.join('\n'), /duplicate section id: same/);
});

test('richpage validate 拒绝节数、节内 items 与 256 KiB 超限', () => {
  const tooManySections = validRichpage({
    sections: Array.from({ length: 41 }, (_, i) => ({ id: `s-${i}`, heading: `节 ${i}`, items: [] })),
  });
  assert.match(validateBlock(tooManySections).errors.join('\n'), /sections must contain 1-40/);

  const tooManyItems = validRichpage({
    sections: [{ id: 'crowded', heading: '过多', items: Array.from({ length: 61 }, () => ({ kind: 'md', body: 'x' })) }],
  });
  assert.match(validateBlock(tooManyItems).errors.join('\n'), /items must contain at most 60/);

  const tooLarge = validRichpage({
    sections: [{ id: 'large', heading: '过大', items: [{ kind: 'md', body: '字'.repeat(90_000) }] }],
  });
  assert.match(validateBlock(tooLarge).errors.join('\n'), /256 KiB/);
});

test('richpage validate 严格检查文本、bars 数值与 sources URL', () => {
  const bad = validRichpage({
    summary: 1,
    sections: [{
      id: 'bad',
      heading: 2,
      items: [
        { kind: 'table', columns: ['a'], rows: [[3]] },
        { kind: 'bars', unit: 4, series: [{ label: 5, value: Number.POSITIVE_INFINITY }], max: 0 },
      ],
    }],
    sources: [{ n: 1, text: 6, url: 'javascript:alert(1)' }],
  });
  const errors = validateBlock(bad).errors.join('\n');
  assert.match(errors, /summary must be string/);
  assert.match(errors, /heading must be string/);
  assert.match(errors, /table rows cells must be strings/);
  assert.match(errors, /bars value must be finite number/);
  assert.match(errors, /source url must use http or https/);
});

test('richpage render 输出锚点、自动目录、九种原语与来源', () => {
  const sections = Array.from({ length: 4 }, (_, i) => ({
    id: `section-${i + 1}`,
    heading: `第 ${i + 1} 节`,
    items: i === 0 ? [
      { kind: 'md', body: '**正文**' },
      { kind: 'table', columns: ['能力'], rows: [['闭环']] },
      { kind: 'pills', items: [{ label: '运行', tone: 'ok' }] },
      { kind: 'kpi', items: [{ value: '40', label: '发现' }] },
      { kind: 'callout', tone: 'wait', title: '拍板', body: '说明' },
      { kind: 'lane', title: '近期', body: '路线' },
      { kind: 'steps', items: ['第一步'] },
      { kind: 'bars', unit: '条', series: [{ label: '独有', value: 20 }], max: 40 },
      { kind: 'diagram', lang: 'mermaid', body: 'flowchart LR; A-->B' },
    ] : [],
  }));
  const html = blockHtml(validRichpage({ sections }));
  assert.match(html, /<article class="richpage"/);
  assert.match(html, /class="rp-toc"/);
  assert.match(html, /id="rp-b-panorama-section-1"/);
  assert.match(html, /data-richpage-add="b-panorama" data-section-id="section-1"/);
  for (const cls of ['rp-md', 'rp-tablewrap', 'rp-pills', 'rp-kpis', 'rp-callout', 'rp-lane', 'rp-steps', 'rp-bars', 'mermaid', 'rp-sources']) {
    assert.match(html, new RegExp(`class="[^"]*${cls}`), `应渲染 ${cls}`);
  }
});

test('richpage 所有文本字段只以转义文本渲染，不形成 script 或事件属性', () => {
  const attack = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const html = blockHtml(validRichpage({
    title: attack,
    summary: attack,
    sections: [{
      id: 'safe',
      heading: attack,
      kicker: attack,
      items: [
        { kind: 'md', body: attack },
        { kind: 'table', columns: [attack], rows: [[attack]] },
        { kind: 'pills', items: [{ label: attack, tone: 'neutral' }] },
        { kind: 'kpi', items: [{ value: attack, label: attack }] },
        { kind: 'callout', tone: 'neutral', title: attack, body: attack },
        { kind: 'lane', title: attack, body: attack },
        { kind: 'steps', items: [attack] },
        { kind: 'bars', unit: attack, series: [{ label: attack, value: 1 }], max: 1 },
        { kind: 'diagram', lang: attack, body: attack },
      ],
    }],
    sources: [{ n: 1, text: attack, url: `https://example.com/?q=${attack}&attr=" onerror="alert(2)` }],
  }));
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.doesNotMatch(html, /<[a-z][^<>&]*\sonerror\s*=/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /onerror=alert\(2\)/);
});

test('richpage bars SVG 按 value/max 生成正确宽度并夹在 0%-100%', () => {
  const html = blockHtml(validRichpage({
    sections: [{ id: 'bars', heading: '比例', items: [{
      kind: 'bars', unit: '条', max: 40,
      series: [{ label: '一半', value: 20 }, { label: '超出', value: 80 }, { label: '负数', value: -4 }],
    }] }],
  }));
  assert.match(html, /class="rp-bar-fill"[^>]*width="50%"/);
  assert.match(html, /class="rp-bar-fill"[^>]*width="100%"/);
  assert.match(html, /class="rp-bar-fill"[^>]*width="0%"/);
});

test('richpage lint 覆盖 summary、空节、正文 URL、超长无子结构四类 warning', () => {
  const warnings = lintBlock(validRichpage({
    summary: undefined,
    sections: [
      { id: 'empty', heading: '空节', items: [] },
      { id: 'url', heading: '链接', items: [{ kind: 'md', body: '见 https://example.com/path' }] },
      { id: 'long', heading: '长文', items: [{ kind: 'md', body: '长'.repeat(1501) }] },
    ],
  }));
  assert.deepEqual(
    warnings.map((warning) => warning.rule).sort(),
    ['richpage-empty-section', 'richpage-inline-url', 'richpage-long-prose', 'richpage-missing-summary'].sort(),
  );
});

test('richpage hash 覆盖 title/summary/sections/sources，跨轮按 section id 标亮', () => {
  const base = validRichpage();
  for (const changed of [
    { ...base, title: '新标题' },
    { ...base, summary: '新摘要' },
    { ...base, sections: [{ ...base.sections[0], heading: '新节标题' }] },
    { ...base, sources: [{ ...base.sources[0], text: '新来源' }] },
  ]) {
    assert.notEqual(blockFingerprint(base), blockFingerprint(changed));
  }

  const changed = { ...base, sections: [
    base.sections[0],
    { id: 'roadmap', heading: '路线', items: [{ kind: 'md', body: '新内容' }] },
  ] };
  const previous = { ...base, sections: [
    base.sections[0],
    { id: 'roadmap', heading: '路线', items: [{ kind: 'md', body: '旧内容' }] },
  ] };
  const [diffed] = computeDiff([changed], [previous]);
  const html = blockHtml(diffed);
  assert.equal(diffed._change, 'changed');
  assert.ok(Array.isArray(diffed._prev.sections));
  assert.match(html, /id="rp-b-panorama-built"[^>]*data-section-change="unchanged"/);
  assert.match(html, /id="rp-b-panorama-roadmap"[^>]*data-section-change="changed"/);
});

test('submit-payload 保留 richpage 节级与选区级锚点', () => {
  assert.deepEqual(feedbackItems({
    'b-panorama': {
      comments: [
        { id: 'c1', sectionId: 'roadmap', quote: null, text: '节级意见', done: true },
        { id: 'c2', sectionId: 'roadmap', quote: '三件先试', text: '选区意见', done: true },
      ],
    },
  }), [
    { blockId: 'b-panorama', type: 'pin', value: { sectionId: 'roadmap' }, comment: '节级意见' },
    { blockId: 'b-panorama', type: 'pin', value: { sectionId: 'roadmap', quote: '三件先试' }, comment: '选区意见' },
  ]);
});

test('决策背景中的 [[#section-id]] 渲染成 richpage 页内锚点链接', () => {
  const html = blockHtml({
    id: 'b-choice', type: 'choice', title: '顺序', needsDecision: true,
    background: '先看 [[#roadmap]] 再决定。', why: '需要排序。',
    options: [{ id: 'a', label: '先做 A', pros: ['快'], cons: ['范围窄'] }],
  });
  assert.match(html, /<a href="#roadmap" data-rp-section-ref="roadmap">roadmap<\/a>/);
});

test('VibeLoop panorama 示例可 present，含一页叙事与三张决策卡且无可执行内容', () => {
  const file = path.resolve(testDir, '../../examples/richpage-vibeloop-panorama.json');
  const content = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(validateContent(content), { ok: true, errors: [] });
  assert.equal(content.blocks.filter((block) => block.type === 'richpage').length, 1);
  assert.equal(content.blocks.filter((block) => block.type === 'choice').length, 3);
  const html = content.blocks.map((block) => blockHtml(block)).join('\n');
  assert.doesNotMatch(html, /<(?:script|iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /<[a-z][^<>&]*\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /href="javascript:/i);
});
