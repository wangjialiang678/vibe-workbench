// 工作区文件契约（DESIGN §6.2）。server / loop / bin 共用。可用 WB_WORKSPACE 覆盖根目录（便于测试）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export function workspaceDir() { return process.env.WB_WORKSPACE || path.join(ROOT, 'workspace'); }
function safe(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80); }
export function sessionDir(s) { return path.join(workspaceDir(), safe(s)); }
export function roundDir(s, r) { return path.join(sessionDir(s), `round-${r}`); }

export const paths = {
  content: (s, r) => path.join(roundDir(s, r), 'content.json'),
  contentMd: (s, r) => path.join(roundDir(s, r), 'content.md'),
  feedback: (s, r) => path.join(roundDir(s, r), 'feedback.json'),
  feedbackMd: (s, r) => path.join(roundDir(s, r), 'feedback.md'),
  ack: (s, r) => path.join(roundDir(s, r), 'ack.json'),
  response: (s, r) => path.join(roundDir(s, r), 'response.md'),
  error: (s, r) => path.join(roundDir(s, r), 'error.json'),
  status: (s) => path.join(sessionDir(s), 'status.json'),
  session: (s) => path.join(sessionDir(s), 'session.json'),
};

export function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
export function readJSON(p, def = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
export function writeJSON(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
export function readText(p, def = null) { try { return fs.readFileSync(p, 'utf8'); } catch { return def; } }
export function writeText(p, t) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); }
export function removeFile(p) { try { fs.rmSync(p); return true; } catch { return false; } }

export function readStatus(s) { return readJSON(paths.status(s), null); }
export function writeStatus(s, patch, nowISO) {
  const cur = readStatus(s) || { session: s };
  const next = { ...cur, ...patch, updatedAt: nowISO || new Date().toISOString() };
  writeJSON(paths.status(s), next);
  return next;
}

export function listSessions() {
  try { return fs.readdirSync(workspaceDir()).filter((d) => { try { return fs.statSync(path.join(workspaceDir(), d)).isDirectory(); } catch { return false; } }); }
  catch { return []; }
}
export function listRounds(s) {
  try { return fs.readdirSync(sessionDir(s)).filter((d) => /^round-\d+$/.test(d)).map((d) => parseInt(d.slice(6), 10)).sort((a, b) => a - b); }
  catch { return []; }
}
export function latestRound(s) { const r = listRounds(s); return r.length ? r[r.length - 1] : 0; }
