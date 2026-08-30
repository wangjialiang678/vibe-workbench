import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { findParticipantByToken, listParticipants } from '../participants.mjs';

export const OWNER_IDENTITY = Object.freeze({ id: 'owner', name: '管理员', role: 'owner' });
const PUBLIC_STATIC_EXTENSIONS = new Set(['.mjs', '.js', '.css', '.svg', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf']);

export function safeTokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function requiresPageToken(urlPath) {
  if (urlPath === '/' || urlPath === '/render' || urlPath === '/control' || urlPath === '/control/' || urlPath === '/control/index.html') return true;
  return urlPath.startsWith('/render/') && !PUBLIC_STATIC_EXTENSIONS.has(path.posix.extname(urlPath).toLowerCase());
}

export function isControlPage(urlPath) { return urlPath === '/control' || urlPath === '/control/' || urlPath === '/control/index.html'; }
export function requestTokens(req, requestUrl, isApi) {
  return (isApi ? [req.headers['x-workbench-token'], requestUrl.searchParams.get('token')] : [requestUrl.searchParams.get('token')])
    .filter((token) => typeof token === 'string' && token);
}
export function resolveRequestIdentity(tokens, expectedToken, participantsFile) {
  for (const token of tokens) if (safeTokenEqual(token, expectedToken)) return { identity: OWNER_IDENTITY, token };
  for (const token of tokens) {
    const participant = findParticipantByToken(token, { filePath: participantsFile });
    if (participant) return { identity: { ...participant, role: 'participant' }, token };
  }
  return expectedToken ? null : { identity: OWNER_IDENTITY, token: '' };
}
export function acceptedSelfReport(value, identity, participantsFile) {
  if (identity?.role !== 'owner' || value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.name !== 'string' || !value.name.trim() || [...value.name].length > 40) {
    const error = new Error('selfReport.name 必填且须为 1~40 个字符'); error.code = 'INVALID_SELF_REPORT'; throw error;
  }
  const accepted = { name: value.name };
  if (typeof value.id === 'string' && listParticipants(participantsFile).some((participant) => participant.id === value.id)) accepted.id = value.id;
  return accepted;
}
export function selfReportSlug(name) { return String(name || '').replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 20) || '-'; }
export function sharedDisplayName(selfReportedBy) { return selfReportedBy ? `${selfReportedBy.name}（共享链接）` : ''; }
export function publicParticipant(participant) { const { id, name, createdAt } = participant; return { id, name, createdAt }; }
export function participantInviteUrl(req, token) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = /^https?$/i.test(forwardedProto) ? forwardedProto.toLowerCase() : (req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() || req.headers.host || '127.0.0.1';
  const target = new URL('/render/', `${protocol}://${host}`); target.searchParams.set('token', token); return target.href;
}
