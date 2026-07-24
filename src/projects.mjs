// 项目与会话目录契约。
// 项目必须显式注册；会话目录仍保留旧 ID，并通过 session.json 追加归属、标题和归档状态。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  isValidSessionName,
  latestRound,
  listSessions,
  paths,
  readJSON,
  sessionDir,
  workspaceDir,
} from './workspace.mjs';

export const PROJECT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROJECT_STATUSES = new Set(['active', 'archived']);
export const SESSION_KINDS = new Set(['work', 'review', 'decision', 'test']);
export const SESSION_STATUSES = new Set(['active', 'closed', 'unclassified', 'archived']);
export const DEFAULT_EXECUTOR_ID = 'cloud-codex';
export const EXECUTORS = Object.freeze([
  Object.freeze({ id: DEFAULT_EXECUTOR_ID, displayName: '云端常驻 Codex', kind: 'resident' }),
  Object.freeze({ id: 'local-mac', displayName: '创始人 Mac', kind: 'pull' }),
]);
const EXECUTOR_BY_ID = new Map(EXECUTORS.map((executor) => [executor.id, executor]));

export function executorById(id) {
  return EXECUTOR_BY_ID.get(id) || null;
}

export function projectRegistryPath() {
  return path.join(workspaceDir(), 'projects.json');
}

function optionalString(value, name, { maxLength = 500 } = {}) {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
  const clean = value.trim();
  if (Array.from(clean).length > maxLength) throw new Error(`${name} 不能超过 ${maxLength} 个字符`);
  return clean;
}

function optionalAbsolutePath(value, name) {
  const clean = optionalString(value, name, { maxLength: 1000 });
  if (clean == null) return undefined;
  if (!path.isAbsolute(clean)) throw new Error(`${name} 必须是绝对路径`);
  return path.normalize(clean);
}

