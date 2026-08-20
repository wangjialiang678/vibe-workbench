// 控制塔浏览器与服务端共用的无状态项目卡片视图。

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function availabilityText(loop) {
  if (loop?.availability === 'available') return '已取到';
  if (loop?.availability === 'not-applicable') return '此项目暂未接入工单闭环';
  return typeof loop?.message === 'string' && loop.message.trim() ? loop.message : '取不到';
}

function safeHref(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? raw : null;
  } catch { return null; }
}

function linkHtml(label, href) {
  const safe = safeHref(href);
  if (!safe) return '';
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function controlProjectCardHtml(project) {
  const level = Number.isInteger(project?.level) ? project.level : 0;
  const links = project?.links && typeof project.links === 'object' ? project.links : {};
  const attention = Number(project?.attentionCount || 0);
  const workItems = level === 0 ? '' : `<dl class="control-project-work-items">
    <div><dt>在办工单</dt><dd>${escapeHtml(project?.workItems?.open ?? '取不到')}</dd></div>
    <div><dt>等你拍板</dt><dd class="${attention > 0 ? 'is-attention' : ''}">${escapeHtml(attention)}</dd></div>
  </dl>`;
  const actionLinks = [
    linkHtml('反馈入口', links.feedback),
    linkHtml('工单面板', links.tickets),
    linkHtml('主线会话', links.session),
  ].filter(Boolean).join('');
  return `<article class="control-project-card">
    <header><div><p class="control-project-id">L${level} · ${escapeHtml(project?.id || '')}</p><h3>${escapeHtml(project?.displayName || project?.id || '未命名项目')}</h3></div>
      <span class="control-availability control-availability--${escapeHtml(project?.loop?.availability || 'unavailable')}">${escapeHtml(availabilityText(project?.loop))}</span></header>
    <dl class="control-project-facts">
      <div><dt>服务状态</dt><dd>${escapeHtml(project?.service?.label || availabilityText(project?.loop))}</dd></div>
      <div><dt>执行面（干活的机器）</dt><dd>${escapeHtml(project?.executor?.label || '未知')}</dd></div>
      <div><dt>最近活动</dt><dd>${escapeHtml(project?.recentActivity || '暂无记录')}</dd></div>
    </dl>
    ${workItems}
    <nav class="control-project-links" aria-label="项目入口">${actionLinks || '<span>暂无入口链接</span>'}</nav>
  </article>`;
}
