// 控制塔浏览器入口：只读取服务端快照，不持有任何 loop 管理员口令，也不提供控制动作。
import { controlProjectCardHtml } from './view.mjs';
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const pageSize = 20;
let currentPage = 1;
let snapshot = null;

const $ = (selector) => document.querySelector(selector);
const overview = $('#control-overview');
const timeline = $('#control-timeline');
const health = $('#control-health');
const pagination = $('#control-pagination');
const updated = $('#control-updated');
const refresh = $('#control-refresh');
const filters = $('#control-filters');

function text(value, fallback = '未知') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function element(name, className, content) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function stateClass(value) {
  const lower = String(value || '').toLowerCase();
  if (['在线', '正常', '通过', '已完成', '有拉取记录', 'active', 'success'].some((item) => lower.includes(item))) return 'control-state--good';
  if (['异常', '失败', '离线', '取不到', 'failed', 'error'].some((item) => lower.includes(item))) return 'control-state--bad';
  return 'control-state--unknown';
}

function localTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function humanSentence(event) {
  return `${localTime(event.at)} ${text(event.actor?.name, '系统')} 在 ${text(event.location?.projectName, '未标明项目')} ${text(event.action?.label, '完成了一项工作')}，${text(event.result?.summary, '结果未知')}`;
}

function relativeLink(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // 只有同源入口继承既有工作台令牌；永远不附带各 loop 的管理员口令。
    if (token && url.origin === location.origin) url.searchParams.set('token', token);
    return url.href;
  } catch { return null; }
}

function appendLink(parent, label, href) {
  const safe = relativeLink(href);
  if (!safe) return;
  const link = element('a', '', label);
  link.href = safe;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  parent.append(link);
}

function renderOverview(projects) {
  overview.replaceChildren();
  if (!projects.length) { overview.append(element('p', 'control-empty', '暂时没有已注册项目。')); return; }
  for (const project of projects) {
    const template = document.createElement('template');
    template.innerHTML = controlProjectCardHtml(project).trim();
    const card = template.content.firstElementChild;
    card.querySelectorAll('a').forEach((link) => {
      const safe = relativeLink(link.getAttribute('href'));
      if (safe) link.href = safe;
      else link.remove();
    });
    overview.append(card);
  }
}

function renderTimeline(items) {
  timeline.replaceChildren();
  if (!items.length) { timeline.append(element('p', 'control-empty', '这个筛选条件下没有记录。')); return; }
  for (const event of items) {
    const card = element('article', 'control-timeline-card');
    const summary = element('div', 'control-timeline-summary');
    summary.append(element('time', 'control-timeline-time', localTime(event.at)));
    const copy = document.createElement('div');
    copy.append(element('p', '', humanSentence(event)));
    copy.append(element('small', '', `地点：${event.location.projectName}${event.location.session ? ` · 会话 ${event.location.session}` : ''} · 结果：${event.result.summary}`));
    summary.append(copy);
    const details = document.createElement('details');
    details.append(element('summary', '', '查看原始记录和技术细节'));
    const detailsBody = element('div', 'control-timeline-details');
    detailsBody.append(element('p', '', `谁：${event.actor.name}｜在哪：${event.location.projectName}｜做了什么：${event.action.label}｜结果：${event.result.summary}`));
    const links = element('div', 'control-context-links');
    appendLink(links, '打开相关位置', event.location.url);
    appendLink(links, '打开结果链接', event.result.url);
    if (links.children.length) detailsBody.append(links);
    const raw = element('pre', '');
    raw.textContent = JSON.stringify(event.raw, null, 2);
    detailsBody.append(raw);
    details.append(detailsBody);
    card.append(summary, details);
    timeline.append(card);
  }
}

function healthRow(label, value) {
  const row = document.createElement('div');
  row.append(element('dt', '', label));
  row.append(element('dd', stateClass(value), text(value)));
  return row;
}

function healthCard(title, explanation, rows) {
  const card = element('article', 'control-health-card');
  card.append(element('h3', '', title), element('p', '', explanation));
  const list = element('dl', 'control-health-list');
  rows.forEach(([label, value]) => list.append(healthRow(label, value)));
  card.append(list);
  return card;
}