function stringList(value, name, validator = () => true) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组`);
  const clean = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || !validator(item.trim())) {
      throw new Error(`${name} 包含无效值`);
    }
    const normalized = item.trim();
    if (!seen.has(normalized)) clean.push(normalized);
    seen.add(normalized);
  }
  return clean;
}

function cleanProject(input, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`项目注册表第 ${index + 1} 项必须是对象`);
  }
  const id = optionalString(input.id, `项目 ${index + 1} 的 id`, { maxLength: 80 });
  if (!PROJECT_ID_RE.test(id)) {
    throw new Error(`项目 ${id || index + 1} 的 id 必须使用小写 kebab-case`);
  }
  const displayName = optionalString(input.displayName, `项目 ${id} 的 displayName`, { maxLength: 120 });
  const status = input.status == null ? 'active' : input.status;
  if (!PROJECT_STATUSES.has(status)) throw new Error(`项目 ${id} 的 status 无效`);
  const aliases = stringList(input.aliases, `项目 ${id} 的 aliases`, (item) => isValidSessionName(item));
  const primarySession = input.primarySession == null
    ? undefined
    : optionalString(input.primarySession, `项目 ${id} 的 primarySession`, { maxLength: 80 });
  if (primarySession != null && !isValidSessionName(primarySession)) {
    throw new Error(`项目 ${id} 的 primarySession 无效`);
  }
  const previewMode = input.previewMode == null ? 'evidence' : input.previewMode;
  if (!['live', 'evidence', 'hybrid'].includes(previewMode)) {
    throw new Error(`项目 ${id} 的 previewMode 无效`);
  }
  const executor = input.executor == null
    ? DEFAULT_EXECUTOR_ID
    : optionalString(input.executor, `项目 ${id} 的 executor`, { maxLength: 80 });
  if (!executorById(executor)) throw new Error(`项目 ${id} 的 executor 无效`);

  return {
    id,
    displayName,
    status,
    previewMode,
    executor,
    ...(optionalString(input.description, `项目 ${id} 的 description`, { maxLength: 500 })
      ? { description: input.description.trim() }
      : {}),
    ...(optionalAbsolutePath(input.repoPath, `项目 ${id} 的 repoPath`)
      ? { repoPath: path.normalize(input.repoPath.trim()) }
      : {}),
    ...(optionalAbsolutePath(input.memoryPath, `项目 ${id} 的 memoryPath`)
      ? { memoryPath: path.normalize(input.memoryPath.trim()) }
      : {}),
    ...(primarySession ? { primarySession } : {}),
    ...(aliases.length ? { aliases } : {}),
  };
}

export function normalizeProjectRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('项目注册表根节点必须是对象');
  }
  if (value.version !== 1) throw new Error('项目注册表 version 必须为 1');
  if (!Array.isArray(value.projects)) throw new Error('项目注册表 projects 必须是数组');
  const projects = value.projects.map(cleanProject);
  const ids = new Set();
  const aliases = new Set();
  for (const project of projects) {
    if (ids.has(project.id)) throw new Error(`项目 id ${project.id} 重复`);
    ids.add(project.id);
    for (const alias of project.aliases || []) {
      if (aliases.has(alias)) throw new Error(`项目 alias ${alias} 重复`);
      aliases.add(alias);
    }
  }
  return { version: 1, projects };
}

function atomicWriteJson(target, value) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (fs.readFileSync(target, 'utf8') === serialized) return false;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, serialized, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
    return true;
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

export function readProjectRegistry() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(projectRegistryPath(), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, projects: [] };
    throw new Error(`项目注册表损坏：${error.message}`);
  }
  try {
    return normalizeProjectRegistry(raw);
  } catch (error) {
    throw new Error(`项目注册表损坏：${error.message}`);
  }
}

export function writeProjectRegistry(value) {
  const normalized = normalizeProjectRegistry(value);
  atomicWriteJson(projectRegistryPath(), normalized);
  return normalized;
}

/** 用注册表中的项目 ID、主会话或别名识别一个尚未落盘的新会话。 */
export function registeredProjectForSession(session) {
  if (!isValidSessionName(session)) throw new Error('session 名称无效');
  const projects = readProjectRegistry().projects;
  const registeredByName = projects.find((project) => (
    project.id === session
    || project.primarySession === session
    || project.aliases?.includes(session)
  ));
  if (registeredByName) return registeredByName;
  const metadata = readSessionMetadata(session, { exactSession: true });
  return projects.find((project) => project.id === metadata?.projectId) || null;
}

function cleanSessionMetadata(session, current, patch) {
  if (!isValidSessionName(session)) throw new Error('session 名称无效');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('会话元数据 patch 必须是对象');
  }
  const merged = { ...(current || {}), ...patch };
  const title = optionalString(merged.title, '会话 title', { maxLength: 160 });
  const topicSlug = merged.topicSlug == null
    ? undefined
    : optionalString(merged.topicSlug, '会话 topicSlug', { maxLength: 100 });
  if (topicSlug != null && !PROJECT_ID_RE.test(topicSlug)) {
    throw new Error('会话 topicSlug 必须使用小写 kebab-case');
  }
  const projectId = merged.projectId == null
    ? undefined
    : optionalString(merged.projectId, '会话 projectId', { maxLength: 80 });
  if (projectId != null && !PROJECT_ID_RE.test(projectId)) {
    throw new Error('会话 projectId 必须使用小写 kebab-case');
  }
  const relatedProjectIds = stringList(
    merged.relatedProjectIds,
    '会话 relatedProjectIds',
    (item) => PROJECT_ID_RE.test(item),
  ).filter((item) => item !== projectId);
  const kind = merged.kind == null ? 'work' : merged.kind;
  if (!SESSION_KINDS.has(kind)) throw new Error('会话 kind 无效');
  const status = merged.status == null ? 'active' : merged.status;
  if (!SESSION_STATUSES.has(status)) throw new Error('会话 status 无效');

  const next = {
    ...merged,
    session,
    ...(title ? { title } : {}),
    ...(topicSlug ? { topicSlug } : {}),
    ...(projectId ? { projectId } : {}),
    relatedProjectIds,
    kind,
    status,
  };
  const { updatedAt: _currentUpdatedAt, ...currentWithoutTimestamp } = current || {};
  const { updatedAt: _mergedUpdatedAt, ...nextWithoutTimestamp } = next;
  const unchanged = current
    && JSON.stringify(currentWithoutTimestamp) === JSON.stringify(nextWithoutTimestamp);
  return {
    ...nextWithoutTimestamp,
    updatedAt: unchanged && typeof current.updatedAt === 'string'
      ? current.updatedAt
      : new Date().toISOString(),
  };
}

export function readSessionMetadata(session, { exactSession = true } = {}) {
  if (!isValidSessionName(session)) throw new Error('session 名称无效');
  const value = readJSON(paths.session(session, { exactSession }), null);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function updateSessionMetadata(session, patch, { exactSession = true } = {}) {
  const current = readSessionMetadata(session, { exactSession });
  const next = cleanSessionMetadata(session, current, patch);
  atomicWriteJson(paths.session(session, { exactSession }), next);
  return next;
}

function latestSessionTitle(session) {
  const round = latestRound(session, { exactSession: true });
  if (!round) return session;
  const content = readJSON(paths.content(session, round, { exactSession: true }), null);
  return typeof content?.title === 'string' && content.title.trim()
    ? content.title.trim()
    : session;
}

function catalogSession(session, projectIds) {
  const metadata = readSessionMetadata(session, { exactSession: true }) || {};
  const projectId = PROJECT_ID_RE.test(metadata.projectId || '') && projectIds.has(metadata.projectId)
    ? metadata.projectId
    : null;
  const relatedProjectIds = stringList(
    metadata.relatedProjectIds,
    `会话 ${session} 的 relatedProjectIds`,
    (item) => PROJECT_ID_RE.test(item),
  ).filter((item) => item !== projectId && projectIds.has(item));
  const kind = SESSION_KINDS.has(metadata.kind) ? metadata.kind : 'work';
  const status = projectId
    ? (SESSION_STATUSES.has(metadata.status) ? metadata.status : 'active')
    : (metadata.status === 'archived' ? 'archived' : 'unclassified');
  return {
    id: session,
    title: typeof metadata.title === 'string' && metadata.title.trim()
      ? metadata.title.trim()
      : latestSessionTitle(session),
    projectId,
    relatedProjectIds,
    kind,
    status,
    latestRound: latestRound(session, { exactSession: true }),
  };
}

function publicProject(project) {
  return {
    id: project.id,
    displayName: project.displayName,
    status: project.status,
    previewMode: project.previewMode,
    executor: project.executor,
    ...(project.description ? { description: project.description } : {}),
    ...(project.primarySession ? { primarySession: project.primarySession } : {}),
    ...(project.aliases?.length ? { aliases: project.aliases } : {}),
  };
}

export function projectCatalog() {
  const registry = readProjectRegistry();
  const projectIds = new Set(registry.projects.map((project) => project.id));
  const sessions = listSessions()
    .filter((session) => isValidSessionName(session))
    .map((session) => catalogSession(session, projectIds))
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
  const projects = registry.projects
    .map(publicProject)
    .map((project) => ({
      ...project,
      primarySession: sessions.some((session) => (
        session.id === project.primarySession
        && session.projectId === project.id
        && session.status !== 'archived'
      ))
        ? project.primarySession
        : null,
      sessions: sessions
        .filter((session) => session.projectId === project.id)
        .map((session) => session.id),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
  return { version: 1, projects, sessions };
}

export function executionContextForSession(session) {
  if (!isValidSessionName(session)) throw new Error('session 名称无效');
  // 不允许凭 session ID 推导任意路径；只接受注册表中已经验证过的绝对路径。
  const registry = readProjectRegistry();
  const byId = new Map(registry.projects.map((project) => [project.id, project]));
  const metadata = readSessionMetadata(session, { exactSession: true }) || {};
  const primaryProject = byId.get(metadata.projectId) || null;
  const relatedProjects = stringList(
    metadata.relatedProjectIds,
    `会话 ${session} 的 relatedProjectIds`,
    (item) => PROJECT_ID_RE.test(item),
  ).flatMap((id) => {
    const project = byId.get(id);
    return project && project.id !== primaryProject?.id ? [project] : [];
  });
  return {
    session: {
      id: session,
      title: typeof metadata.title === 'string' && metadata.title.trim()
        ? metadata.title.trim()
        : latestSessionTitle(session),
      kind: SESSION_KINDS.has(metadata.kind) ? metadata.kind : 'work',
      status: SESSION_STATUSES.has(metadata.status) ? metadata.status : 'unclassified',
    },
    primaryProject,
    relatedProjects,
  };
}

export function sessionExists(session) {
  return isValidSessionName(session)
    && fs.existsSync(sessionDir(session, { exactSession: true }));
}
