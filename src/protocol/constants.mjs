// 浏览器安全常量（无 node 依赖）——前端可直接 import。
export const BLOCK_TYPES = ['markdown', 'diagram', 'choice', 'verdict', 'freetext', 'editable', 'table', 'code', 'embed', 'prototype', 'checklist'];
export const IMPORTANCE = ['high', 'normal', 'low'];
// tab 分面导航默认类目（prd-studio 六面对齐）。content.sections 可覆盖；空面渲染为灰 tab。
export const DEFAULT_SECTIONS = ['需求', '架构', 'UI 设计', '交互设计', '测试', '风险'];
export const MISC_SECTION = '其他'; // 无 section 归类块的落点（仅非空时出现）
export const IMPORTANCE_RANK = { high: 0, normal: 1, low: 2 };
// 'confirm' = 看了但不改（editable「保持原样即确认」）——与"没看"(unanswered) 语义区分（P2 · 病例 5）
export const FEEDBACK_TYPES = ['select', 'verdict', 'comment', 'edit', 'text', 'pin', 'confirm'];
// 受众分层（iteration-brief P2）：tech 块默认折叠，不占决策者注意力
export const AUDIENCE = ['decider', 'tech'];
export const STATES = ['rendered', 'submitted', 'claimed', 'responded', 'error'];
export const ERROR_KINDS = ['timeout', 'driver', 'api', 'unknown'];
export const HEARTBEAT_STALE_MS = 30000;
