function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sessionHref(sessionId, token = '') {
  const query = new URLSearchParams({ session: sessionId });
  if (token) query.set('token', token);
  return `/render/?${query}`;
}

function sessionLink(session, token) {
  return `<a class="project-session-link" href="${escapeHtml(sessionHref(session.id, token))}">
    <span>${escapeHtml(session.title)}</span>
    <small>${escapeHtml(session.kind)} · ${escapeHtml(session.latestRound)} 轮</small>
  </a>`;
}

export function projectCatalogHtml(catalog, { token = '' } = {}) {
  const projects = Array.isArray(catalog?.projects)
    ? catalog.projects.filter((project) => project?.status === 'active')
    : [];
  const sessions = Array.isArray(catalog?.sessions) ? catalog.sessions : [];
  const byId = new Map(sessions.map((session) => [session.id, session]));

  const cards = projects.map((project) => {
    const projectSessions = (project.sessions || [])
      .map((id) => byId.get(id))
      .filter((session) => session && session.status !== 'archived');
    const primary = projectSessions.find((session) => session.id === project.primarySession)
      || projectSessions[0];
    const open = primary
      ? `<a class="project-open" href="${escapeHtml(sessionHref(primary.id, token))}">进入项目</a>`
      : '<span class="project-open is-disabled">暂无主线会话</span>';
    const links = projectSessions.length
      ? projectSessions.map((session) => sessionLink(session, token)).join('')
      : '<p class="project-empty">尚未关联会话</p>';
    return `<article class="project-card">
      <div class="project-card-head">
        <div>
          <p class="project-id">${escapeHtml(project.id)}</p>
          <h2>${escapeHtml(project.displayName)}</h2>
        </div>
        ${open}
      </div>
      <p class="project-description">${escapeHtml(project.description || '已注册项目')}</p>
      <div class="project-session-list">${links}</div>
      <p class="project-preview">预览策略：${escapeHtml(project.previewMode || 'evidence')}</p>
    </article>`;
  }).join('');

  const unclassified = sessions.filter((session) => session.status === 'unclassified');
  const archived = sessions.filter((session) => session.status === 'archived');
  const archiveSection = (title, items, hint) => `<details class="project-archive">
    <summary>${escapeHtml(title)} <span>${items.length}</span></summary>
    <p>${escapeHtml(hint)}</p>
    <div class="project-session-list">
      ${items.length ? items.map((session) => sessionLink(session, token)).join('') : '<p class="project-empty">暂无内容</p>'}
    </div>
  </details>`;

  return `<section class="project-home-view">
    <header class="project-home-head">
      <p class="document-eyebrow">PROJECTS</p>
      <h1>项目主线</h1>
      <p>项目与会话已经分开：这里只展示显式注册的长期项目，评审、测试和历史讨论保留在各自档案中。</p>
    </header>
    <div class="project-grid">${cards || '<p class="project-empty">尚未注册项目</p>'}</div>
    <section class="project-archives">
      ${archiveSection('待归类', unclassified, '保留真实历史，但在确认仓库归属前不把它们当成项目。')}
      ${archiveSection('已归档 / 测试', archived, '仅隐藏，不删除；旧链接、轮次、反馈、附件和文档仍可打开。')}
    </section>
  </section>`;
}
