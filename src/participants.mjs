// 参与者私密名册：magic-link token 只落本地文件，列表/API 永不回显。
import { disk } from './storage/index.mjs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const DEFAULT_PARTICIPANTS_FILE = path.join(ROOT, 'config', 'participants.json');

function rosterPath(filePath) {
  return filePath || process.env.WB_PARTICIPANTS_FILE || DEFAULT_PARTICIPANTS_FILE;
}

function validateRoster(value) {
  if (!Array.isArray(value)) throw new Error('参与者名册损坏：根节点必须是数组');
  const ids = new Set();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`参与者名册损坏：第 ${index + 1} 项必须是对象`);
    }
    if (!PARTICIPANT_ID_RE.test(item.id || '') || item.id.toLowerCase() === 'owner') {
      throw new Error(`参与者名册损坏：第 ${index + 1} 项 id 无效`);
    }
    if (ids.has(item.id)) throw new Error(`参与者名册损坏：id ${item.id} 重复`);
    if (typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error(`参与者名册损坏：第 ${index + 1} 项 name 无效`);
    }
    if (typeof item.token !== 'string' || !item.token) {
      throw new Error(`参与者名册损坏：第 ${index + 1} 项 token 无效`);
    }
    if (typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))) {
      throw new Error(`参与者名册损坏：第 ${index + 1} 项 createdAt 无效`);
    }
    ids.add(item.id);
  }
  return value;
}

export function readParticipants(filePath) {
  const target = rosterPath(filePath);
  try {
    return validateRoster(JSON.parse(disk.readFileSync(target, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    if (/参与者名册损坏/.test(error?.message || '')) throw error;
    throw new Error(`参与者名册 JSON 损坏：${error.message}`, { cause: error });
  }
}

function writeParticipants(participants, filePath) {
  const target = rosterPath(filePath);
  const dir = path.dirname(target);
  disk.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    disk.writeFileSync(temp, `${JSON.stringify(participants, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    disk.renameSync(temp, target);
  } finally {
    try { disk.rmSync(temp, { force: true }); } catch { /* rename 成功后临时文件已不存在 */ }
  }
}

export function listParticipants(filePath) {
  return readParticipants(filePath).map(({ id, name, createdAt }) => ({ id, name, createdAt }));
}

export function addParticipant({ id, name }, { filePath } = {}) {
  const cleanId = typeof id === 'string' ? id.trim() : '';
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!PARTICIPANT_ID_RE.test(cleanId)) {
    throw new Error('参与者 id 无效：仅允许 1-64 位字母、数字、下划线和连字符');
  }
  if (cleanId.toLowerCase() === 'owner') throw new Error('参与者 id owner 是保留身份');
  if (!cleanName) throw new Error('参与者名字不能为空');
  if (cleanName.length > 80) throw new Error('参与者名字不能超过 80 个字符');

  const participants = readParticipants(filePath);
  if (participants.some((item) => item.id === cleanId)) throw new Error(`参与者 ${cleanId} 已存在`);
  const participant = {
    id: cleanId,
    name: cleanName,
    token: randomBytes(16).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  writeParticipants([...participants, participant], filePath);
  return participant;
}

export function revokeParticipant(id, { filePath } = {}) {
  const participants = readParticipants(filePath);
  const next = participants.filter((item) => item.id !== id);
  if (next.length === participants.length) return false;
  writeParticipants(next, filePath);
  return true;
}

function secureTokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function findParticipantByToken(token, { filePath } = {}) {
  if (typeof token !== 'string' || !token) return null;
  const hit = readParticipants(filePath).find((item) => secureTokenEqual(token, item.token));
  return hit ? { id: hit.id, name: hit.name } : null;
}
