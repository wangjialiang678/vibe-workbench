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
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateContent, validateBlock } from '../../src/protocol/schema.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '../..');
const CONTENT_PATH = resolve(ROOT, 'workspace/imported-demo/round-1/content.json');

let content;
try {
  content = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'));
} catch {
  // 文件不存在时跳过——脚本未运行的 CI 环境
  content = null;
}

describe('import-prd-project', () => {
  test('content.json 存在且可解析', () => {
    assert.ok(content !== null, `content.json 不存在或无法解析：${CONTENT_PATH}。请先运行 node scripts/import-prd-project.mjs`);
  });

  test('validateContent 全部通过', () => {
    if (!content) return;
    const result = validateContent(content);
    assert.equal(result.ok, true, `validateContent 失败：${result.errors.join('; ')}`);
  });

  test('session=imported-demo, round=1', () => {
    if (!content) return;
    assert.equal(content.session, 'imported-demo');
    assert.equal(content.round, 1);
  });

  test('包含 verdict blocks（prd + arch assertions + test scenarios）', () => {
    if (!content) return;
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
    if (!content) return;
    const diagrams = content.blocks.filter((b) => b.type === 'diagram');
    assert.ok(diagrams.length >= 1, `至少 1 个 diagram block，实际：${diagrams.length}`);
    assert.ok(diagrams[0].id.startsWith('b-arch-'), 'diagram id 应以 b-arch- 开头');
    assert.ok(diagrams[0].body && diagrams[0].body.includes('graph'), 'diagram body 应含 mermaid 语法');
  });

  test('包含 choice block（arch.alternatives）', () => {
    if (!content) return;
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
    if (!content) return;
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
    if (!content) return;
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
    if (!content) return;
    const codes = content.blocks.filter((b) => b.type === 'code');
    assert.ok(codes.length >= 1, `至少 1 个 code block，实际：${codes.length}`);
    assert.ok(codes.every((b) => b.lang === 'gherkin'), 'code block lang 应为 gherkin');
  });

  test('所有 blocks 通过 validateBlock', () => {
    if (!content) return;
    for (const b of content.blocks) {
      const { ok, errors } = validateBlock(b);
      assert.equal(ok, true, `block ${b.id} (${b.type}) validateBlock 失败：${errors.join('; ')}`);
    }
  });

  test('block ids 无重复', () => {
    if (!content) return;
    const ids = content.blocks.map((b) => b.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `有重复 block id：${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });
});
