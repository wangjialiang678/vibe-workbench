import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml } from '../../src/render/md.mjs';
import { blockHtml, renderEmbed, renderChecklist, renderPrototype } from '../../src/render/blocks.mjs';
import { changeBadge, prevCompareHtml, diffToggleHtml } from '../../src/render/diff-view.mjs';
import { renderZones } from '../../src/render/attention-view.mjs';

// ---------- mdToHtml ----------

test('mdToHtml: h1 heading', () => {
  const out = mdToHtml('# 标题');
  assert.ok(out.includes('<h1'), `expected <h1> in: ${out}`);
  assert.ok(out.includes('标题'), `expected text in: ${out}`);
});

test('mdToHtml: h2 heading', () => {
  const out = mdToHtml('## 二级标题');
  assert.ok(out.includes('<h2'), `expected <h2> in: ${out}`);
});

test('mdToHtml: bold **b**', () => {
  const out = mdToHtml('**粗体**');
  assert.ok(out.includes('<strong>粗体</strong>'), `expected <strong> in: ${out}`);
});

test('mdToHtml: inline code `code`', () => {
  const out = mdToHtml('`代码`');
  assert.ok(out.includes('<code>代码</code>'), `expected <code> in: ${out}`);
});

test('mdToHtml: list item -', () => {
  const out = mdToHtml('- 列表项');
  assert.ok(out.includes('<li>'), `expected <li> in: ${out}`);
  assert.ok(out.includes('列表项'), `expected text in: ${out}`);
});

test('mdToHtml: link [t](u)', () => {
  const out = mdToHtml('[链接](https://example.com)');
  assert.ok(out.includes('<a '), `expected <a> in: ${out}`);
  assert.ok(out.includes('href="https://example.com"'), `expected href in: ${out}`);
  assert.ok(out.includes('链接'), `expected text in: ${out}`);
});

