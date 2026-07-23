// 作者侧 lint（iteration-brief P1/P2/P3）——规则用 docs/feedback-examples-2026-07-13.md 的真实病例当 fixture
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintBlock, lintContent, formatLint } from '../../src/protocol/lint.mjs';
import * as lintModule from '../../src/protocol/lint.mjs';

const rules = (block) => lintBlock(block).map((w) => w.rule);

// —— 病例 1：AFX 决策块（术语墙 + 零背景 + 选项只讲机制不讲后果）——
const case1Bad = {
  id: 'b-ime-afx',
  type: 'choice',
  needsDecision: true,
  hasRecommendation: true,
  recommendation: 'disable',
  title: 'AFX 处置：旧产品仓 main 里已有前代三通道 AI 自动修复，与 vibeloop 同问题域会撞车',
  options: [
    { id: 'disable', label: '停用 AFX，vibeloop 全面接管（推荐）', desc: '两套自动修复并存会互相合并冲突' },
    { id: 'coexist', label: '共存观察一段时间', desc: 'AFX 继续跑本地通道' },
  ],
};

test('病例1：零背景 + 无利弊 + 未解释缩写 + 无推荐理由 → 四条 warn', () => {
  const r = rules(case1Bad);
  assert.ok(r.includes('missing-background'), '应报缺背景');
  assert.ok(r.includes('missing-why'), '应报缺 why');
  assert.ok(r.includes('missing-proscons'), '应报选项缺利弊');
  assert.ok(r.includes('missing-recommend-reason'), '应报缺推荐理由');
  assert.ok(r.includes('unexplained-jargon'), '应报未解释缩写(AFX)');
});

test('病例1 修正版（补齐四段）→ 零 warn', () => {
  const fixed = {
    ...case1Bad,
    background: '一句话：旧产品仓库里已经住着一个"老版的 vibeloop"，它叫 AFX，是同事做的 AI 自动修 bug 系统。',
    why: '一个仓库不能住两个自动修理工——共存客观上会冲突，这是技术判断，需要你拍板。',
    recommendReason: '推荐停用：不删任何代码，随时可重新启用（完全可回退）。',
    options: [
      { id: 'disable', label: '停用 AFX', pros: ['不再有两套系统抢着改同一份代码'], cons: ['AFX 的本地通道暂时用不了'] },
      { id: 'coexist', label: '共存观察', pros: ['保留 AFX 能力'], cons: ['会互相制造合并冲突', '你要看两套待批准队列'] },
    ],
  };
  assert.deepEqual(rules(fixed), [], `不应有 warn，实得：${JSON.stringify(lintBlock(fixed), null, 1)}`);
});

// —— 病例 5：确认场景用 editable（连续两轮无人应答）——
test('病例5：needsDecision 的 editable → 提示改用 verdict', () => {
  const r = rules({ id: 'b-ime-goal', type: 'editable', needsDecision: true, background: 'x', why: 'y', value: '草稿' });
  assert.ok(r.includes('editable-for-confirm'));
});

// —— 病例 4：一个 freetext 塞三个问题 ——
test('病例4：freetext 里塞多问 → multi-question', () => {
  const r = rules({
    id: 'b-ime-open', type: 'freetext',
    title: '三个开放事实问题',
    body: '① 延迟指标要不要写死？\n② 公证凭证的就绪时间表？\n③ 合并推 origin 还是 personal？',
  });
  assert.ok(r.includes('multi-question'));
});

// —— 向后兼容：非决策块 / 老内容不应被 lint 骚扰 ——
test('非决策块（needsDecision:false）不报结构化相关 warn', () => {
  const r = rules({ id: 'b-note', type: 'markdown', needsDecision: false, body: '纯说明 AFX SLO' });
  assert.deepEqual(r, []);
});

test('常见缩写（AI/UI/API/PRD…）在白名单内，不误报', () => {
  const r = rules({
    id: 'b-x', type: 'verdict', needsDecision: true,
    background: 'b', why: 'w',
    title: '用 AI 生成 UI，走 API 对齐 PRD',
  });
  assert.deepEqual(r, []);
});

test('lintContent 汇总多块；formatLint 输出可读文本', () => {
  const ws = lintContent({ blocks: [case1Bad, { id: 'ok', type: 'markdown', needsDecision: false }] });
  assert.ok(ws.length >= 4);
  assert.ok(ws.every((w) => w.level === 'warn'), '全部为 warn（不阻断）');
  const txt = formatLint(ws);
  assert.ok(txt.includes('b-ime-afx'));
  assert.ok(txt.includes('不阻断'));
  assert.equal(formatLint([]), '');
});

test('决策完整性：空白字段与 choice 单边缺失的 pros/cons 都会逐项列出', () => {
  assert.equal(typeof lintModule.findIncompleteDecisions, 'function');
  const issues = lintModule.findIncompleteDecisions({
    blocks: [{
      id: 'b-incomplete',
      type: 'choice',
      needsDecision: true,
      hasRecommendation: true,
      background: '   ',
      why: '\n',
      recommendReason: '',
      options: [
        { id: 'a', pros: [], cons: ['有代价'] },
        { id: 'b', pros: ['有收益'], cons: [] },
      ],
    }],
  });

  assert.deepEqual(issues, [{
    blockId: 'b-incomplete',
    missingFields: [
      'background（背景）',
      'why（为什么需要人定）',
      'options[0].pros（选项优点）',
      'options[1].cons（选项缺点）',
      'recommendReason（推荐理由）',
    ],
  }]);
});

test('决策完整性：needsDecision:false 不产生缺失项', () => {
  assert.equal(typeof lintModule.findIncompleteDecisions, 'function');
  const issues = lintModule.findIncompleteDecisions({
    blocks: [{
      id: 'b-note',
      type: 'choice',
      needsDecision: false,
      hasRecommendation: true,
      options: [{ id: 'a' }],
    }],
  });

  assert.deepEqual(issues, []);
});

test('ascii-art：正文含 3 个以上框线字符触发警告', () => {
  const block = {
    id: 'b-art', type: 'markdown',
    body: '布局示意：\n┌───┬───┐\n│流 │卡片│\n└───┴───┘',
  };
  assert.equal(rules(block).includes('ascii-art'), true);
});

test('ascii-art：普通中文与少量特殊字符不误报', () => {
  const block = { id: 'b-ok', type: 'markdown', body: '正常段落——含破折号、引号"和"箭头→，不是字符画' };
  assert.equal(rules(block).includes('ascii-art'), false);
});
