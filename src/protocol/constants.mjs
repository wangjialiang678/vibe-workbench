// 浏览器安全常量（无 node 依赖）——前端可直接 import。
export const BLOCK_TYPES = ['markdown', 'diagram', 'choice', 'verdict', 'freetext', 'editable', 'table', 'code', 'embed'];
export const IMPORTANCE = ['high', 'normal', 'low'];
export const IMPORTANCE_RANK = { high: 0, normal: 1, low: 2 };
export const FEEDBACK_TYPES = ['select', 'verdict', 'comment', 'edit', 'text', 'pin'];
export const STATES = ['rendered', 'submitted', 'claimed', 'responded', 'error'];
export const ERROR_KINDS = ['timeout', 'driver', 'api', 'unknown'];
export const HEARTBEAT_STALE_MS = 30000;
