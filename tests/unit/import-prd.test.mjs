/**
 * tests/unit/import-prd.test.mjs
 *
 * 验收测试：import-prd-project 脚本生成的 content.json
 *   1. 文件存在且可解析
 *   2. validateContent 通过
 *   3. 各面的 block 类型与数量符合预期（§1.3 映射）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, validateBlock } from '../../src/protocol/schema.mjs';
import { convertProjectData } from '../../scripts/import-prd-project.mjs';

const content = convertProjectData({
  id: 'demo',
  title: '导入测试',
  prd: {
    sections: [{
      items: [
        { id: 'prd-1', title: '需求一' },
        { id: 'prd-2', title: '需求二' },
      ],
    }],
  },
  arch: {
    diagrams: [{ id: 'system', title: '架构图', mermaid: 'graph TD; A-->B' }],
    assertions: [
      { id: 'assert-1', text: '断言一' },
      { id: 'assert-2', text: '断言二' },
    ],
    alternatives: [
      { id: 'room', title: 'Room', chosen: true },
      { id: 'file', title: 'File' },
    ],
  },
  proto: {
    screens: [
      { id: 'list', name: '列表', widgets: [] },
      { id: 'detail', name: '详情', widgets: [] },
    ],
  },
  test: {
    scenarios: [{ id: 'scenario-1', name: '场景一', expect: '通过' }],
    cases: [{ id: 'case-1', title: '用例一', gherkin: 'Scenario: smoke' }],
  },
  completeness: {
    journey: [{ id: 'journey-1', label: '旅程一' }],
    frSlots: [{ id: 'fr-1', title: '功能一' }],
    wildFeatures: [{ id: 'wild-1', title: '待确认功能' }],
    reconcile: [{ id: 'reconcile-1', title: '三方对账' }],
  },
}, { session: 'imported-demo' });

describe('import-prd-project', () => {
  test('content.json 存在且可解析', () => {
    assert.ok(content && typeof content === 'object');
  });

  test('validateContent 全部通过', () => {
    const result = validateContent(content);
    assert.equal(result.ok, true, `validateContent 失败：${result.errors.join('; ')}`);
  });

  test('session=imported-demo, round=1', () => {
    assert.equal(content.session, 'imported-demo');
    assert.equal(content.round, 1);
  });

  test('包含 verdict blocks（prd + arch assertions + test scenarios）', () => {
    const verdicts = content.blocks.filter((b) => b.type === 'verdict');
    assert.ok(verdicts.length >= 5, `至少 5 个 verdict block，实际：${verdicts.length}`);
    // PRD 条目以 b-prd- 开头
    assert.ok(verdicts.some((b) => b.id.startsWith('b-prd-')), '缺少 b-prd-* blocks');
    // 测试场景以 b-test- 开头
    assert.ok(verdicts.some((b) => b.id.startsWith('b-test-')), '缺少 b-test-* blocks');
    // 架构断言以 b-assert- 开头
    assert.ok(verdicts.some((b) => b.id.startsWith('b-assert-')), '缺少 b-assert-* blocks');
  });

  test('包含 diagram block（架构图）', () => {
    const diagrams = content.blocks.filter((b) => b.type === 'diagram');
    assert.ok(diagrams.length >= 1, `至少 1 个 diagram block，实际：${diagrams.length}`);
    assert.ok(diagrams[0].id.startsWith('b-arch-'), 'diagram id 应以 b-arch- 开头');
    assert.ok(diagrams[0].body && diagrams[0].body.includes('graph'), 'diagram body 应含 mermaid 语法');
  });

  test('包含 choice block（arch.alternatives）', () => {
    const choices = content.blocks.filter((b) => b.type === 'choice');
    assert.ok(choices.length >= 1, `至少 1 个 choice block，实际：${choices.length}`);
    const altBlock = choices.find((b) => b.id === 'b-alt-storage');
    assert.ok(altBlock, '缺少 b-alt-storage block');
    assert.ok(Array.isArray(altBlock.options) && altBlock.options.length >= 2, 'choice 应有 ≥2 options');
    // demo.js 中 Room 是 chosen
    assert.equal(altBlock.hasRecommendation, true, 'chosen:true 应映射为 hasRecommendation=true');
    assert.ok(altBlock.recommendation, 'recommendation 应非空');
  });

  test('包含 checklist blocks（completeness 四组）', () => {
    const checklists = content.blocks.filter((b) => b.type === 'checklist');
    assert.ok(checklists.length >= 4, `completeness 四组应生成 ≥4 个 checklist blocks，实际：${checklists.length}`);
    const ids = checklists.map((b) => b.id);
    assert.ok(ids.includes('b-chk-journey'), '缺少 b-chk-journey');
    assert.ok(ids.includes('b-chk-frslots'), '缺少 b-chk-frslots');
    assert.ok(ids.includes('b-chk-wildfeatures'), '缺少 b-chk-wildfeatures');
    assert.ok(ids.includes('b-chk-reconcile'), '缺少 b-chk-reconcile');
    // 每个 checklist 的 verdictLabels 非空、items 非空
    for (const ck of checklists) {
      assert.ok(Array.isArray(ck.verdictLabels) && ck.verdictLabels.length > 0, `${ck.id} 缺少 verdictLabels`);
      assert.ok(Array.isArray(ck.items) && ck.items.length > 0, `${ck.id} 缺少 items`);
      const r = validateBlock(ck);
      assert.equal(r.ok, true, `${ck.id} validateBlock 失败：${r.errors.join('; ')}`);
    }
  });

  test('包含 prototype blocks（proto.screens → wireframe）', () => {
    const protos = content.blocks.filter((b) => b.type === 'prototype');
    assert.ok(protos.length >= 1, `至少 1 个 prototype block，实际：${protos.length}`);
    for (const p of protos) {
      assert.equal(p.mode, 'wireframe', `${p.id} mode 应为 wireframe`);
      assert.ok(p.screen && typeof p.screen === 'object', `${p.id} 缺少 screen 对象`);
      assert.ok(Array.isArray(p.screen.widgets), `${p.id}.screen 缺少 widgets 数组`);
      const r = validateBlock(p);
      assert.equal(r.ok, true, `${p.id} validateBlock 失败：${r.errors.join('; ')}`);
    }
    // demo.js 有 2 个 screen
    assert.ok(protos.length >= 2, `demo.js 有 2 个 screen，应生成 ≥2 个 prototype blocks，实际：${protos.length}`);
  });

  test('包含 code blocks（test.cases → gherkin）', () => {
    const codes = content.blocks.filter((b) => b.type === 'code');
    assert.ok(codes.length >= 1, `至少 1 个 code block，实际：${codes.length}`);
    assert.ok(codes.every((b) => b.lang === 'gherkin'), 'code block lang 应为 gherkin');
  });

  test('所有 blocks 通过 validateBlock', () => {
    for (const b of content.blocks) {
      const { ok, errors } = validateBlock(b);
      assert.equal(ok, true, `block ${b.id} (${b.type}) validateBlock 失败：${errors.join('; ')}`);
    }
  });

  test('block ids 无重复', () => {
    const ids = content.blocks.map((b) => b.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `有重复 block id：${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });
});
