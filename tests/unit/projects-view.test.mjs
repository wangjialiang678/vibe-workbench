import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectCatalogHtml } from '../../src/render/projects-view.mjs';

test('项目首页只把注册项目做成卡片，待归类与归档进入折叠档案', () => {
  const html = projectCatalogHtml({
    projects: [{
      id: 'project-one',
      displayName: '项目一',
      status: 'active',
      previewMode: 'live',
      primarySession: 'main-session',
      sessions: ['main-session'],
    }],
    sessions: [
      {
        id: 'main-session',
        title: '产品主线',
        projectId: 'project-one',
        status: 'active',
        kind: 'work',
        latestRound: 3,
      },
      {
        id: 'old-session',
        title: '待归类历史',
        projectId: null,
        status: 'unclassified',
        kind: 'review',
        latestRound: 1,
      },
      {
        id: 'test-session',
        title: '测试档案',
        projectId: null,
        status: 'archived',
        kind: 'test',
        latestRound: 1,
      },
    ],
  }, { token: 'invite-token' });

  assert.match(html, /项目主线/);
  assert.match(html, /项目一/);
  assert.match(html, /待归类 <span>1<\/span>/);
  assert.match(html, /已归档 \/ 测试 <span>1<\/span>/);
  assert.match(html, /session=main-session&amp;token=invite-token/);
});

test('项目首页对标题和说明做 HTML 转义', () => {
  const html = projectCatalogHtml({
    projects: [{
      id: 'safe',
      displayName: '<script>alert(1)</script>',
      description: '"坏属性"',
      status: 'active',
      sessions: [],
    }],
    sessions: [],
  });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;坏属性&quot;/);
});

test('项目卡片不会把其他项目的会话误当成主线入口', () => {
  const html = projectCatalogHtml({
    projects: [{
      id: 'project-one',
      displayName: '项目一',
      status: 'active',
      primarySession: 'project-two-main',
      sessions: ['project-one-main'],
    }],
    sessions: [
      { id: 'project-one-main', title: '项目一主线', status: 'active', kind: 'work', latestRound: 1 },
      { id: 'project-two-main', title: '项目二主线', status: 'active', kind: 'work', latestRound: 1 },
    ],
  });

  assert.match(html, /session=project-one-main/);
  assert.doesNotMatch(html, /session=project-two-main/);
});