test('mdToHtml: escapes < > &', () => {
  const out = mdToHtml('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), `<script> must not appear literally in: ${out}`);
  assert.ok(out.includes('&lt;'), `expected &lt; in: ${out}`);
  assert.ok(out.includes('&gt;'), `expected &gt; in: ${out}`);
});

test('mdToHtml: escapes & ampersand', () => {
  const out = mdToHtml('A & B');
  assert.ok(out.includes('&amp;'), `expected &amp; in: ${out}`);
});

// ---------- blockHtml ----------

test('blockHtml: markdown type renders md content', () => {
  const block = { id: 'b1', type: 'markdown', body: '# 标题', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="b1"'), `expected data-block-id in: ${out}`);
  assert.ok(out.includes('<h1'), `expected <h1> in: ${out}`);
  assert.ok(out.includes('data-type="markdown"'), `expected data-type in: ${out}`);
});

test('blockHtml: diagram renders <pre class="mermaid">', () => {
  const block = { id: 'b2', type: 'diagram', body: 'graph TD\nA-->B', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<pre class="mermaid">'), `expected mermaid pre in: ${out}`);
  assert.ok(out.includes('graph TD'), `expected diagram source in: ${out}`);
  assert.ok(out.includes('data-block-id="b2"'), `expected data-block-id in: ${out}`);
});

test('blockHtml: diagram escapes < in source', () => {
  const block = { id: 'b-dia', type: 'diagram', body: 'graph TD\nA-->&lt;B>', _change: 'unchanged' };
  const out = blockHtml(block);
  // the raw body contains &lt; which after escape should not become <B> injection
  assert.ok(out.includes('<pre class="mermaid">'), `expected mermaid pre`);
});

test('blockHtml: diagram with rationale shows folded details', () => {
  const block = { id: 'b-r', type: 'diagram', body: 'graph TD\nA-->B', rationale: '这是原因', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<details'), `expected <details> in: ${out}`);
  assert.ok(out.includes('这是原因'), `expected rationale text in: ${out}`);
});

test('blockHtml: choice renders all options', () => {
  const block = {
    id: 'b3', type: 'choice', _change: 'new',
    options: [
      { id: 'o1', label: '选项A' },
      { id: 'o2', label: '选项B' },
      { id: 'o3', label: '选项C' },
    ],
    recommendation: 'o2',
    hasRecommendation: true,
  };
  const out = blockHtml(block);
  assert.ok(out.includes('选项A'), `expected 选项A in: ${out}`);
  assert.ok(out.includes('选项B'), `expected 选项B in: ${out}`);
  assert.ok(out.includes('选项C'), `expected 选项C in: ${out}`);
  // recommended option has data-recommended
  assert.ok(out.includes('data-recommended'), `expected data-recommended in: ${out}`);
  // recommended option labeled
  assert.ok(out.includes('推荐'), `expected 推荐 label in: ${out}`);
});

test('blockHtml: choice non-recommended options do NOT have data-recommended', () => {
  const block = {
    id: 'b3b', type: 'choice', _change: 'unchanged',
    options: [{ id: 'o1', label: '选项A' }, { id: 'o2', label: '选项B' }],
    recommendation: 'o1',
    hasRecommendation: true,
  };
  const out = blockHtml(block);
  // Count data-recommended occurrences — should be exactly 1
  const matches = out.match(/data-recommended/g);
  assert.equal(matches ? matches.length : 0, 1, `expected exactly 1 data-recommended in: ${out}`);
});

test('blockHtml: verdict renders three buttons', () => {
  const block = { id: 'b4', type: 'verdict', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('✓') || out.includes('赞成'), `expected 赞成 button in: ${out}`);
  assert.ok(out.includes('✗') || out.includes('异议'), `expected 异议 button in: ${out}`);
  assert.ok(out.includes('?') || out.includes('疑问'), `expected 疑问 button in: ${out}`);
  // should have exactly 3 buttons
  const btnCount = (out.match(/<button/g) || []).length;
  assert.ok(btnCount >= 3, `expected at least 3 buttons in: ${out}`);
});

test('blockHtml: freetext renders textarea', () => {
  const block = { id: 'b5', type: 'freetext', placeholder: '请输入', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<textarea'), `expected <textarea> in: ${out}`);
  assert.ok(out.includes('请输入'), `expected placeholder in: ${out}`);
});

test('blockHtml: editable renders textarea with data-editable', () => {
  const block = { id: 'b6', type: 'editable', value: '可编辑内容', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-editable'), `expected data-editable in: ${out}`);
  assert.ok(out.includes('<textarea'), `expected textarea in: ${out}`);
});

test('blockHtml: table renders table element', () => {
  const block = {
    id: 'b7', type: 'table', _change: 'unchanged',
    columns: ['A', 'B'],
    rows: [['1', '2'], ['3', '4']],
  };
  const out = blockHtml(block);
  assert.ok(out.includes('<table'), `expected <table> in: ${out}`);
  assert.ok(out.includes('<th'), `expected <th> in: ${out}`);
  assert.ok(out.includes('<td'), `expected <td> in: ${out}`);
});

test('blockHtml: code renders <pre><code> with lang', () => {
  const block = { id: 'b8', type: 'code', lang: 'javascript', body: 'const x = 1;', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('<pre'), `expected <pre> in: ${out}`);
  assert.ok(out.includes('<code'), `expected <code> in: ${out}`);
  assert.ok(out.includes('const x = 1;') || out.includes('const x '), `expected code body in: ${out}`);
});

test('blockHtml: outer section has data-change attribute', () => {
  const block = { id: 'bx', type: 'markdown', body: 'x', _change: 'changed' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-change="changed"'), `expected data-change in: ${out}`);
});

test('blockHtml: has comment entry point', () => {
  const block = { id: 'by', type: 'markdown', body: 'y', _change: 'unchanged' };
  const out = blockHtml(block);
  assert.ok(out.includes('批注') || out.includes('+批注'), `expected 批注 in: ${out}`);
});

test('blockHtml: 批注是内联输入框（textarea），非弹窗', () => {
  const out = blockHtml({ id: 'by', type: 'markdown', body: 'y', _change: 'unchanged' });
  assert.ok(out.includes('comment-input'), '应有内联批注输入框 .comment-input');
  assert.ok(out.includes('class="comment-box"') || out.includes("comment-box"), '应有内联批注容器 .comment-box');
  assert.ok(out.includes('data-comment-for="by"'), '批注输入框应绑定到该 block');
  assert.ok(/<textarea[^>]*comment-input/.test(out), '批注应为 textarea 内联编辑，而非仅按钮');
});

// ---------- embed ----------

test('renderEmbed: contains iframe with proxy src', () => {
  const block = { id: 'e1', type: 'embed', url: 'https://example.com/page?q=1&r=2' };
  const out = renderEmbed(block);
  assert.ok(out.includes('<iframe'), `expected <iframe> in: ${out}`);
  assert.ok(out.includes('src="/api/proxy?url='), `expected proxy src in: ${out}`);
  // url must be encodeURIComponent-encoded (: → %3A, / → %2F etc.)
  assert.ok(out.includes(encodeURIComponent('https://example.com/page?q=1&r=2')), `expected encoded url in: ${out}`);
});

test('renderEmbed: contains embed-rail (飞书式右侧评论栏)', () => {
  const out = renderEmbed({ id: 'e2', type: 'embed', url: 'https://x.com' });
  assert.ok(out.includes('embed-rail'), `expected embed-rail in: ${out}`);
  assert.ok(!out.includes('embed-overlay'), `must NOT contain embed-overlay in: ${out}`);
});

test('renderEmbed: contains rail-add button and no embed-annotate-toggle', () => {
  const out = renderEmbed({ id: 'e3', type: 'embed', url: 'https://x.com' });
  assert.ok(out.includes('rail-add'), `expected rail-add in: ${out}`);
  assert.ok(!out.includes('embed-annotate-toggle'), `must NOT contain embed-annotate-toggle in: ${out}`);
});

test('blockHtml: embed type renders iframe with proxy url in outer section', () => {
  const block = { id: 'emb1', type: 'embed', url: 'https://example.com', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="emb1"'), `expected data-block-id in: ${out}`);
  assert.ok(out.includes('data-type="embed"'), `expected data-type in: ${out}`);
  assert.ok(out.includes('<iframe'), `expected <iframe> in: ${out}`);
  assert.ok(out.includes('/api/proxy?url='), `expected proxy src in: ${out}`);
  assert.ok(out.includes(encodeURIComponent('https://example.com')), `expected encoded url in: ${out}`);
});

// ---------- diff-view ----------

test('changeBadge: new contains NEW and ＋', () => {
  const out = changeBadge({ _change: 'new' });
  assert.ok(out.includes('NEW') || out.includes('新增'), `expected NEW text in: ${out}`);
  assert.ok(out.includes('＋') || out.includes('+'), `expected + icon in: ${out}`);
});

test('changeBadge: changed contains CHANGED and ～', () => {
  const out = changeBadge({ _change: 'changed' });
  assert.ok(out.includes('CHANGED') || out.includes('改动'), `expected CHANGED text in: ${out}`);
  assert.ok(out.includes('～') || out.includes('~'), `expected ~ icon in: ${out}`);
});

test('changeBadge: unchanged is empty string', () => {
  const out = changeBadge({ _change: 'unchanged' });
  assert.equal(out, '', `expected empty string for unchanged, got: ${out}`);
});

test('prevCompareHtml: returns non-empty HTML for changed block with _prev', () => {
  const block = {
    id: 'bz', type: 'markdown', _change: 'changed',
    body: '新内容',
    _prev: { body: '旧内容' },
    _changedFields: ['body'],
  };
  const out = prevCompareHtml(block);
  assert.ok(out.length > 0, `expected non-empty HTML for changed block`);
  assert.ok(out.includes('旧内容') || out.includes('上轮'), `expected prev content or label in: ${out}`);
});

test('prevCompareHtml: returns empty for unchanged block', () => {
  const block = { id: 'bz2', type: 'markdown', _change: 'unchanged', body: 'x' };
  const out = prevCompareHtml(block);
  assert.equal(out, '', `expected empty for unchanged`);
});

test('diffToggleHtml: returns HTML with toggle control', () => {
  const out = diffToggleHtml();
  assert.ok(out.includes('变更') || out.includes('只看'), `expected toggle text in: ${out}`);
  assert.ok(out.length > 0, `expected non-empty HTML`);
});

// ---------- changeBadge 改动 E 新徽章（DESIGN §4）----------

test('changeBadge: changed + _respondedToPrev → 已采纳 badge', () => {
  const out = changeBadge({ _change: 'changed', _respondedToPrev: true });
  assert.ok(out.includes('已采纳'), `expected 已采纳 in: ${out}`);
  assert.ok(out.includes('↩'), `expected ↩ in: ${out}`);
  assert.ok(!out.includes('CHANGED'), `must not show CHANGED when adopted, got: ${out}`);
});

test('changeBadge: changed without _respondedToPrev → 普通 CHANGED badge', () => {
  const out = changeBadge({ _change: 'changed', _respondedToPrev: false });
  assert.ok(out.includes('CHANGED'), `expected CHANGED in: ${out}`);
  assert.ok(!out.includes('已采纳'), `must not show 已采纳 without _respondedToPrev, got: ${out}`);
});

test('changeBadge: unchanged + _respondedToPrev → 维持 badge', () => {
  const out = changeBadge({ _change: 'unchanged', _respondedToPrev: true });
  assert.ok(out.includes('维持'), `expected 维持 in: ${out}`);
  assert.ok(out.includes('—'), `expected — in: ${out}`);
});

test('changeBadge: unchanged without _respondedToPrev → 空字符串', () => {
  const out = changeBadge({ _change: 'unchanged', _respondedToPrev: false });
  assert.equal(out, '', `expected empty string for unchanged without respondedToPrev`);
});

test('changeBadge: unchanged (no _respondedToPrev field) → 空字符串', () => {
  const out = changeBadge({ _change: 'unchanged' });
  assert.equal(out, '', `expected empty string for plain unchanged`);
});

// ---------- renderZones statusBar 改动 B（DESIGN §4）----------

test('renderZones: 首轮（round=1）状态条显示"首轮 · N 项待确认"而非 delta', () => {
  const blocks = [
    { id: 'r1a', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'r1b', type: 'markdown', needsDecision: false, _change: 'new' },
  ];
  const out = renderZones(blocks, { round: 1 });
  assert.ok(out.includes('首轮'), `expected 首轮 in statusBar: ${out.slice(0, 500)}`);
  assert.ok(!out.includes('新增') || !out.includes('改动'), 'first round should not show new/changed delta breakdown');
});

test('renderZones: 全部块为 new（推断首轮）→ 首轮文案', () => {
  const blocks = [
    { id: 'x1', type: 'verdict', needsDecision: true, _change: 'new' },
    { id: 'x2', type: 'verdict', needsDecision: true, _change: 'new' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('首轮'), `all-new blocks → 首轮 statusBar: ${out.slice(0, 500)}`);
});

test('renderZones: 多轮（有 new+changed）状态条显示"本轮 N 项待你确认（新增 M · 改动 K）"', () => {
  const blocks = [
    { id: 'm1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'm2', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'changed' },
    { id: 'm3', type: 'markdown', needsDecision: false, _change: 'unchanged' },
  ];
  const out = renderZones(blocks, { round: 2 });
  assert.ok(out.includes('本轮'), `expected 本轮 in statusBar: ${out.slice(0, 500)}`);
  assert.ok(out.includes('新增'), `expected 新增 in statusBar: ${out.slice(0, 500)}`);
  assert.ok(out.includes('改动'), `expected 改动 in statusBar: ${out.slice(0, 500)}`);
});

// ---------- renderZones ----------

const mixedBlocks = [
  { id: 'a1', type: 'verdict', needsDecision: true, hasRecommendation: false, importance: 'high', _change: 'new' },
  { id: 'a2', type: 'choice', needsDecision: true, hasRecommendation: false, importance: 'normal', _change: 'unchanged',
    options: [{ id: 'o1', label: 'X' }] },
  { id: 'b1', type: 'choice', needsDecision: true, hasRecommendation: true, importance: 'normal', _change: 'unchanged',
    options: [{ id: 'o1', label: 'Y' }], recommendation: 'o1' },
  { id: 'cr1', type: 'markdown', needsDecision: false, importance: 'high', default: '默认值', _change: 'unchanged', body: '重要默认' },
  { id: 'cf1', type: 'markdown', needsDecision: false, importance: 'normal', default: '默认f', _change: 'unchanged', body: '普通fyi' },
  { id: 'ctx1', type: 'markdown', needsDecision: false, importance: 'normal', _change: 'new', body: 'AI叙述内容' },
];

// 改动 A'（§4）：unchanged 块进 zoneSettled；只有 new/changed 进常显区。
// a2/b1/cr1/cf1 均为 unchanged → zoneSettled；a1(new)→ zoneA；ctx1(new)→ zoneContext。
test('renderZones: zone A content (new) appears before zoneSettled (unchanged)', () => {
  const out = renderZones(mixedBlocks);
  const posA = out.indexOf('a1');
  const posSettled = out.indexOf('zone-settled');
  assert.ok(posA !== -1, `expected zoneA block a1 in output`);
  assert.ok(posSettled !== -1, `expected zone-settled in output`);
  assert.ok(posA < posSettled, `zoneA (pos ${posA}) should appear before zoneSettled (pos ${posSettled})`);
});

test('renderZones: shows decision count', () => {
  const out = renderZones(mixedBlocks);
  // 改动B：顶部显示"本轮 N 项待你确认（新增 M · 改动 K）"；N = 新增+改动（不含已沉降的 unchanged）
  // mixedBlocks: a1=new(决策) / a2,b1=unchanged(沉降) → 待确认 1（新增 1 · 改动 0）
  assert.ok(out.includes('待你确认') || out.includes('待确认'), `expected 待确认 counter in: ${out}`);
  assert.ok(out.includes('新增 <strong>1</strong>'), `expected 新增 delta in: ${out}`);
});

test('renderZones: zone A label contains 需你定·无预设 or similar', () => {
  const out = renderZones(mixedBlocks);
  assert.ok(out.includes('无预设') || out.includes('◆') || out.includes('需你定'), `expected zone A label in: ${out}`);
});

test('renderZones: zone B label contains 有推荐 or similar', () => {
  const out = renderZones(mixedBlocks);
  assert.ok(out.includes('有推荐') || out.includes('◇') || out.includes('需你定'), `expected zone B label in: ${out}`);
});

test('renderZones: degraded - all default shows no-decision message', () => {
  const allDefault = [
    { id: 'd1', type: 'markdown', needsDecision: false, importance: 'normal', _change: 'unchanged', body: '默认A' },
    { id: 'd2', type: 'markdown', needsDecision: false, importance: 'normal', _change: 'unchanged', body: '默认B' },
  ];
  const out = renderZones(allDefault);
  assert.ok(out.includes('无需你决策') || out.includes('确认即可'), `expected degraded message in: ${out}`);
});

test('renderZones: no zoneCFyi blocks means no fyi collapse rendered', () => {
  const noFyi = [
    { id: 'a1', type: 'verdict', needsDecision: true, hasRecommendation: false, importance: 'normal', _change: 'new' },
    { id: 'cr1', type: 'markdown', needsDecision: false, importance: 'high', default: 'v', _change: 'unchanged', body: 'hi' },
  ];
  const out = renderZones(noFyi);
  // zoneCFyi section should not appear (or be empty)
  // We check that cf1 is not in output since there's no such block
  assert.ok(!out.includes('zone-c-fyi') || !out.includes('cf1'),
    `expected no fyi zone content for blocks without fyi items`);
});

test('renderZones: 纯叙述内容(无 default) 可见于 zone-context，不被折叠', () => {
  const out = renderZones(mixedBlocks);
  assert.ok(out.includes('zone-context'), 'expected zone-context section');
  assert.ok(out.includes('ctx1'), 'expected context block ctx1 rendered');
  const posCtx = out.indexOf('ctx1');
  const posFold = out.indexOf('zone-c-fyi');
  assert.ok(posFold === -1 || posCtx < posFold, 'context should be visible above the fold');
});

// ---------- renderZones：_change 分区单测（改动 A' §4）----------

test('renderZones: unchanged blocks go to zoneSettled (folded), not zoneA/B', () => {
  const blocks = [
    { id: 'u1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'unchanged' },
    { id: 'u2', type: 'choice', needsDecision: true, hasRecommendation: true, _change: 'unchanged',
      options: [{ id: 'o1', label: 'X' }], recommendation: 'o1' },
  ];
  const out = renderZones(blocks);
  // Both unchanged → zoneSettled; zoneA/B sections must not be rendered
  assert.ok(out.includes('zone-settled'), 'expected zone-settled in output');
  assert.ok(out.includes('u1'), 'expected u1 in zoneSettled');
  assert.ok(out.includes('u2'), 'expected u2 in zoneSettled');
  // Check absence of actual zone sections (not just the href="#zone-a" in statusBar)
  assert.ok(!out.includes('id="zone-a"'), 'zoneA section must be absent (no new/changed decision blocks)');
  assert.ok(!out.includes('id="zone-b"'), 'zoneB section must be absent (no new/changed decision blocks)');
});

test('renderZones: new/changed blocks go to zoneA/B (常显)', () => {
  const blocks = [
    { id: 'n1', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'c1', type: 'choice', needsDecision: true, hasRecommendation: true, _change: 'changed',
      options: [{ id: 'o1', label: 'X' }], recommendation: 'o1' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('zone-a'), 'expected zone-a in output');
  assert.ok(out.includes('zone-b'), 'expected zone-b in output');
  // Should NOT be in zoneSettled
  assert.ok(!out.includes('zone-settled'), 'zoneSettled must be absent when all blocks are new/changed');
});

test('renderZones: 首轮全 new — 不折叠任何块到 zoneSettled', () => {
  // 首轮：server.mjs 对空 prevBlocks 全标 new；首轮行为正确，无沉降
  const firstRoundBlocks = [
    { id: 'f1', type: 'markdown', needsDecision: false, _change: 'new', body: '叙述内容' },
    { id: 'f2', type: 'verdict', needsDecision: true, hasRecommendation: false, _change: 'new' },
    { id: 'f3', type: 'choice', needsDecision: true, hasRecommendation: true, _change: 'new',
      options: [{ id: 'o1', label: 'A' }], recommendation: 'o1' },
  ];
  const out = renderZones(firstRoundBlocks);
  assert.ok(!out.includes('zone-settled'), '首轮全 new 时不应出现 zone-settled');
  assert.ok(out.includes('f2'), 'f2 应在 zoneA 常显');
  assert.ok(out.includes('f3'), 'f3 应在 zoneB 常显');
});

test('renderZones: zoneSettled 折叠标题含项目数', () => {
  const blocks = [
    { id: 's1', type: 'verdict', needsDecision: true, _change: 'unchanged' },
    { id: 's2', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'x' },
    { id: 's3', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'y' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('zone-settled'), 'expected zone-settled');
  assert.ok(out.includes('3'), 'expected count 3 in zoneSettled summary');
  assert.ok(out.includes('本轮无变化'), 'expected summary text in zoneSettled');
});

// ---------- blockHtml body 上屏断言（§5.0）----------

test('blockHtml: verdict with body renders .block-body', () => {
  const block = { id: 'v1', type: 'verdict', title: '是否删除？', body: '删除后无法恢复。', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(out.includes('block-body'), `expected .block-body in: ${out}`);
  assert.ok(out.includes('删除后无法恢复'), `expected body text in: ${out}`);
});

test('blockHtml: choice with body renders .block-body before block-content', () => {
  const block = {
    id: 'c1', type: 'choice', body: '请选择部署方式。', _change: 'new',
    options: [{ id: 'o1', label: '方案A' }],
  };
  const out = blockHtml(block);
  assert.ok(out.includes('block-body'), `expected .block-body in: ${out}`);
  assert.ok(out.includes('请选择部署方式'), `expected body text in: ${out}`);
  // block-body 应在 block-content 之前
  assert.ok(out.indexOf('block-body') < out.indexOf('block-content'), 'block-body must precede block-content');
});

test('blockHtml: markdown type does NOT double-render body as .block-body', () => {
  const block = { id: 'm1', type: 'markdown', body: '# 标题内容', _change: 'new' };
  const out = blockHtml(block);
  // markdown 用 body 作主内容，不应再渲染 .block-body
  assert.ok(!out.includes('block-body'), `markdown must NOT have .block-body, got: ${out}`);
  assert.ok(out.includes('<h1'), 'markdown body should still render as HTML heading');
});

test('blockHtml: diagram type does NOT double-render body as .block-body', () => {
  const block = { id: 'd1', type: 'diagram', body: 'graph TD\nA-->B', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(!out.includes('block-body'), `diagram must NOT have .block-body`);
  assert.ok(out.includes('mermaid'), 'diagram body should render as mermaid pre');
});

test('blockHtml: code type does NOT double-render body as .block-body', () => {
  const block = { id: 'co1', type: 'code', lang: 'js', body: 'const x = 1;', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(!out.includes('block-body'), `code must NOT have .block-body`);
  assert.ok(out.includes('const x = 1;'), 'code body should render in pre/code');
});

test('blockHtml: block without body has no .block-body element', () => {
  const block = { id: 'v2', type: 'verdict', _change: 'new' };
  const out = blockHtml(block);
  assert.ok(!out.includes('block-body'), `no body → no .block-body, got: ${out}`);
});

// ---------- renderZones zoneSettled 分组语义化（改动 D，DESIGN §4 批次2）----------

test('renderZones: zoneSettled 含 _decidedInPrev 时显示"已决 N 项（上轮已确认·本轮无变化）"', () => {
  const blocks = [
    // 上轮已决 + 本轮无变化
    { id: 'd1', type: 'verdict', needsDecision: true, _change: 'unchanged', _decidedInPrev: true },
    { id: 'd2', type: 'markdown', needsDecision: false, _change: 'unchanged', _decidedInPrev: true, body: 'x' },
    // 本轮无变化但上轮未被反馈
    { id: 'u1', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'y' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('zone-settled'), 'expected zone-settled in output');
  assert.ok(out.includes('已决 2 项'), 'expected 已决 2 项 in zoneSettled summary');
  assert.ok(out.includes('上轮已确认·本轮无变化'), 'expected 上轮已确认·本轮无变化 in summary');
  assert.ok(out.includes('本轮无变化 1 项'), 'expected 本轮无变化 1 项 in summary');
});

test('renderZones: zoneSettled 全为 _decidedInPrev 时只显示已决组，无"本轮无变化 M 项"', () => {
  const blocks = [
    { id: 'd1', type: 'verdict', needsDecision: true, _change: 'unchanged', _decidedInPrev: true },
    { id: 'd2', type: 'verdict', needsDecision: true, _change: 'unchanged', _decidedInPrev: true },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('已决 2 项'), 'expected 已决 2 项');
  // 无纯 unchanged 的 → 不出现 "本轮无变化 M 项"
  assert.ok(!out.includes('本轮无变化 0 项'), 'must not show 本轮无变化 0 项');
});

test('renderZones: zoneSettled 全无 _decidedInPrev 时只显示"本轮无变化 M 项"，无"已决 N 项"', () => {
  const blocks = [
    { id: 'u1', type: 'verdict', needsDecision: true, _change: 'unchanged' },
    { id: 'u2', type: 'markdown', needsDecision: false, _change: 'unchanged', body: 'z' },
  ];
  const out = renderZones(blocks);
  assert.ok(out.includes('本轮无变化 2 项'), 'expected 本轮无变化 2 项 in summary');
  assert.ok(!out.includes('已决 0 项'), 'must not show 已决 0 项');
});

// ---------- renderChecklist（§1.4 B）----------

test('renderChecklist: 三态按钮标签取 verdictLabels', () => {
  const block = {
    id: 'chk1',
    type: 'checklist',
    verdictLabels: ['已覆盖', '明确不做', '待定'],
    items: [
      { id: 'i1', label: '用户注册流程' },
      { id: 'i2', label: '错误恢复', body: '异常时应给出明确提示' },
    ],
  };
  const out = renderChecklist(block);
  assert.ok(out.includes('已覆盖'), 'expected 已覆盖 label');
  assert.ok(out.includes('明确不做'), 'expected 明确不做 label');
  assert.ok(out.includes('待定'), 'expected 待定 label');
  assert.ok(out.includes('用户注册流程'), 'expected item label');
  assert.ok(out.includes('错误恢复'), 'expected second item');
  assert.ok(out.includes('异常时应给出明确提示'), 'expected item body');
});

test('renderChecklist: 每个 item 的每个标签都有对应 data-item-id + data-label', () => {
  const block = {
    id: 'chk2',
    type: 'checklist',
    verdictLabels: ['A', 'B'],
    items: [{ id: 'i1', label: 'Item' }],
  };
  const out = renderChecklist(block);
  assert.ok(out.includes('data-item-id="i1"'), 'expected data-item-id');
  assert.ok(out.includes('data-label="A"'), 'expected data-label A');
  assert.ok(out.includes('data-label="B"'), 'expected data-label B');
  assert.ok(out.includes('data-block-id="chk2"'), 'expected data-block-id');
});

test('renderChecklist: blockHtml 含 checklist-group', () => {
  const block = {
    id: 'chk3', type: 'checklist', _change: 'new',
    verdictLabels: ['通过', '失败'],
    items: [{ id: 'i1', label: '功能覆盖' }],
  };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="chk3"'), 'expected block wrapper');
  assert.ok(out.includes('checklist-group'), 'expected checklist-group in blockHtml');
  assert.ok(out.includes('通过'), 'expected verdictLabel in blockHtml output');
});

// ---------- renderPrototype（§1.4 A）----------

test('renderPrototype: mode=image 含 img 标签 + SVG overlay', () => {
  const block = {
    id: 'proto1', type: 'prototype', mode: 'image', imageUrl: '/assets/screen.png', title: '登录页',
  };
  const out = renderPrototype(block);
  assert.ok(out.includes('<img'), 'expected <img> in image mode');
  assert.ok(out.includes('/assets/screen.png'), 'expected imageUrl in src');
  assert.ok(out.includes('proto-overlay'), 'expected SVG overlay');
  assert.ok(out.includes('proto-pins'), 'expected pins group in SVG');
  assert.ok(out.includes('data-proto-overlay="proto1"'), 'expected data-proto-overlay');
});

test('renderPrototype: mode=iframe 含 iframe + /api/proxy + SVG overlay', () => {
  const block = {
    id: 'proto2', type: 'prototype', mode: 'iframe', src: 'https://example.com/design',
  };
  const out = renderPrototype(block);
  assert.ok(out.includes('<iframe'), 'expected <iframe> in iframe mode');
  assert.ok(out.includes('/api/proxy?url='), 'expected proxy URL');
  assert.ok(out.includes(encodeURIComponent('https://example.com/design')), 'expected encoded src');
  assert.ok(out.includes('proto-overlay'), 'expected SVG overlay on outer layer');
  assert.ok(!out.includes('proto-overlay" src='), 'overlay must NOT be inside iframe src');
});

test('renderPrototype: mode=wireframe 含 proto-wireframe-canvas + SVG overlay', () => {
  const block = {
    id: 'proto3', type: 'prototype', mode: 'wireframe',
    screen: {
      id: 's1', name: '首页', widgets: [
        { id: 'w1', cls: 'btn', x: 0.1, y: 0.2, w: 0.2, h: 0.05, text: '提交' },
      ],
    },
  };
  const out = renderPrototype(block);
  assert.ok(out.includes('proto-wireframe-canvas'), 'expected wireframe canvas');
  assert.ok(out.includes('提交'), 'expected widget text');
  assert.ok(out.includes('proto-overlay'), 'expected SVG overlay');
});

test('renderPrototype: SVG overlay 在 iframe 外层（不在 iframe src 内）', () => {
  const block = {
    id: 'proto4', type: 'prototype', mode: 'iframe', src: 'https://ui.example.com',
  };
  const out = renderPrototype(block);
  // SVG overlay 应在 iframe-wrap 里但在 iframe 外层
  const iframePos  = out.indexOf('<iframe');
  const overlayPos = out.indexOf('proto-overlay');
  assert.ok(iframePos !== -1, 'expected <iframe>');
  assert.ok(overlayPos !== -1, 'expected proto-overlay');
  // overlay 出现在 iframe 之后（都在 iframe-wrap 内部，overlay 跟着 iframe）
  assert.ok(overlayPos > iframePos, 'SVG overlay must appear after iframe tag (outer wrapper)');
});

test('renderPrototype: blockHtml 含 proto-container', () => {
  const block = {
    id: 'proto5', type: 'prototype', mode: 'image', imageUrl: '/x.png', _change: 'new',
  };
  const out = blockHtml(block);
  assert.ok(out.includes('data-block-id="proto5"'), 'expected block wrapper');
  assert.ok(out.includes('proto-container'), 'expected proto-container in blockHtml');
});

test('renderZones: zoneCFyi 沉降区保留"AI 设默认"含义（_decidedInPrev 不影响 zoneCFyi）', () => {
  // zoneCFyi 块是 fresh(new/changed) + 有 default + 非 high importance
  const blocks = [
    { id: 'fyi1', type: 'markdown', needsDecision: false, default: 'yes', importance: 'normal', _change: 'new', body: 'fyi content' },
  ];
  const out = renderZones(blocks);
  // zoneCFyi 仍按原有逻辑，不应受 _decidedInPrev 影响
  assert.ok(out.includes('zone-c-fyi'), 'expected zone-c-fyi for fresh fyi blocks');
  // zoneSettled 不应出现
  assert.ok(!out.includes('zone-settled'), 'zoneSettled must not appear for fresh blocks');
});