function renderHealth(data) {
  health.replaceChildren();
  const services = (data.services || []).map((item) => [item.unit, `${item.state}${item.lastStartedAt && item.lastStartedAt !== '未知' ? ` · 最近启动 ${item.lastStartedAt}` : ''}`]);
  health.append(healthCard('后台服务', 'systemd（Linux 的后台服务管理器）是否还在运行；取不到时会明确标为未知。', services.length ? services : [['服务状态', '未知']]));
  health.append(healthCard('干活机器', '云端 worker（常驻干活程序）、本地监听器和 GitHub Actions（云端自动运行的任务）的最近状态。', [
    ['云端 worker', `${data.execution?.cloudWorker?.state || '未知'}${data.execution?.cloudWorker?.at ? ` · ${localTime(data.execution.cloudWorker.at)}` : ''}`],
    ['本地监听器最近拉取', `${data.execution?.localListener?.state || '未知'}${data.execution?.localListener?.at ? ` · ${localTime(data.execution.localListener.at)}` : ''}`],
    ['GitHub Actions 最近运行', `${data.execution?.githubActions?.state || '未知'}${data.execution?.githubActions?.at ? ` · ${localTime(data.execution.githubActions.at)}` : ''}`],
  ]));
  const disk = data.disk || {};
  const logs = data.logs || {};
  health.append(healthCard('磁盘与日志水位', '服务器还剩多少空间，以及日志占了多少；接近满时更容易让任务出问题。', [
    ['已使用', disk.availability === 'available' ? `${disk.usedPercent}%` : '未知'],
    ['日志占用', logs.availability === 'available' ? `${Math.round((logs.usedBytes || 0) / 1024 / 1024)} MiB` : '未知'],
  ]));
  health.append(healthCard('场外看门狗', '看门狗会从工作台外部巡检；工作台本身不可达时，它仍能留下最近结果。', [[
    '最近巡检', `${data.watchdog?.result || '未知'}${data.watchdog?.at ? ` · ${localTime(data.watchdog.at)}` : ''}`,
  ]]));
}

function replaceSelectOptions(select, values, placeholder) {
  const selected = select.value;
  select.replaceChildren(new Option(placeholder, ''));
  for (const [value, label] of values) select.add(new Option(label, value));
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function refreshFilterOptions(data) {
  replaceSelectOptions($('#filter-project'), (data.overview || []).map((project) => [project.id, project.displayName]), '全部项目');
  const facets = data.timeline?.facets || {};
  replaceSelectOptions($('#filter-executor'), (facets.executors || []).map((item) => [item.value, item.label]), '全部');
  replaceSelectOptions($('#filter-type'), (facets.types || []).map((item) => [item.value, item.label]), '全部类型');
}

function renderPagination(data) {
  pagination.replaceChildren();
  const timelineData = data.timeline;
  if (!timelineData || timelineData.totalPages < 2) return;
  const previous = element('button', '', '上一页');
  previous.type = 'button'; previous.disabled = timelineData.page <= 1;
  previous.addEventListener('click', () => load(timelineData.page - 1));
  const next = element('button', '', '下一页');
  next.type = 'button'; next.disabled = timelineData.page >= timelineData.totalPages;
  next.addEventListener('click', () => load(timelineData.page + 1));
  pagination.append(previous, element('span', '', `第 ${timelineData.page} / ${timelineData.totalPages} 页，共 ${timelineData.total} 条`), next);
}

function query(page) {
  const input = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const [key, value] of new FormData(filters)) if (value) input.set(key, String(value));
  return input;
}

async function load(page = 1) {
  currentPage = page;
  refresh.disabled = true;
  updated.textContent = '正在读取…';
  try {
    const response = await fetch(`/api/control-tower?${query(page)}`, {
      headers: token ? { 'x-workbench-token': token } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    snapshot = await response.json();
    renderOverview(snapshot.overview || []);
    renderTimeline(snapshot.timeline?.items || []);
    renderHealth(snapshot.health || {});
    refreshFilterOptions(snapshot);
    renderPagination(snapshot);
    updated.textContent = `${snapshot.cache?.hit ? '已使用短暂缓存' : '刚刚读取'} · ${localTime(snapshot.generatedAt)}`;
  } catch {
    overview.replaceChildren(element('p', 'control-empty', '现在取不到控制塔数据，请稍后刷新。'));
    timeline.replaceChildren(element('p', 'control-empty', '现在取不到活动记录，请稍后刷新。'));
    health.replaceChildren(element('p', 'control-empty', '现在取不到系统健康信息，请稍后刷新。'));
    updated.textContent = '取不到数据';
  } finally {
    refresh.disabled = false;
  }
}

filters.addEventListener('change', () => load(1));
refresh.addEventListener('click', () => load(currentPage));
void load();
