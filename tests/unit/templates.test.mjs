import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import thinkDiscuss from '../../templates/think-discuss.mjs';
import devReview from '../../templates/dev-review.mjs';
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
});
