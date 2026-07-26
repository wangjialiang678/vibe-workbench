import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp;
let projects;
let workspace;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-projects-'));
  process.env.WB_WORKSPACE = tmp;
  projects = await import('../../src/projects.mjs');
  workspace = await import('../../src/workspace.mjs');
});

after(() => {
  delete process.env.WB_WORKSPACE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('项目注册表严格校验 kebab-case、重复 ID 与绝对仓库路径', () => {
  assert.throws(() => projects.writeProjectRegistry({
    version: 1,
    projects: [{ id: 'Bad_Project', displayName: '坏项目' }],
  }), /kebab-case/);
  assert.throws(() => projects.writeProjectRegistry({
    version: 1,
    projects: [
      { id: 'same', displayName: '一' },
      { id: 'same', displayName: '二' },
    ],
  }), /重复/);
  assert.throws(() => projects.writeProjectRegistry({
    version: 1,
    projects: [{ id: 'bad-path', displayName: '坏路径', repoPath: 'relative/path' }],
  }), /绝对路径/);
});

test('项目注册表保留跨平台绝对路径文本', () => {
  const registry = projects.normalizeProjectRegistry({
    version: 1,
    projects: [{
      id: 'cross-platform-paths',
      displayName: '跨平台路径',
      repoPath: 'C:\\Users\\founder\\project',
      memoryPath: '/srv/memory/project',
    }],
  });

  assert.deepEqual(registry.projects[0], {
    id: 'cross-platform-paths',
    displayName: '跨平台路径',
    status: 'active',
    previewMode: 'evidence',
    executor: 'cloud-codex',
    repoPath: 'C:\\Users\\founder\\project',
    memoryPath: '/srv/memory/project',
  });
});

test('执行面目录包含外部评审面，项目 executor 缺省为 cloud-codex 并拒绝未知值', () => {
  assert.deepEqual(
    projects.EXECUTORS?.map(({ id, kind, transport }) => ({ id, kind, transport })),
    [
      { id: 'cloud-codex', kind: 'resident', transport: undefined },
      { id: 'local-mac', kind: 'pull', transport: undefined },
      { id: 'github-actions', kind: 'external-review', transport: 'pr' },
    ],
  );

  const normalized = projects.normalizeProjectRegistry({
    version: 1,
    projects: [
      { id: 'default-project', displayName: '默认项目' },
      { id: 'local-project', displayName: '本地项目', executor: 'local-mac' },
      {
        id: 'paper-edit',
        displayName: '论文编辑',
        reviewPlane: { executor: 'github-actions' },
      },
    ],
  });
  assert.equal(normalized.projects[0].executor, 'cloud-codex');
  assert.equal(normalized.projects[1].executor, 'local-mac');
  assert.deepEqual(normalized.projects[2].reviewPlane, { executor: 'github-actions' });
  assert.equal(projects.executorById('local-mac').displayName, '创始人 Mac');
  assert.equal(projects.executorById('github-actions').kind, 'external-review');
  assert.equal(projects.executorById('missing'), null);

  assert.throws(() => projects.normalizeProjectRegistry({
    version: 1,
    projects: [{ id: 'bad-executor', displayName: '坏执行面', executor: '../local' }],
  }), /executor/);
  assert.throws(() => projects.normalizeProjectRegistry({
    version: 1,
    projects: [{
      id: 'bad-review-plane',
      displayName: '坏评审面',
      reviewPlane: { executor: 'local-mac' },
    }],
  }), /reviewPlane/);
});

test('会话元数据迁移只追加字段，保留旧执行器 session/cwd', () => {
  workspace.writeJSON(workspace.paths.session('legacy-session', { exactSession: true }), {
    claudeSessionId: 'ses_old',
    cwd: '/legacy/cwd',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const saved = projects.updateSessionMetadata('legacy-session', {
    title: '新的可读标题',
    topicSlug: 'readable-title',
    projectId: 'project-one',
    relatedProjectIds: ['project-two', 'project-one'],
    kind: 'decision',
    status: 'active',
  });

  assert.equal(saved.claudeSessionId, 'ses_old');
  assert.equal(saved.cwd, '/legacy/cwd');
  assert.equal(saved.projectId, 'project-one');
  assert.deepEqual(saved.relatedProjectIds, ['project-two']);
  assert.equal(saved.status, 'active');
});

test('重复写入相同会话元数据不会改动文件，迁移可安全重跑', async () => {
  const patch = {
    title: '幂等迁移',
    topicSlug: 'idempotent-migration',
    projectId: 'project-one',
    kind: 'work',
    status: 'active',
  };
  projects.updateSessionMetadata('idempotent-session', patch);
  const target = workspace.paths.session('idempotent-session', { exactSession: true });
  const first = fs.readFileSync(target, 'utf8');

  await new Promise((resolve) => setTimeout(resolve, 5));
  projects.updateSessionMetadata('idempotent-session', patch);

  assert.equal(fs.readFileSync(target, 'utf8'), first);
});

test('项目目录把已注册、待归类、已归档会话分开且不暴露服务器路径', () => {
  projects.writeProjectRegistry({
    version: 1,
    projects: [{
      id: 'project-one',
      displayName: '项目一',
      repoPath: '/srv/project-one',
      memoryPath: '/srv/memory/project-one',
      primarySession: 'active-session',
      previewMode: 'live',
      reviewPlane: { executor: 'github-actions' },
    }],
  });
  workspace.writeJSON(workspace.paths.content('active-session', 1, { exactSession: true }), {
    session: 'active-session',
    round: 1,
    title: '第一轮',
    blocks: [],
  });
  workspace.writeJSON(workspace.paths.content('unclassified-session', 2, { exactSession: true }), {
    session: 'unclassified-session',
    round: 2,
    title: '待归类历史',
    blocks: [],
  });
  workspace.writeJSON(workspace.paths.content('archived-session', 1, { exactSession: true }), {
    session: 'archived-session',
    round: 1,
    title: '测试内容',
    blocks: [],
  });
  projects.updateSessionMetadata('active-session', {
    title: '产品主线',
    projectId: 'project-one',
    kind: 'work',
    status: 'active',
  });
  projects.updateSessionMetadata('archived-session', {
    title: '已归档测试',
    kind: 'test',
    status: 'archived',
  });

  const catalog = projects.projectCatalog();
  assert.equal(catalog.projects.length, 1);
  assert.ok(catalog.projects[0].sessions.includes('active-session'));
  assert.ok(catalog.projects[0].sessions.includes('legacy-session'));
  assert.deepEqual(catalog.projects[0].reviewPlane, { executor: 'github-actions' });
  assert.equal(catalog.sessions.find((item) => item.id === 'unclassified-session').status, 'unclassified');
  assert.equal(catalog.sessions.find((item) => item.id === 'archived-session').status, 'archived');
  assert.doesNotMatch(JSON.stringify(catalog), /\/srv\/project-one|\/srv\/memory/);

  const context = projects.executionContextForSession('active-session');
  assert.equal(context.primaryProject.repoPath, '/srv/project-one');
  assert.equal(context.session.title, '产品主线');
});

test('无元数据和失效项目归属的旧会话都保留在待归类目录', () => {
  workspace.writeJSON(workspace.paths.content('plain-legacy-session', 1, { exactSession: true }), {
    session: 'plain-legacy-session',
    round: 1,
    title: '无元数据旧会话',
    blocks: [],
  });
  workspace.writeJSON(workspace.paths.content('orphan-session', 1, { exactSession: true }), {
    session: 'orphan-session',
    round: 1,
    title: '失效归属旧会话',
    blocks: [],
  });
  projects.updateSessionMetadata('orphan-session', {
    projectId: 'removed-project',
    status: 'active',
  });

  const catalog = projects.projectCatalog();

  assert.equal(catalog.sessions.find(({ id }) => id === 'plain-legacy-session').status, 'unclassified');
  assert.equal(catalog.sessions.find(({ id }) => id === 'orphan-session').status, 'unclassified');
});

test('项目主会话必须真实归属于该项目，不能串到另一个项目', () => {
  projects.writeProjectRegistry({
    version: 1,
    projects: [
      {
        id: 'project-one',
        displayName: '项目一',
        primarySession: 'project-two-main',
      },
      {
        id: 'project-two',
        displayName: '项目二',
        primarySession: 'project-two-main',
      },
    ],
  });
  workspace.writeJSON(workspace.paths.content('project-two-main', 1, { exactSession: true }), {
    session: 'project-two-main',
    round: 1,
    title: '项目二主线',
    blocks: [],
  });
  projects.updateSessionMetadata('project-two-main', {
    projectId: 'project-two',
    status: 'active',
  });

  const catalog = projects.projectCatalog();

  assert.equal(catalog.projects.find(({ id }) => id === 'project-one').primarySession, null);
  assert.equal(catalog.projects.find(({ id }) => id === 'project-two').primarySession, 'project-two-main');
});

test('损坏项目注册表显式报错，不静默退化成空目录', () => {
  fs.writeFileSync(projects.projectRegistryPath(), '{broken', 'utf8');
  assert.throws(() => projects.readProjectRegistry(), /损坏/);
});
