#!/usr/bin/env node
// 第一次项目化迁移：幂等写项目注册表与 session.json，不移动或删除任何会话目录。
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  sessionExists,
  updateSessionMetadata,
  writeProjectRegistry,
} from '../src/projects.mjs';

export const PROJECTS_V1 = [
  {
    id: 'user-vibeloop',
    displayName: 'User Vibe Loop（用户反馈闭环）',
    description: '分布式反馈、评判、短分支修改、合并与复验闭环。',
    status: 'active',
    repoPath: '/home/ubuntu/apps/user-vibeloop',
    memoryPath: '/home/ubuntu/agent-memory/user-vibeloop',
    primarySession: 'user-vibeloop',
    aliases: [],
    previewMode: 'hybrid',
  },
  {
    id: 'vibecoding-workbench',
    displayName: 'Vibe Coding 工作台',
    description: '对话、决策卡、文档与多人协作的人机交互层。',
    status: 'active',
    repoPath: '/home/ubuntu/apps/vibecoding-workbench',
    memoryPath: '/home/ubuntu/agent-memory/vibecoding-workbench',
    primarySession: 'vibeloop-interaction-v2',
    aliases: ['wb-arch'],
    previewMode: 'live',
  },
  {
    id: 'paper-edit-studio',
    displayName: 'Paper Edit Studio（AI 视频剪辑）',
    description: '本地 HTTP 服务形态的文字剪视频产品。',
    status: 'active',
    repoPath: '/home/ubuntu/apps/ai-video-paper-edit',
    memoryPath: '/home/ubuntu/agent-memory/paper-edit-studio',
    primarySession: 'pes-overview',
    aliases: ['ai-video-paper-edit'],
    previewMode: 'hybrid',
  },
];

export const SESSIONS_V1 = {
  'user-vibeloop': {
    title: 'User Vibe Loop 产品主线',
    topicSlug: 'product-mainline',
    projectId: 'user-vibeloop',
    kind: 'work',
    status: 'active',
  },
  'wb-arch': {
    title: '工作台架构设计',
    topicSlug: 'workbench-architecture',
    projectId: 'vibecoding-workbench',
    kind: 'review',
    status: 'closed',
  },
  'vibeloop-interaction-v2': {
    title: '多项目、预览与本地执行设计',
    topicSlug: 'multi-project-preview',
    projectId: 'vibecoding-workbench',
    relatedProjectIds: ['user-vibeloop'],
    kind: 'decision',
    status: 'active',
  },
  'pes-overview': {
    title: 'Paper Edit Studio 产品主线',
    topicSlug: 'product-mainline',
    projectId: 'paper-edit-studio',
    kind: 'work',
    status: 'active',
  },
  'vibeloop-cutpoint-rollout': {
    title: 'Paper Edit Studio 接入反馈闭环',
    topicSlug: 'vibeloop-rollout',
    projectId: 'paper-edit-studio',
    relatedProjectIds: ['user-vibeloop'],
    kind: 'work',
    status: 'closed',
  },
  'annot-test': { title: '批注体验验证', topicSlug: 'annotation-test', kind: 'test', status: 'archived' },
  cmt: { title: '批注测试', topicSlug: 'comment-test', kind: 'test', status: 'archived' },
  demo: { title: '冒烟演示', topicSlug: 'smoke-demo', kind: 'test', status: 'archived' },
  'embed-demo': { title: '嵌入批注演示', topicSlug: 'embed-demo', kind: 'test', status: 'archived' },
  'facet-demo': { title: '分面导航演示', topicSlug: 'facet-demo', kind: 'test', status: 'archived' },
  'imported-demo': { title: '导入示例', topicSlug: 'import-demo', kind: 'test', status: 'archived' },
  skilltest: { title: 'Present 技能冒烟', topicSlug: 'present-skill-test', kind: 'test', status: 'archived' },
  urltest: { title: 'URL 测试', topicSlug: 'url-test', kind: 'test', status: 'archived' },
  'verify-blocks': { title: '区块验证', topicSlug: 'block-verification', kind: 'test', status: 'archived' },
  'verify-diff': { title: '差异验证', topicSlug: 'diff-verification', kind: 'test', status: 'archived' },
  'course-system': { title: '课程体系设计', topicSlug: 'course-system', kind: 'review', status: 'unclassified' },
  'h5-gamebox': { title: 'H5 游戏盒子原型', topicSlug: 'h5-gamebox', kind: 'review', status: 'unclassified' },
  'kexue-tutorial': { title: '科学教程页面与 PDF', topicSlug: 'science-tutorial', kind: 'review', status: 'unclassified' },
  'meeting-scribe-ui-confirm-20260713': {
    title: 'Meeting Scribe 交互与 UI 确认',
    topicSlug: 'interaction-ui-review',
    kind: 'review',
    status: 'unclassified',
  },
  'meetingai-v2-review': {
    title: '会议产品设计评审',
    topicSlug: 'design-review',
    kind: 'review',
    status: 'unclassified',
  },
  'ms-design-verify-0704': {
    title: 'Meeting Scribe 设计方案验证',
    topicSlug: 'design-verification',
    kind: 'review',
    status: 'unclassified',
  },
  'prd-recorder': {
    title: '会议录音转写 App PRD',
    topicSlug: 'recorder-prd',
    kind: 'review',
    status: 'unclassified',
  },
  'tms-kickoff': { title: '非洲物流 TMS 启动会', topicSlug: 'tms-kickoff', kind: 'review', status: 'unclassified' },
  'waic-v2': { title: 'WAIC 日程助手需求与架构', topicSlug: 'waic-schedule', kind: 'review', status: 'unclassified' },
};

export function migrateProjectsV1() {
  const missing = Object.keys(SESSIONS_V1).filter((session) => !sessionExists(session));
  if (missing.length) {
    throw new Error(`迁移中止：以下会话目录不存在：${missing.join(', ')}`);
  }

  writeProjectRegistry({ version: 1, projects: PROJECTS_V1 });
  for (const [session, metadata] of Object.entries(SESSIONS_V1)) {
    updateSessionMetadata(session, metadata, { exactSession: true });
  }

  return {
    ok: true,
    projects: PROJECTS_V1.length,
    sessions: Object.keys(SESSIONS_V1).length,
    archived: Object.values(SESSIONS_V1).filter((item) => item.status === 'archived').length,
    unclassified: Object.values(SESSIONS_V1).filter((item) => item.status === 'unclassified').length,
  };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(migrateProjectsV1())}\n`);
}
