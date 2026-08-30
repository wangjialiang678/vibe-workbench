import { DOCUMENT_BODY_LIMIT } from '../documents.mjs';
import { INBOX_PAYLOAD_LIMIT } from '../executor-inbox.mjs';

export const ROUND_BODY_LIMIT = 2 * 1024 * 1024;
export const MESSAGE_BODY_LIMIT = 32 * 1024;
export const ATTACHMENT_BODY_LIMIT = 5 * 1024 * 1024;
export const DOCUMENT_REQUEST_LIMIT = (DOCUMENT_BODY_LIMIT * 6) + (64 * 1024);
export const WORKER_HEARTBEAT_BODY_LIMIT = 8 * 1024;
export const INBOX_REQUEST_LIMIT = (INBOX_PAYLOAD_LIMIT * 6) + (64 * 1024);
export const UNCLASSIFIED_SESSION_WARNING = '未归属项目的新会话，建议先在项目下创建或使用规范命名';
export const WORKER_HEARTBEAT_STALE_MS = 90 * 1000;
export const AI_IDENTITY = Object.freeze({ id: 'ai', name: 'AI', role: 'ai' });
export const ATTACHMENT_TYPES = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif'],
  ['application/pdf', '.pdf'], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-excel', '.xls'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['text/csv', '.csv'],
]);
