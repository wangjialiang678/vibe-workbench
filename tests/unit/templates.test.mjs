import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import thinkDiscuss from '../../templates/think-discuss.mjs';
import devReview from '../../templates/dev-review.mjs';
import designReview from '../../templates/design-review.mjs';
import { validateBlock } from '../../src/protocol/schema.mjs';

// ── helpers ──────────────────────────────────────────────────────────────────

function assertAllBlocksValid(blocks) {
  for (const b of blocks) {
    const { ok, errors } = validateBlock(b);
    assert.equal(ok, true, `block id=${b.id} failed validation: ${errors.join('; ')}`);
  }
}

// ── think-discuss ─────────────────────────────────────────────────────────────

describe('thinkDiscuss', () => {
  const baseInput = {
    title: 'Test Session',
    thoughtMd: '## 思路\n这是一段思考内容。',
  };

  test('produces markdown block with id b-thought', () => {
    const blocks = thinkDiscuss(baseInput);
    const b = blocks.find((b) => b.id === 'b-thought');
    assert.ok(b, 'b-thought block missing');
    assert.equal(b.type, 'markdown');
    assert.equal(b.body, baseInput.thoughtMd);
  });

  test('produces diagram block for each diagram input', () => {
    const blocks = thinkDiscuss({
      ...baseInput,
      diagrams: [
        { key: 'arch', title: '架构图', mermaid: 'graph TD; A-->B', rationale: '说明' },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-diag-arch');
    assert.ok(b, 'b-diag-arch block missing');
    assert.equal(b.type, 'diagram');
    assert.equal(b.body, 'graph TD; A-->B');
    assert.equal(b.lang, 'mermaid');
  });

  test('decision without options produces verdict block with needsDecision===true', () => {
    const blocks = thinkDiscuss({
      ...baseInput,
      decisions: [
        { key: 'deploy', question: '是否部署？' },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-dec-deploy');
    assert.ok(b, 'b-dec-deploy block missing');
    assert.equal(b.type, 'verdict');
    assert.equal(b.needsDecision, true);
  });

  test('decision with options produces choice block with needsDecision===true', () => {
    const blocks = thinkDiscuss({
      ...baseInput,
      decisions: [
        {
          key: 'runtime',
          question: '选运行时？',
          options: [
            { id: 'opt-node', label: 'Node.js' },
            { id: 'opt-deno', label: 'Deno' },
          ],
        },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-dec-runtime');
    assert.ok(b, 'b-dec-runtime block missing');
    assert.equal(b.type, 'choice');
    assert.equal(b.needsDecision, true);
  });

  test('decision with recommend sets hasRecommendation===true and recommendation matches option id', () => {
    const blocks = thinkDiscuss({
      ...baseInput,
      decisions: [
        {
          key: 'storage',
          question: '选存储？',
          options: [
            { id: 'opt-fs', label: '文件系统' },
            { id: 'opt-db', label: '数据库' },
          ],
          recommend: 'opt-fs',
        },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-dec-storage');
    assert.ok(b, 'b-dec-storage block missing');
    assert.equal(b.hasRecommendation, true);
    assert.equal(b.recommendation, 'opt-fs');
  });

  test('decision importance defaults to normal and can be overridden', () => {
    const blocks = thinkDiscuss({
      ...baseInput,
      decisions: [
        { key: 'color', question: '选颜色？', importance: 'high' },
        { key: 'font', question: '选字体？' },
      ],
    });
    const high = blocks.find((b) => b.id === 'b-dec-color');
    const normal = blocks.find((b) => b.id === 'b-dec-font');
    assert.equal(high.importance, 'high');
    assert.equal(normal.importance, 'normal');
  });

  test('doc provided produces editable block with id b-doc', () => {
    const blocks = thinkDiscuss({
      ...baseInput,
      doc: '# 文档\n初稿内容。',
    });
    const b = blocks.find((b) => b.id === 'b-doc');
    assert.ok(b, 'b-doc block missing');
    assert.equal(b.type, 'editable');
    assert.equal(b.value, '# 文档\n初稿内容。');
    assert.equal(b.editable, true);
    assert.equal(b.needsDecision, false);
  });

  test('no doc → no b-doc block', () => {
    const blocks = thinkDiscuss(baseInput);
    assert.equal(blocks.find((b) => b.id === 'b-doc'), undefined);
  });

  test('block ids are stable across two calls with same input', () => {
    const input = {
      title: 'Stable',
      thoughtMd: 'content',
      diagrams: [{ key: 'seq', title: '时序', mermaid: 'seq A->B', rationale: '' }],
      decisions: [{ key: 'pick', question: '选择？' }],
      doc: '文档',
    };
    const ids1 = thinkDiscuss(input).map((b) => b.id);
    const ids2 = thinkDiscuss(input).map((b) => b.id);
    assert.deepEqual(ids1, ids2);
  });

  test('all blocks pass validateBlock', () => {
    const blocks = thinkDiscuss({
      title: 'Full',
      thoughtMd: '思考内容',
      diagrams: [{ key: 'flow', title: '流程', mermaid: 'graph LR; A-->B', rationale: '理由' }],
      decisions: [
        {
          key: 'opt-a',
          question: '问题A？',
          options: [
            { id: 'opt-yes', label: '是' },
            { id: 'opt-no', label: '否' },
          ],
          recommend: 'opt-yes',
          importance: 'high',
        },
        { key: 'no-opt', question: '简单问题？', importance: 'low' },
      ],
      doc: '文档内容',
    });
    assertAllBlocksValid(blocks);
  });

  test('slug handles special characters', () => {
    const blocks = thinkDiscuss({
      ...baseInput,
      diagrams: [{ key: 'hello world 123!', title: '测试', mermaid: '图', rationale: '' }],
    });
    const b = blocks.find((b) => b.id.startsWith('b-diag-'));
    assert.ok(b, 'diagram block missing');
    // slug should be lowercase, non-alnum → '-', dedup hyphens
    assert.equal(b.id, 'b-diag-hello-world-123-');
  });
});

// ── dev-review ────────────────────────────────────────────────────────────────

describe('devReview', () => {
  test('empty input produces empty array', () => {
    const blocks = devReview({});
    assert.equal(blocks.length, 0);
  });

  test('prdItem produces verdict block with needsDecision===true', () => {
    const blocks = devReview({
      prdItems: [
        { key: 'fr1', title: 'FR-1 用户登录', body: '用户可用邮箱密码登录。' },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-prd-fr1');
    assert.ok(b, 'b-prd-fr1 block missing');
    assert.equal(b.type, 'verdict');
    assert.equal(b.needsDecision, true);
  });

  test('prdItem importance defaults to normal', () => {
    const blocks = devReview({
      prdItems: [{ key: 'fr2', title: 'FR-2', body: '内容' }],
    });
    const b = blocks.find((b) => b.id === 'b-prd-fr2');
    assert.equal(b.importance, 'normal');
  });

  test('prdItem importance can be set to high', () => {
    const blocks = devReview({
      prdItems: [{ key: 'fr3', title: 'FR-3', body: '内容', importance: 'high' }],
    });
    const b = blocks.find((b) => b.id === 'b-prd-fr3');
    assert.equal(b.importance, 'high');
  });

  test('archDiagram produces diagram block', () => {
    const blocks = devReview({
      archDiagrams: [
        { key: 'system', title: '系统架构', mermaid: 'graph TD; A-->B', rationale: '分层' },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-arch-system');
    assert.ok(b, 'b-arch-system block missing');
    assert.equal(b.type, 'diagram');
    assert.equal(b.lang, 'mermaid');
    assert.equal(b.body, 'graph TD; A-->B');
  });

  test('output contains at least one diagram block when archDiagrams provided', () => {
    const blocks = devReview({
      archDiagrams: [
        { key: 'db', title: 'DB图', mermaid: 'erDiagram A ||--o{ B : has', rationale: '' },
      ],
    });
    assert.ok(blocks.some((b) => b.type === 'diagram'), 'no diagram block found');
  });

  test('testScenario produces block with id b-test-<slug>', () => {
    const blocks = devReview({
      testScenarios: [
        { key: 'login-ok', name: '正常登录', expect: '跳转首页' },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-test-login-ok');
    assert.ok(b, 'b-test-login-ok block missing');
  });

  test('block ids are stable across two calls with same input', () => {
    const input = {
      prdItems: [{ key: 'fr1', title: 'FR-1', body: '内容' }],
      archDiagrams: [{ key: 'arch', title: '架构', mermaid: 'graph', rationale: '' }],
      testScenarios: [{ key: 'tc1', name: '测试1', expect: '通过' }],
    };
    const ids1 = devReview(input).map((b) => b.id);
    const ids2 = devReview(input).map((b) => b.id);
    assert.deepEqual(ids1, ids2);
  });

  test('all blocks pass validateBlock', () => {
    const blocks = devReview({
      prdItems: [
        { key: 'f1', title: 'F1', body: '描述', importance: 'high' },
        { key: 'f2', title: 'F2', body: '描述2' },
      ],
      archDiagrams: [
        { key: 'svc', title: '服务图', mermaid: 'graph LR; X-->Y', rationale: '说明' },
      ],
      testScenarios: [
        { key: 'tc-happy', name: '正向流程', expect: '成功' },
        { key: 'tc-fail', name: '失败场景', expect: '错误提示' },
      ],
    });
    assertAllBlocksValid(blocks);
  });

  // ── 新入参（§1.3 面④⑤，批次3）────────────────────────────────────────────────

  test('archAssertions produces verdict blocks with id b-assert-<slug>', () => {
    const blocks = devReview({
      archAssertions: [
        { key: 'stateless', title: '服务是无状态的？', body: '若非无状态，水平扩展会失败。' },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-assert-stateless');
    assert.ok(b, 'b-assert-stateless block missing');
    assert.equal(b.type, 'verdict');
    assert.equal(b.needsDecision, true);
    assert.equal(b.body, '若非无状态，水平扩展会失败。');
  });

  test('archAlternatives produces choice blocks with id b-alt-<slug>', () => {
    const blocks = devReview({
      archAlternatives: [
        {
          key: 'deploy-strategy',
          title: '选择部署策略？',
          body: '蓝绿部署零停机但资源翻倍；滚动更新节省资源但回滚慢。',
          options: [
            { id: 'blue-green', label: '蓝绿部署' },
            { id: 'rolling', label: '滚动更新' },
          ],
          recommendation: 'blue-green',
        },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-alt-deploy-strategy');
    assert.ok(b, 'b-alt-deploy-strategy block missing');
    assert.equal(b.type, 'choice');
    assert.equal(b.needsDecision, true);
    assert.equal(b.hasRecommendation, true);
    assert.equal(b.recommendation, 'blue-green');
    assert.equal(b.options.length, 2);
  });

  test('archAlternatives: invalid recommendation → hasRecommendation=false', () => {
    const blocks = devReview({
      archAlternatives: [
        {
          key: 'cache',
          title: '缓存策略？',
          options: [{ id: 'redis', label: 'Redis' }],
          recommendation: 'nonexistent',
        },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-alt-cache');
    assert.equal(b.hasRecommendation, false, 'invalid recommendation should result in hasRecommendation=false');
    assert.equal(b.recommendation, null);
  });

  test('testCases produces code blocks with lang=gherkin', () => {
    const gherkin = `Scenario: 用户成功登录\n  Given 用户已注册\n  When 输入正确密码\n  Then 跳转到首页`;
    const blocks = devReview({
      testCases: [
        { key: 'login-ok', name: '正常登录', gherkin },
      ],
    });
    const b = blocks.find((b) => b.id === 'b-case-login-ok');
    assert.ok(b, 'b-case-login-ok block missing');
    assert.equal(b.type, 'code');
    assert.equal(b.lang, 'gherkin');
    assert.equal(b.body, gherkin);
    assert.equal(b.needsDecision, false);
  });

  test('devReview: all new blocks pass validateBlock', () => {
    const blocks = devReview({
      archAssertions: [
        { key: 'a1', title: '断言1？', body: '后果', importance: 'high' },
      ],
      archAlternatives: [
        {
          key: 'alt1',
          title: '方案？',
          options: [{ id: 'o1', label: '方案A' }, { id: 'o2', label: '方案B' }],
          recommendation: 'o1',
        },
      ],
      testCases: [
        { key: 'tc1', name: '登录场景', gherkin: 'Scenario: x\n  Given y\n  When z\n  Then w' },
      ],
    });
    assertAllBlocksValid(blocks);
  });

  test('devReview block order: prd → archDiagrams → archAssertions → archAlternatives → testScenarios → testCases', () => {
    const blocks = devReview({
      prdItems:        [{ key: 'p1', title: 'P' }],
      archDiagrams:    [{ key: 'd1', title: 'D', mermaid: 'graph', rationale: '' }],
      archAssertions:  [{ key: 'a1', title: 'A?' }],
      archAlternatives: [{ key: 'l1', title: 'L?', options: [{ id: 'o1', label: 'X' }] }],
      testScenarios:   [{ key: 't1', name: 'T', expect: 'ok' }],
      testCases:       [{ key: 'c1', name: 'C', gherkin: 'Scenario: x' }],
    });
    const ids = blocks.map((b) => b.id);
    const prdIdx    = ids.indexOf('b-prd-p1');
    const archIdx   = ids.indexOf('b-arch-d1');
    const assertIdx = ids.indexOf('b-assert-a1');
    const altIdx    = ids.indexOf('b-alt-l1');
    const testIdx   = ids.indexOf('b-test-t1');
    const caseIdx   = ids.indexOf('b-case-c1');
    assert.ok(prdIdx < archIdx, 'prd before archDiagram');
    assert.ok(archIdx < assertIdx, 'archDiagram before archAssertion');
    assert.ok(assertIdx < altIdx, 'archAssertion before archAlternative');
    assert.ok(altIdx < testIdx, 'archAlternative before testScenario');
    assert.ok(testIdx < caseIdx, 'testScenario before testCase');
  });
});

// ── design-review ─────────────────────────────────────────────────────────────

describe('designReview', () => {
  test('empty input produces empty array', () => {
    assert.equal(designReview({}).length, 0);
  });

  test('image screen produces prototype block', () => {
    const blocks = designReview({
      screens: [
        { key: 'login', title: '登录页', mode: 'image', imageUrl: '/assets/login.png' },
      ],
    });
    const proto = blocks.find((b) => b.id === 'b-proto-login');
    assert.ok(proto, 'b-proto-login block missing');
    assert.equal(proto.type, 'prototype');
    assert.equal(proto.mode, 'image');
    assert.equal(proto.imageUrl, '/assets/login.png');
    assert.equal(proto.needsDecision, false);
  });

  test('iframe screen produces prototype block with src', () => {
    const blocks = designReview({
      screens: [
        { key: 'dashboard', mode: 'iframe', src: 'https://figma.com/proto/xxx' },
      ],
    });
    const proto = blocks.find((b) => b.id === 'b-proto-dashboard');
    assert.ok(proto, 'b-proto-dashboard block missing');
    assert.equal(proto.mode, 'iframe');
    assert.equal(proto.src, 'https://figma.com/proto/xxx');
  });

  test('wireframe screen produces prototype block with screen object', () => {
    const blocks = designReview({
      screens: [
        {
          key: 'home',
          mode: 'wireframe',
          screen: { id: 's1', name: '首页', widgets: [{ id: 'w1', cls: 'btn', text: '开始' }] },
        },
      ],
    });
    const proto = blocks.find((b) => b.id === 'b-proto-home');
    assert.ok(proto, 'b-proto-home block missing');
    assert.equal(proto.mode, 'wireframe');
    assert.ok(proto.screen && proto.screen.widgets.length === 1, 'expected screen with widgets');
  });

  test('screen with verdict spec produces adjacent verdict block', () => {
    const blocks = designReview({
      screens: [
        {
          key: 'login',
          mode: 'image',
          imageUrl: '/login.png',
          verdict: { key: 'login-vrd', title: '登录页设计方向是否确认？', body: '若调整，影响后续开发排期。' },
        },
      ],
    });
    const proto = blocks.find((b) => b.id === 'b-proto-login');
    const vrd   = blocks.find((b) => b.id === 'b-proto-vrd-login-vrd');
    assert.ok(proto, 'prototype block missing');
    assert.ok(vrd, 'verdict block missing');
    assert.equal(vrd.type, 'verdict');
    assert.equal(vrd.needsDecision, true);
    // prototype before verdict
    assert.ok(blocks.indexOf(proto) < blocks.indexOf(vrd), 'prototype must precede verdict');
  });

  test('screen with choice spec produces adjacent choice block', () => {
    const blocks = designReview({
      screens: [
        {
          key: 'onboarding',
          mode: 'image',
          imageUrl: '/onboarding.png',
          choice: {
            key: 'onboarding-style',
            title: '选择引导风格？',
            options: [
              { id: 'tour', label: '产品导览' },
              { id: 'checklist', label: '入门清单' },
            ],
            recommendation: 'checklist',
          },
        },
      ],
    });
    const cho = blocks.find((b) => b.id === 'b-proto-cho-onboarding-style');
    assert.ok(cho, 'choice block missing');
    assert.equal(cho.type, 'choice');
    assert.equal(cho.hasRecommendation, true);
    assert.equal(cho.recommendation, 'checklist');
  });

  test('checklist spec produces checklist block at end', () => {
    const blocks = designReview({
      screens: [
        { key: 'dash', mode: 'image', imageUrl: '/d.png' },
      ],
      checklist: {
        key: 'completeness',
        title: '完整性自查',
        verdictLabels: ['已覆盖', '明确不做', '待定'],
        items: [
          { id: 'c1', label: '空状态' },
          { id: 'c2', label: '错误状态' },
        ],
      },
    });
    const chk = blocks.find((b) => b.id === 'b-chk-completeness');
    assert.ok(chk, 'checklist block missing');
    assert.equal(chk.type, 'checklist');
    assert.deepEqual(chk.verdictLabels, ['已覆盖', '明确不做', '待定']);
    assert.equal(chk.items.length, 2);
    // checklist should be last
    assert.equal(blocks[blocks.length - 1].id, 'b-chk-completeness', 'checklist should be last block');
  });

  test('designReview: all blocks pass validateBlock', () => {
    const blocks = designReview({
      screens: [
        {
          key: 'landing',
          mode: 'image',
          imageUrl: '/landing.png',
          title: '落地页',
          verdict: { key: 'landing-vrd', title: '落地页视觉方向？', body: '影响转化率。' },
          choice: {
            key: 'landing-cho',
            title: '选配色方案？',
            options: [{ id: 'dark', label: '深色系' }, { id: 'light', label: '浅色系' }],
            recommendation: 'light',
          },
        },
        {
          key: 'proto-hi',
          mode: 'iframe',
          src: 'https://figma.com/proto/abc',
          title: '高保真原型',
        },
        {
          key: 'wireframe-home',
          mode: 'wireframe',
          screen: { id: 'wf1', name: '首页线框', widgets: [] },
        },
      ],
      checklist: {
        key: 'design-chk',
        verdictLabels: ['已覆盖', '明确不做', '待定'],
        items: [{ id: 'c1', label: '暗色模式' }, { id: 'c2', label: '移动端适配' }],
      },
    });
    assertAllBlocksValid(blocks);
  });

  test('multiple screens produce prototype blocks in order', () => {
    const blocks = designReview({
      screens: [
        { key: 'a', mode: 'image', imageUrl: '/a.png' },
        { key: 'b', mode: 'image', imageUrl: '/b.png' },
        { key: 'c', mode: 'iframe', src: 'https://c.com' },
      ],
    });
    const ids = blocks.map((b) => b.id);
    assert.ok(ids.indexOf('b-proto-a') < ids.indexOf('b-proto-b'), 'a before b');
    assert.ok(ids.indexOf('b-proto-b') < ids.indexOf('b-proto-c'), 'b before c');
  });
});

// ---------- 模板 section（DESIGN §15 tab 分面）----------

test('devReview: 块带正确 section（需求/架构/测试）', () => {
  const blocks = devReview({
    prdItems: [{ key: 'a', title: 'x' }],
    archDiagrams: [{ key: 'd', title: 'arch', mermaid: 'graph LR;A-->B' }],
    testScenarios: [{ key: 't', name: 's', expect: 'e' }],
  });
  assert.equal(blocks.find((b) => b.id.startsWith('b-prd-')).section, '需求');
  assert.equal(blocks.find((b) => b.id.startsWith('b-arch-')).section, '架构');
  assert.equal(blocks.find((b) => b.id.startsWith('b-test-')).section, '测试');
});

test('designReview: 默认 section=UI 设计，screen.section 可覆盖，checklist→测试', () => {
  const blocks = designReview({
    screens: [
      { key: 's1', mode: 'image', imageUrl: '/a.png' },
      { key: 's2', mode: 'image', imageUrl: '/b.png', section: '交互设计', verdict: { key: 'v', title: 'ok' } },
    ],
    checklist: { key: 'c', title: 'chk', items: [{ id: 'i', label: 'L' }], verdictLabels: ['ok'] },
  });
  assert.equal(blocks.find((b) => b.id === 'b-proto-s1').section, 'UI 设计');
  assert.equal(blocks.find((b) => b.id === 'b-proto-s2').section, '交互设计');
  assert.equal(blocks.find((b) => b.id === 'b-proto-vrd-v').section, '交互设计');
  assert.equal(blocks.find((b) => b.id.startsWith('b-chk-')).section, '测试');
});
