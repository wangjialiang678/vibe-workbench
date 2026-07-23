// 浏览器入口（不单测）。
// 职责：读 URL → fetch 内容 → 渲染 → 草稿存 localStorage → 提交 → 轮询状态。
// 纯 DOM 事件绑定放在这里，渲染器是纯函数导入。
import { renderZones } from './attention-view.mjs';
import { participantFeedbackHtml } from './blocks.mjs';
import { diffToggleHtml } from './diff-view.mjs';
import { statusBadgeHtml } from './status-bar.mjs';
import { documentsPanelHtml, historyRoundsHtml } from './documents-view.mjs';
import {
  attachmentMessageMarkdown,
  clampStreamPanelWidth,
  collectAssetLinks,
  composerValueAfterSend,
  containerPinPopoverPosition,
  decisionChipForLatestReceipt,
  streamEntryHtml,
} from './stream-view.mjs';
import {
  unansweredDecisions,
  confirmModel,
  countAnsweredDecisions,
  groupBySection,
  pendingDecisionBlocks,
  sectionPendingStats,
} from '../protocol/attention.mjs';

// ── URL 参数 ──────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SESSION = params.get('session') ?? '';
const URL_ROUND = params.get('round') ?? '';   // 可空：留空 = 自动跟随最新一轮（固定 URL）
const TOKEN = params.get('token') ?? '';

// 所有同源 API URL 统一透传页面 token。
function apiUrl(input) {
  const url = new URL(input, location.origin);
  if (TOKEN) url.searchParams.set('token', TOKEN);
  return `${url.pathname}${url.search}${url.hash}`;
}

// 当前展示的轮次；为 null 时在 bootstrap 里解析为服务端最新一轮，并可随新轮自动推进
let currentRound = URL_ROUND !== '' ? Number(URL_ROUND) : null;
let _latestRound = currentRound;
// URL 未带 round = "跟随最新轮"模式（bootstrap 解析最新 + 轮询自动推进）；
// 带了 round=N = 用户锁定该轮，绝不自动跳走。
const FOLLOW_LATEST = URL_ROUND === '';

function draftKey(round = currentRound) { return `wb:${SESSION}:${round}:fb`; }

// ── 元素引用 ─────────────────────────────────────────────
const $zones        = document.getElementById('zones-mount');
const $statusMount  = document.getElementById('status-badge-mount');
const $diffMount    = document.getElementById('diff-toggle-mount');
const $submitBtn    = document.getElementById('submit-btn');
const $sessionLabel = document.getElementById('session-label');
const $sessionNav   = document.getElementById('session-nav');
const $docsLink     = document.getElementById('docs-link');
const $sessionComment = document.getElementById('session-comment-input');   // 会话级留言（P1）
const $workspaceShell = document.getElementById('workspace-shell');
const $splitter = document.getElementById('workspace-splitter');
const $streamEntries = document.getElementById('stream-entries');
const $streamConnection = document.getElementById('stream-connection');
const $streamMigrationHint = document.getElementById('stream-migration-hint');
const $streamComposer = document.getElementById('stream-composer');
const $streamInput = document.getElementById('stream-input');
const $streamFileInput = document.getElementById('stream-file-input');
const $streamSendBtn = document.getElementById('stream-send-btn');
const $streamSendStatus = document.getElementById('stream-send-status');
const $documentsMount = document.getElementById('documents-mount');
const $historyRoundsMount = document.getElementById('history-rounds-mount');
const $streamUnreadBadge = document.getElementById('stream-unread-badge');
const $decisionUnreadBadge = document.getElementById('decision-unread-badge');

// CSS 选择器防守（id 含特殊字符时不失效）
function cssEsc(v) {
  return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(v)) : String(v);
}

// 会话级留言草稿键（与块草稿分开存，避免污染 answeredIds）
function scKey() { return `wb:${SESSION}:${currentRound}:sc`; }

function contentLink(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const target = new URL(raw, location.origin);
    if (!['http:', 'https:'].includes(target.protocol)) return null;
    // 仅同源设计资产继承 bearer token，外站绝不附带口令。
    if (TOKEN && target.origin === location.origin) target.searchParams.set('token', TOKEN);
    return target.href;
  } catch { return null; }
}

function updateDocsLink(docsUrl) {
  if (!$docsLink) return;
  const href = contentLink(docsUrl);
  $docsLink.hidden = !href;
  if (href) $docsLink.href = href;
  else $docsLink.removeAttribute('href');
}

async function loadSessions() {
  if (!$sessionNav) return;
  try {
    const response = await fetch(apiUrl('/api/sessions'));
    if (!response.ok) return;
    const data = await response.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    $sessionNav.replaceChildren(new Option('会话列表', ''));
    for (const session of sessions) $sessionNav.add(new Option(session, session, false, session === SESSION));
  } catch { /* 导航失败不影响当前会话 */ }
}

$sessionNav?.addEventListener('change', () => {
  if (!$sessionNav.value) return;
  const target = new URL('/render/', location.origin);
  target.searchParams.set('session', $sessionNav.value);
  if (TOKEN) target.searchParams.set('token', TOKEN);
  location.assign(target.href);
});

if ($sessionComment) {
  $sessionComment.addEventListener('input', () => {
    try { localStorage.setItem(scKey(), $sessionComment.value); } catch { /* 忽略 */ }
  });
}

// ── 桌面分栏 / 手机三区切换 ───────────────────────────────
let _activeView = 'decision';
let _streamUnread = 0;
let _pinRepositionQueued = false;

function isNarrowScreen() {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
}

function setBadge($badge, count) {
  if (!$badge) return;
  $badge.textContent = String(count);
  $badge.hidden = count < 1;
}

function pendingDecisionCount() {
  return Math.max(0, pendingDecisionBlocks(_blocks).length - countAnsweredDecisions(_blocks, loadDraft()));
}

function updateMobileBadges() {
  setBadge($streamUnreadBadge, _streamUnread);
  setBadge($decisionUnreadBadge, pendingDecisionCount());
}

function setActiveView(view, { scrollTop = false } = {}) {
  if (!['stream', 'decision', 'documents'].includes(view)) return;
  _activeView = view;
  if ($workspaceShell) $workspaceShell.dataset.activeView = view;

  const contentView = view === 'documents' ? 'documents' : 'decision';
  document.querySelectorAll('[data-content-view]').forEach((panel) => {
    panel.hidden = panel.dataset.contentView !== contentView;
  });
  document.querySelectorAll('.content-switch-btn').forEach((button) => {
    const active = button.dataset.view === contentView;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.mobile-tab').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === view);
  });
  if ($submitBtn) {
    $submitBtn.hidden = isNarrowScreen() ? view !== 'decision' : contentView !== 'decision';
  }

  if (view === 'stream') {
    _streamUnread = 0;
    setBadge($streamUnreadBadge, 0);
    requestAnimationFrame(() => {
      if ($streamEntries) $streamEntries.scrollTop = $streamEntries.scrollHeight;
      if (isNarrowScreen()) window.scrollTo({ top: 0 });
      else $streamInput?.focus();
    });
  }
  if (view === 'documents') void loadDocumentsPanel();
  if (view === 'decision') {
    repositionVisiblePinComments();
    if (scrollTop) {
      requestAnimationFrame(() => {
        if (isNarrowScreen()) window.scrollTo({ top: 0, behavior: 'smooth' });
        else document.getElementById('content-region')?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }
  updateMobileBadges();
}

document.querySelectorAll('.content-switch-btn, .mobile-tab').forEach((button) => {
  button.addEventListener('click', () => setActiveView(button.dataset.view));
});

// 拖动分隔线调整会话流宽度，并按会话持久化。
const splitWidthKey = `wb:${SESSION}:stream-width`;
let _preferredStreamWidth = null;

function clampStreamWidth(value) {
  return clampStreamPanelWidth(value, window.innerWidth);
}

function applyStreamWidth(value, { persist = false } = {}) {
  const width = clampStreamWidth(value);
  $workspaceShell?.style.setProperty('--stream-panel-width', `${width}px`);
  $splitter?.setAttribute('aria-valuenow', String(Math.round(width)));
  if (persist) {
    _preferredStreamWidth = Math.round(width);
    try { localStorage.setItem(splitWidthKey, String(Math.round(width))); } catch { /* 忽略 */ }
  }
  repositionVisiblePinComments();
}

try {
  const savedWidth = Number(localStorage.getItem(splitWidthKey));
  if (savedWidth > 0) {
    _preferredStreamWidth = savedWidth;
    applyStreamWidth(savedWidth);
  }
} catch { /* 忽略 */ }

function syncResponsiveLayout() {
  if (!isNarrowScreen()) applyStreamWidth(_preferredStreamWidth || window.innerWidth * .33);
  const contentView = _activeView === 'documents' ? 'documents' : 'decision';
  if ($submitBtn) {
    $submitBtn.hidden = isNarrowScreen() ? _activeView !== 'decision' : contentView !== 'decision';
  }
}

window.addEventListener('resize', syncResponsiveLayout);

$splitter?.addEventListener('pointerdown', (event) => {
  if (isNarrowScreen()) return;
  event.preventDefault();
  $splitter.setPointerCapture?.(event.pointerId);
  $workspaceShell?.classList.add('is-resizing');
  const onMove = (moveEvent) => applyStreamWidth(moveEvent.clientX);
  const onUp = (upEvent) => {
    $splitter.releasePointerCapture?.(upEvent.pointerId);
    $splitter.removeEventListener('pointermove', onMove);
    $splitter.removeEventListener('pointerup', onUp);
    $workspaceShell?.classList.remove('is-resizing');
    const width = parseFloat(getComputedStyle($workspaceShell).getPropertyValue('--stream-panel-width'));
    applyStreamWidth(width, { persist: true });
  };
  $splitter.addEventListener('pointermove', onMove);
  $splitter.addEventListener('pointerup', onUp);
});

$splitter?.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const current = parseFloat(getComputedStyle($workspaceShell).getPropertyValue('--stream-panel-width')) || 360;
  applyStreamWidth(current + (event.key === 'ArrowRight' ? 16 : -16), { persist: true });
});

// ── 原型「编辑」模式：拖动 / 缩放控件（零依赖原生 pointer events，复刻 prd-studio 的 interact.js 拖拽）──
function bindPrototypeEdit() {
  // 模式切换（批注 / 编辑）
  $zones.querySelectorAll('[data-proto-modes]').forEach((bar) => {
    const bid = bar.dataset.protoModes;
    const canvas = $zones.querySelector(`[data-proto-canvas="${cssEsc(bid)}"]`);
    if (!canvas) return;
    bar.querySelectorAll('[data-proto-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.protoMode;
        canvas.dataset.mode = m;
        bar.querySelectorAll('[data-proto-mode]').forEach((b) => b.classList.toggle('active', b === btn));
        const hint = bar.querySelector('[data-proto-hint]');
        if (hint) {
          hint.textContent = m === 'edit'
            ? '拖动控件移位；拖右下角缩放。改动随反馈一起提交给 AI'
            : '点图上任意处落 pin 批注';
        }
      });
    });
    bar.querySelector('[data-proto-reset]')?.addEventListener('click', () => resetMoves(bid));
    updateResetBtn(bid);
  });

  // 每个控件绑拖拽/缩放
  $zones.querySelectorAll('[data-proto-widget]').forEach(bindWidgetDrag);
}

function bindWidgetDrag(w) {
  const bid = w.dataset.protoWidget;
  const wid = w.dataset.widgetId;
  const canvas = $zones.querySelector(`[data-proto-canvas="${cssEsc(bid)}"]`);
  if (!canvas) return;

  w.addEventListener('pointerdown', (e) => {
    if (canvas.dataset.mode !== 'edit') return;          // 仅编辑模式响应
    const resizing = !!e.target.closest('[data-proto-resize]');
    e.preventDefault();
    e.stopPropagation();
    try { w.setPointerCapture(e.pointerId); } catch { /* 无效 pointerId（如合成事件）→ 不影响拖拽 */ }

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const x0 = parseFloat(w.style.left) || 0;
    const y0 = parseFloat(w.style.top) || 0;
    const w0 = parseFloat(w.style.width) || 10;
    const h0 = parseFloat(w.style.height) || 5;

    const onMove = (ev) => {
      const dx = ((ev.clientX - sx) / rect.width) * 100;
      const dy = ((ev.clientY - sy) / rect.height) * 100;
      if (resizing) {
        w.style.width = `${Math.max(3, Math.min(100 - x0, w0 + dx))}%`;
        w.style.height = `${Math.max(1.5, Math.min(100 - y0, h0 + dy))}%`;
      } else {
        w.style.left = `${Math.max(0, Math.min(100 - w0, x0 + dx))}%`;
        w.style.top = `${Math.max(0, Math.min(100 - h0, y0 + dy))}%`;
      }
    };
    const onUp = () => {
      w.removeEventListener('pointermove', onMove);
      w.removeEventListener('pointerup', onUp);
      saveMove(bid, wid, {
        x: (parseFloat(w.style.left) || 0) / 100,
        y: (parseFloat(w.style.top) || 0) / 100,
        w: (parseFloat(w.style.width) || 0) / 100,
        h: (parseFloat(w.style.height) || 0) / 100,
      });
      w.classList.add('pw-moved');
      updateResetBtn(bid);
    };
    w.addEventListener('pointermove', onMove);
    w.addEventListener('pointerup', onUp);
  });
}

function saveMove(bid, wid, geo) {
  const cur = loadDraft()[bid] ?? {};
  saveDraft({ [bid]: { ...cur, moves: { ...(cur.moves ?? {}), [wid]: geo } } });
}

function resetMoves(bid) {
  const cur = { ...(loadDraft()[bid] ?? {}) };
  delete cur.moves;
  saveDraft({ [bid]: cur });
  loadAndRender();                                        // 重渲染回原位
}

function updateResetBtn(bid) {
  const btn = $zones.querySelector(`[data-proto-reset="${cssEsc(bid)}"]`);
  if (btn) btn.hidden = Object.keys(loadDraft()[bid]?.moves ?? {}).length === 0;
}

function restoreMoves(blockId, moves) {
  Object.entries(moves ?? {}).forEach(([wid, g]) => {
    const w = $zones.querySelector(`[data-proto-widget="${cssEsc(blockId)}"][data-widget-id="${cssEsc(wid)}"]`);
    if (!w) return;
    w.style.left = `${(g.x ?? 0) * 100}%`;
    w.style.top = `${(g.y ?? 0) * 100}%`;
    w.style.width = `${(g.w ?? 0) * 100}%`;
    w.style.height = `${(g.h ?? 0) * 100}%`;
    w.classList.add('pw-moved');
  });
  updateResetBtn(blockId);
}

// editable「保持原样即确认」的读态切换（P2 · 病例 5）
function markEditableConfirmed(bid) {
  const btn = $zones.querySelector(`[data-editable-confirm="${cssEsc(bid)}"]`);
  const tag = $zones.querySelector(`[data-editable-confirmed="${cssEsc(bid)}"]`);
  if (btn) btn.hidden = true;
  if (tag) tag.hidden = false;
}
const $confirmDialog = document.getElementById('confirm-dialog');

function updateSessionLabel() {
  $sessionLabel.textContent = SESSION
    ? `会话 ${SESSION}  ·  轮 ${currentRound ?? '…'}`
    : '（无会话）';
}
updateSessionLabel();

// ── 草稿 ─────────────────────────────────────────────────
function loadDraft(round = currentRound) {
  try { return JSON.parse(localStorage.getItem(draftKey(round)) ?? 'null') ?? {}; }
  catch { return {}; }
}

function saveDraft(patch) {
  const draft = loadDraft();
  Object.assign(draft, patch);
  localStorage.setItem(draftKey(), JSON.stringify(draft));
}

// ── 渲染 ─────────────────────────────────────────────────
let _blocks = [];        // 当前轮 blocks（带 _change）
let _latestBlocks = [];  // 最新轮 blocks；锁定历史轮时供流内决策芯片独立计数
let _sectionData = null; // content.sections（tab 分面类目顺序，可空）
let _currentContent = null;
let _documentsCacheKey = '';
let _documentsViewModel = null;
let _historyRoundsCacheKey = '';

async function loadAndRender() {
  let data;
  try {
    const resp = await fetch(apiUrl(`/api/content?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(currentRound)}`));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    $zones.innerHTML = `<p class="load-error">加载内容失败：${escapeHtml(String(err.message))}</p>`;
    return;
  }

  _currentContent = data;
  _blocks = data.blocks ?? [];
  if (Number(currentRound) === Number(_latestRound)) _latestBlocks = _blocks;
  _sectionData = data.sections ?? null;
  _documentsCacheKey = '';
  updateDocsLink(data.meta?.docsUrl);
  // template 中先给受保护资源补 token，再挂进 DOM，避免首次加载就被门禁拒绝。
  const rendered = document.createElement('template');
  rendered.innerHTML = renderZones(_blocks, { round: currentRound, sections: _sectionData });
  rendered.content.querySelectorAll('iframe[src^="/api/"], [src^="/assets/"], [href^="/assets/"]').forEach((element) => {
    const attribute = element.hasAttribute('src') ? 'src' : 'href';
    element.setAttribute(attribute, apiUrl(element.getAttribute(attribute)));
  });
  $zones.replaceChildren(rendered.content);

  // 议题重组提示（DESIGN §5 + §13 P1）：服务端注入 sanity.suspect 时顶部横幅（前端消费）
  if (data.sanity && data.sanity.suspect) {
    $zones.insertAdjacentHTML('afterbegin', reintroBannerHtml());
    const closeBtn = $zones.querySelector('.reintro-banner .reintro-close');
    if (closeBtn) closeBtn.addEventListener('click', () => closeBtn.closest('.reintro-banner')?.remove());
  }

  // 注入 diff 开关
  $diffMount.innerHTML = diffToggleHtml();

  // 恢复草稿 UI（简单：遍历 textarea/input）
  restoreDraftUI(loadDraft());

  // 恢复会话级留言草稿（P1）
  if ($sessionComment) {
    try { $sessionComment.value = localStorage.getItem(scKey()) ?? ''; } catch { /* 忽略 */ }
  }

  // 决策进度：按已恢复草稿初始化「已填 m/X」（DESIGN §13 P2）+ tab 角标
  updateDecisionProgress();

  // tab 分面：按草稿选默认激活面（第一个含未确认必须决策的非空面）
  activateDefaultFacet();

  // 激活 mermaid
  if (window.mermaid) {
    try { window.mermaid.run(); } catch { /* 降级 */ }
  }

  // 绑定互动事件
  bindInteractions();
  await loadParticipantFeedback();
  updateMobileBadges();
}

async function loadParticipantFeedback() {
  if (!SESSION || currentRound == null) return;
  try {
    const response = await fetch(apiUrl(`/api/feedback?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(currentRound)}`));
    if (!response.ok) return;
    const data = await response.json();
    $zones.querySelectorAll('.participant-feedbacks').forEach((element) => element.remove());
    if (!data.ok || !Array.isArray(data.byParticipant)) return;
    for (const block of _blocks) {
      const html = participantFeedbackHtml(block, data.byParticipant, data.conflicts || []);
      if (!html) continue;
      const host = $zones.querySelector(`[data-block-id="${cssEsc(block.id)}"]`);
      if (!host) continue;
      const template = document.createElement('template');
      template.innerHTML = html;
      host.append(template.content);
    }
  } catch { /* 意见轮询失败不影响自己的填写流程 */ }
}

// ── 会话流 ───────────────────────────────────────────────
let _viewerId = '';
let _lastStreamId = '';
const _seenStreamIds = new Set();
const _streamEntriesData = [];

function latestPendingDecisionCount() {
  return Math.max(
    0,
    pendingDecisionBlocks(_latestBlocks).length
      - countAnsweredDecisions(_latestBlocks, loadDraft(_latestRound)),
  );
}

function setStreamConnection(label, state = '') {
  if (!$streamConnection) return;
  $streamConnection.textContent = label;
  $streamConnection.dataset.state = state;
}

function streamTemplate(entry) {
  const template = document.createElement('template');
  template.innerHTML = streamEntryHtml(entry, { viewerId: _viewerId });
  template.content.querySelectorAll('[src^="/assets/"], [href^="/assets/"]').forEach((element) => {
    const attribute = element.hasAttribute('src') ? 'src' : 'href';
    element.setAttribute(attribute, apiUrl(element.getAttribute(attribute)));
  });
  return template;
}

function refreshDecisionChip() {
  if (!$streamEntries) return;
  $streamEntries.querySelectorAll('.stream-decision-chip').forEach((chip) => chip.remove());
  const model = decisionChipForLatestReceipt(_streamEntriesData, {
    latestRound: _latestRound,
    pendingCount: latestPendingDecisionCount(),
  });
  if (!model) return;
  const receipt = $streamEntries.querySelector(`[data-entry-id="${cssEsc(model.entryId)}"]`);
  if (!receipt) return;
  const template = document.createElement('template');
  template.innerHTML = model.html;
  receipt.after(template.content);
}

async function refreshLatestDecisionState() {
  if (!_latestRound) return;
  if (Number(_latestRound) === Number(currentRound)) {
    _latestBlocks = _blocks;
    refreshDecisionChip();
    return;
  }
  try {
    const response = await fetch(apiUrl(
      `/api/content?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(_latestRound)}`,
    ));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.json();
    _latestBlocks = Array.isArray(content.blocks) ? content.blocks : [];
  } catch {
    _latestBlocks = [];
  }
  refreshDecisionChip();
}

function appendStreamEntries(entries, { countUnread = false, advanceCursor = true } = {}) {
  if (!$streamEntries || !Array.isArray(entries)) return;
  const nearBottom = $streamEntries.scrollHeight - $streamEntries.scrollTop - $streamEntries.clientHeight < 72;
  let addedMessages = 0;
  let addedEntries = 0;
  for (const entry of entries) {
    if (advanceCursor && entry?.id) _lastStreamId = entry.id;
    if (!entry?.id || _seenStreamIds.has(entry.id)) continue;
    _seenStreamIds.add(entry.id);
    _streamEntriesData.push(entry);
    $streamEntries.append(streamTemplate(entry).content);
    addedEntries += 1;
    if (entry.kind === 'message') addedMessages += 1;
  }
  if (nearBottom || !countUnread || (_activeView === 'stream' && isNarrowScreen())) {
    requestAnimationFrame(() => { $streamEntries.scrollTop = $streamEntries.scrollHeight; });
  }
  if (countUnread && addedMessages > 0 && (isNarrowScreen() ? _activeView !== 'stream' : false)) {
    _streamUnread += addedMessages;
  }
  if (_streamEntriesData.length > 0 && $streamMigrationHint) $streamMigrationHint.hidden = true;
  if (addedEntries > 0) _documentsCacheKey = '';
  refreshDecisionChip();
  updateMobileBadges();
}

async function loadStream({ initial = false } = {}) {
  if (!SESSION || !$streamEntries) return;
  const since = !initial && _lastStreamId ? `&since=${encodeURIComponent(_lastStreamId)}` : '';
  try {
    const response = await fetch(apiUrl(`/api/messages?session=${encodeURIComponent(SESSION)}${since}`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.identity?.id) _viewerId = data.identity.id;
    if (initial) {
      $streamEntries.replaceChildren();
      _seenStreamIds.clear();
      _streamEntriesData.length = 0;
      _lastStreamId = '';
    }
    appendStreamEntries(data.entries || [], { countUnread: !initial });
    if ($streamMigrationHint) {
      $streamMigrationHint.hidden = !(initial && _streamEntriesData.length === 0 && Number(_latestRound) > 0);
    }
    setStreamConnection('已连接', 'ok');
  } catch {
    setStreamConnection('稍后重试', 'error');
  }
}

function roundPageUrl(round) {
  const target = new URL('/render/', location.origin);
  target.searchParams.set('session', SESSION);
  target.searchParams.set('round', String(round));
  if (TOKEN) target.searchParams.set('token', TOKEN);
  return target.href;
}

$streamEntries?.addEventListener('click', (event) => {
  const decisionChip = event.target.closest('[data-open-decision]');
  if (decisionChip) {
    const round = Number(decisionChip.dataset.round);
    if (Number.isInteger(round) && round > 0 && round !== Number(currentRound)) {
      location.assign(roundPageUrl(round));
    } else {
      setActiveView('decision', { scrollTop: true });
    }
    return;
  }
  const roundTarget = event.target.closest('.stream-system-pill[data-round]');
  if (!roundTarget) return;
  const round = Number(roundTarget.dataset.round);
  if (!Number.isInteger(round) || round < 1) return;
  if (round === currentRound) setActiveView('decision', { scrollTop: true });
  else location.assign(roundPageUrl(round));
});

let _composerBusy = false;
function setComposerBusy(busy, label = '') {
  _composerBusy = busy;
  if ($streamSendBtn) $streamSendBtn.disabled = busy;
  if ($streamFileInput) $streamFileInput.disabled = busy;
  if ($streamSendStatus) $streamSendStatus.textContent = label;
}

async function postStreamMessage(text) {
  const response = await fetch(apiUrl('/api/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: SESSION, text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.entry) throw new Error(data.error || `HTTP ${response.status}`);
  // 成功响应后立刻本地追加，不等待下一次 3 秒轮询。
  appendStreamEntries([data.entry], { advanceCursor: false });
  return data.entry;
}

async function sendComposerText() {
  if (_composerBusy) return;
  const text = $streamInput?.value.trim() || '';
  if (!text) return;
  setComposerBusy(true, '发送中…');
  try {
    await postStreamMessage(text);
    $streamInput.value = composerValueAfterSend($streamInput.value, text);
    if (!$streamInput.value) $streamInput.style.height = '';
    setComposerBusy(false, '');
  } catch (error) {
    setComposerBusy(false, `发送失败：${error.message}`);
  }
}

$streamComposer?.addEventListener('submit', (event) => {
  event.preventDefault();
  void sendComposerText();
});

$streamInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $streamComposer?.requestSubmit();
  }
});

$streamInput?.addEventListener('input', () => {
  $streamInput.style.height = '';
  $streamInput.style.height = `${Math.min(144, $streamInput.scrollHeight)}px`;
});

async function uploadAndSendFiles(files) {
  const accepted = [...files].filter((file) => file && (
    file.type.startsWith('image/') || file.type === 'application/pdf'
  ));
  if (!accepted.length) return;
  setComposerBusy(true, `上传 0/${accepted.length}`);
  try {
    for (let index = 0; index < accepted.length; index += 1) {
      const file = accepted[index];
      setComposerBusy(true, `上传 ${index + 1}/${accepted.length}`);
      const response = await fetch(apiUrl(`/api/attachments?session=${encodeURIComponent(SESSION)}`), {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-File-Name': encodeURIComponent(file.name || 'attachment'),
        },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || `HTTP ${response.status}`);
      await postStreamMessage(attachmentMessageMarkdown({
        url: data.url,
        name: file.name || '附件',
        type: file.type,
      }));
    }
    setComposerBusy(false, '');
    _documentsCacheKey = '';
  } catch (error) {
    setComposerBusy(false, `上传失败：${error.message}`);
  } finally {
    if ($streamFileInput) $streamFileInput.value = '';
  }
}

$streamFileInput?.addEventListener('change', () => {
  void uploadAndSendFiles($streamFileInput.files || []);
});

$streamInput?.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  void uploadAndSendFiles(files);
});

// ── 云端文档库 / 历史轮次 ────────────────────────────────

function renderDocumentsPanel(selectedDocument = null) {
  if (!$documentsMount || !_documentsViewModel) return;
  const template = document.createElement('template');
  template.innerHTML = documentsPanelHtml({ ..._documentsViewModel, selectedDocument });
  // Markdown 正文中的会话图片也要继承页面 token。
  template.content.querySelectorAll('[src^="/assets/"], [href^="/assets/"]').forEach((element) => {
    const attribute = element.hasAttribute('src') ? 'src' : 'href';
    element.setAttribute(attribute, apiUrl(element.getAttribute(attribute)));
  });
  $documentsMount.replaceChildren(template.content);
}

async function loadDocumentsPanel() {
  if (!$documentsMount || !_currentContent) return;
  const cacheKey = `${_streamEntriesData.length}:${_currentContent.meta?.docsUrl || ''}`;
  if (_documentsCacheKey === cacheKey && _documentsViewModel) return;
  $documentsMount.innerHTML = '<p class="documents-loading">正在读取云端文档库…</p>';

  try {
    const [documentsResponse, inventoryResponse] = await Promise.all([
      fetch(apiUrl(`/api/documents?session=${encodeURIComponent(SESSION)}`)),
      fetch(apiUrl(`/api/assets?session=${encodeURIComponent(SESSION)}`)),
    ]);
    if (!documentsResponse.ok) throw new Error(`HTTP ${documentsResponse.status}`);
    const documentsData = await documentsResponse.json();
    const inventoryData = inventoryResponse.ok ? await inventoryResponse.json() : { files: [] };
    const inventory = Array.isArray(inventoryData.files) ? inventoryData.files : [];

    const assets = [];
    const seenAssetUrls = new Set();
    for (const file of inventory) {
      if (!file || typeof file.url !== 'string' || typeof file.path !== 'string') continue;
      seenAssetUrls.add(file.url);
      assets.push({ label: file.path, url: apiUrl(file.url) });
    }
    for (const asset of collectAssetLinks([_currentContent], _streamEntriesData)) {
      if (seenAssetUrls.has(asset.url)) continue;
      seenAssetUrls.add(asset.url);
      assets.push({
        ...asset,
        url: asset.url.startsWith('/assets/') ? apiUrl(asset.url) : asset.url,
      });
    }

    _documentsViewModel = {
      docsUrl: contentLink(_currentContent.meta?.docsUrl) || '',
      assets,
      documents: Array.isArray(documentsData.documents) ? documentsData.documents : [],
    };
    _documentsCacheKey = cacheKey;
    renderDocumentsPanel();
  } catch (error) {
    $documentsMount.innerHTML = `<p class="load-error">加载文档库失败：${escapeHtml(error.message)}</p>`;
  }
}

async function openDocument(category, slug) {
  if (!$documentsMount || !slug) return;
  $documentsMount.innerHTML = '<p class="documents-loading">正在打开文档…</p>';
  const query = new URLSearchParams({ session: SESSION, slug });
  if (category) query.set('category', category);

  try {
    const response = await fetch(apiUrl(`/api/documents?${query}`));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.document) throw new Error(data.error || `HTTP ${response.status}`);
    renderDocumentsPanel(data.document);
  } catch (error) {
    $documentsMount.innerHTML = `<div class="document-reader-error">
      <button class="document-back" type="button" data-document-back>← 返回文档库</button>
      <p class="load-error">打开文档失败：${escapeHtml(error.message)}</p>
    </div>`;
  }
}

$documentsMount?.addEventListener('click', (event) => {
  const back = event.target.closest('[data-document-back]');
  if (back) {
    renderDocumentsPanel();
    return;
  }
  const target = event.target.closest('[data-document-slug]');
  if (!target) return;
  void openDocument(target.dataset.documentCategory, target.dataset.documentSlug);
});

async function loadHistoryRounds({ force = false } = {}) {
  if (!$historyRoundsMount) return;
  const cacheKey = String(Number(_latestRound) || 0);
  if (!force && _historyRoundsCacheKey === cacheKey) return;
  $historyRoundsMount.innerHTML = '<p class="documents-loading">正在读取历史轮次…</p>';

  const rounds = [];
  const jobs = Array.from({ length: Number(_latestRound) || 0 }, (_, index) => index + 1).map(async (round) => {
    try {
      const response = await fetch(apiUrl(`/api/content?session=${encodeURIComponent(SESSION)}&round=${round}`));
      if (!response.ok) return;
      const content = await response.json();
      rounds.push({ round, title: content.title, url: roundPageUrl(round) });
    } catch { /* 单轮缺失不阻断归档 */ }
  });
  await Promise.all(jobs);
  $historyRoundsMount.innerHTML = historyRoundsHtml(rounds);
  _historyRoundsCacheKey = cacheKey;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 草稿恢复 ─────────────────────────────────────────────
function restoreDraftUI(draft) {
  Object.entries(draft).forEach(([blockId, item]) => {
    // verdict
    if (item.verdict) {
      const btn = $zones.querySelector(`.verdict-btn[data-block-id="${blockId}"][data-verdict="${item.verdict}"]`);
      if (btn) btn.classList.add('selected');
    }
    // textarea / editable
    if (item.text != null) {
      const ta = $zones.querySelector(`textarea[data-block-id="${blockId}"]`);
      if (ta) ta.value = item.text;
    }
    // choice
    if (item.select != null) {
      const inp = $zones.querySelector(`input[name="choice-${blockId}"][value="${item.select}"]`);
      if (inp) inp.checked = true;
    }
    // editable「保持原样即确认」：还原确认态（P2）
    if (item.confirmed === true) {
      markEditableConfirmed(blockId);
    }
    // 原型控件移动：还原到用户拖过的位置
    if (item.moves && typeof item.moves === 'object') {
      restoreMoves(blockId, item.moves);
    }
    // 内联批注（普通 block）：还原为读态
    if (item.comment != null && item.comment !== '') {
      restoreInlineComment(blockId, item.comment);
    }
    // embed 评论：只还原"有内容"的评论（忽略并清理历史空评论），读态
    if (Array.isArray(item.comments) && item.comments.length > 0) {
      const real = item.comments.filter((c) => c && c.id && (c.text || '').trim());
      real.forEach((c) => appendRailCard(blockId, c, /* editMode= */ false));
      updatePinCount(blockId, real.length);
      if (real.length !== item.comments.length) {
        saveDraft({ [blockId]: { ...item, comments: real } }); // 顺手清理历史空评论
      }
    }
    // checklist 三态：还原各 item 的选中状态
    if (item.checklistItems && typeof item.checklistItems === 'object') {
      Object.entries(item.checklistItems).forEach(([itemId, label]) => {
        restoreChecklistItem(blockId, itemId, label);
      });
    }
    // prototype pins：还原已保存的 pin 标注
    if (Array.isArray(item.pins) && item.pins.length > 0) {
      item.pins.forEach((pin) => {
        if (pin && pin.id) renderPinOnOverlay(blockId, pin, /* readMode= */ true);
      });
    }
  });
}

// 内联批注恢复为读态
function restoreInlineComment(blockId, text) {
  const box  = $zones.querySelector(`.comment-box[data-comment-box="${blockId}"]`);
  const edit = $zones.querySelector(`.comment-edit[data-comment-edit="${blockId}"]`);
  const read = $zones.querySelector(`.comment-read[data-comment-read="${blockId}"]`);
  const textEl = $zones.querySelector(`.comment-read-text[data-comment-text="${blockId}"]`);
  const ta   = $zones.querySelector(`.comment-input[data-comment-for="${blockId}"]`);
  if (!box) return;
  if (ta) ta.value = text;
  if (textEl) textEl.textContent = text;
  if (edit) edit.hidden = true;
  if (read) read.hidden = false;
  box.hidden = false;
  updateCommentBtn(blockId, text);
}

// 批注按钮文案：有内容→提示可收起；空→恢复"+批注"
function updateCommentBtn(blockId, val) {
  const btn = $zones.querySelector(`.comment-btn[data-block-id="${blockId}"]`);
  if (btn) btn.textContent = (val && val.trim()) ? '批注 ✓' : '+批注';
}

function updatePinCount(blockId, count) {
  const el = $zones.querySelector(`.embed-pin-count[data-embed-count="${blockId}"]`);
  if (el) el.textContent = `${count} 条批注`;
}

// ── checklist 三态 ────────────────────────────────────────

/** 还原单个 checklist item 的选中态 */
function restoreChecklistItem(blockId, itemId, label) {
  const btns = $zones.querySelectorAll(
    `.checklist-verdict-btn[data-block-id="${blockId}"][data-item-id="${itemId}"]`,
  );
  btns.forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.label === label);
  });
}

// ── prototype SVG pin 定位批注 ────────────────────────────

let _pinSeq = 0;

function positionPinComment(blockId, pin, bubble) {
  const overlay = $zones.querySelector(`svg.proto-overlay[data-proto-overlay="${blockId}"]`);
  if (!overlay || !bubble) return;
  const rect = overlay.getBoundingClientRect();
  const position = containerPinPopoverPosition(
    { width: rect.width, height: rect.height },
    pin,
    { width: bubble.offsetWidth || 280, height: bubble.offsetHeight || 120 },
    {
      // 把视口可见区换算为 overlay 内坐标，翻转后仍返回容器内位置。
      visibleBounds: {
        left: Math.max(0, -rect.left),
        top: Math.max(0, -rect.top),
        right: Math.min(rect.width, window.innerWidth - rect.left),
        bottom: Math.min(rect.height, window.innerHeight - rect.top),
      },
    },
  );
  bubble.style.position = 'absolute';
  bubble.style.left = `${position.left}px`;
  bubble.style.top = `${position.top}px`;
  bubble.dataset.horizontal = position.horizontal;
  bubble.dataset.vertical = position.vertical;
}

function repositionVisiblePinComments() {
  if (_pinRepositionQueued) return;
  _pinRepositionQueued = true;
  requestAnimationFrame(() => {
    _pinRepositionQueued = false;
    $zones.querySelectorAll('.proto-pin-comment:not([hidden])').forEach((bubble) => {
      positionPinComment(bubble.dataset.blockId, {
        xPct: Number(bubble.dataset.xPct),
        yPct: Number(bubble.dataset.yPct),
      }, bubble);
    });
  });
}

window.addEventListener('resize', repositionVisiblePinComments);
window.addEventListener('scroll', repositionVisiblePinComments, true);

/**
 * 在 SVG overlay 上渲染（或更新）一个 pin。
 * pin: { id, xPct, yPct, text }
 * readMode=true → 直接渲染为读态（草稿恢复）；false → 展开编辑态
 */
function renderPinOnOverlay(blockId, pin, readMode = false) {
  const overlay = $zones.querySelector(`svg.proto-overlay[data-proto-overlay="${blockId}"]`);
  const pinsG   = $zones.querySelector(`g.proto-pins[data-proto-pins="${blockId}"]`);
  if (!overlay || !pinsG) return;

  // 移除已存在的同 id pin（更新场景）
  const existing = pinsG.querySelector(`[data-pin-id="${pin.id}"]`);
  if (existing) existing.remove();

  // pin 圆形标记（SVG circle + text）
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('data-pin-id', pin.id);
  g.setAttribute('class', 'proto-pin');
  g.setAttribute('style', 'cursor:pointer');

  const cx = pin.xPct;
  const cy = pin.yPct;

  // 使用 SVG foreignObject 承载 pin 标记（避免 text 计量问题）
  g.innerHTML = `
    <circle cx="${cx}%" cy="${cy}%" r="12" class="pin-circle" fill="var(--color-focus)" stroke="#fff" stroke-width="2" opacity="0.9"/>
    <text x="${cx}%" y="${cy}%" dy="0.35em" text-anchor="middle" fill="#fff" font-size="10" pointer-events="none">📍</text>`;

  pinsG.appendChild(g);

  // 内联评论气泡：作为普通 DOM 节点挂到 proto-container
  const containerId = `proto-pin-comment-${pin.id}`;
  let commentBubble = document.getElementById(containerId);
  if (!commentBubble) {
    commentBubble = document.createElement('div');
    commentBubble.id = containerId;
    commentBubble.className = 'proto-pin-comment';
    commentBubble.dataset.pinId = pin.id;
    commentBubble.dataset.blockId = blockId;
    // 浮层与 SVG pin 共用图片/原型媒体容器，滚动和缩放时不会脱锚。
    const pinContainer = overlay.parentElement;
    if (pinContainer) {
      pinContainer.appendChild(commentBubble);
    }
  }
  commentBubble.dataset.xPct = String(cx);
  commentBubble.dataset.yPct = String(cy);

  if (readMode && pin.text) {
    commentBubble.innerHTML = `<div class="proto-pin-read">
      <span class="proto-pin-text">${escapeHtml(pin.text)}</span>
      <div class="proto-pin-actions">
        <button class="proto-pin-edit-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">编辑</button>
        <button class="proto-pin-del-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">删除</button>
      </div>
    </div>`;
    commentBubble.hidden = false;
    bindPinBubbleActions(blockId, pin, commentBubble);
    positionPinComment(blockId, pin, commentBubble);
  } else {
    commentBubble.innerHTML = `<div class="proto-pin-edit">
      <textarea class="proto-pin-input" data-pin-id="${pin.id}" rows="2" placeholder="写下批注…">${escapeHtml(pin.text || '')}</textarea>
      <div class="proto-pin-actions">
        <button class="proto-pin-save-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">保存</button>
        <button class="proto-pin-del-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">删除</button>
      </div>
    </div>`;
    commentBubble.hidden = false;
    bindPinBubbleActions(blockId, pin, commentBubble);
    positionPinComment(blockId, pin, commentBubble);
    commentBubble.querySelector('.proto-pin-input')?.focus();
  }

  // 点击 pin marker → 展开/收起气泡
  g.addEventListener('click', (e) => {
    e.stopPropagation();
    commentBubble.hidden = !commentBubble.hidden;
    if (!commentBubble.hidden) positionPinComment(blockId, pin, commentBubble);
  });
}

/** 绑定 pin 气泡里的保存/编辑/删除事件 */
function bindPinBubbleActions(blockId, pin, bubble) {
  function savePinDraft(text) {
    const draft = loadDraft();
    const item = draft[blockId] || {};
    const pins = Array.isArray(item.pins) ? [...item.pins] : [];
    const idx = pins.findIndex((p) => p.id === pin.id);
    const updated = { ...pin, text };
    if (idx >= 0) pins[idx] = updated; else pins.push(updated);
    saveDraft({ [blockId]: { ...item, pins } });
    return updated;
  }

  function deletePinDraft() {
    const draft = loadDraft();
    const item = draft[blockId] || {};
    const pins = (Array.isArray(item.pins) ? item.pins : []).filter((p) => p.id !== pin.id);
    saveDraft({ [blockId]: { ...item, pins } });
    // 移除 SVG marker
    const overlay = $zones.querySelector(`g.proto-pins[data-proto-pins="${blockId}"]`);
    if (overlay) {
      const g = overlay.querySelector(`[data-pin-id="${pin.id}"]`);
      if (g) g.remove();
    }
    bubble.remove();
  }

  // 保存按钮
  const saveBtn = bubble.querySelector('.proto-pin-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ta = bubble.querySelector('.proto-pin-input');
      const text = ta ? ta.value.trim() : '';
      if (!text) { deletePinDraft(); return; }
      const updated = savePinDraft(text);
      // 切换到读态
      bubble.innerHTML = `<div class="proto-pin-read">
        <span class="proto-pin-text">${escapeHtml(text)}</span>
        <div class="proto-pin-actions">
          <button class="proto-pin-edit-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">编辑</button>
          <button class="proto-pin-del-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">删除</button>
        </div>
      </div>`;
      bindPinBubbleActions(blockId, updated, bubble);
      positionPinComment(blockId, updated, bubble);
    });
  }

  // 编辑按钮（读态下）
  const editBtn = bubble.querySelector('.proto-pin-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bubble.innerHTML = `<div class="proto-pin-edit">
        <textarea class="proto-pin-input" data-pin-id="${pin.id}" rows="2" placeholder="写下批注…">${escapeHtml(pin.text || '')}</textarea>
        <div class="proto-pin-actions">
          <button class="proto-pin-save-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">保存</button>
          <button class="proto-pin-del-btn" data-pin-id="${pin.id}" data-block-id="${blockId}" type="button">删除</button>
        </div>
      </div>`;
      bindPinBubbleActions(blockId, pin, bubble);
      positionPinComment(blockId, pin, bubble);
      bubble.querySelector('.proto-pin-input')?.focus();
    });
  }

  // 删除按钮
  const delBtns = bubble.querySelectorAll('.proto-pin-del-btn');
  delBtns.forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    deletePinDraft();
  }));
}

// ── embed 飞书式评论 rail ──────────────────────────────────

/**
 * 在 rail 里追加一张评论卡片。
 * editMode=true → 编辑态（textarea 聚焦）；false → 读态。
 * comment: { id, quote, text, done }
 */
function appendRailCard(blockId, comment, editMode) {
  const railList = $zones.querySelector(`.rail-list[data-embed-rail-list="${blockId}"]`);
  if (!railList) return;

  // 移除空占位
  const empty = railList.querySelector('.rail-empty');
  if (empty) empty.remove();

  const card = document.createElement('div');
  card.className = 'rail-card';
  card.dataset.commentId = comment.id;

  const quoteHtml = comment.quote
    ? `<blockquote class="rail-quote">${escapeHtml(comment.quote)}</blockquote>`
    : '';

  card.innerHTML = `
    <div class="rail-card-edit" ${editMode ? '' : 'hidden'}>
      ${quoteHtml}
      <textarea class="rail-comment-input" rows="3" placeholder="写下评论…">${escapeHtml(comment.text || '')}</textarea>
      <div class="rail-card-actions">
        <button class="rail-save" type="button">保存</button>
        <button class="rail-card-delete" type="button">删除</button>
      </div>
    </div>
    <div class="rail-card-read" ${editMode ? 'hidden' : ''}>
      ${quoteHtml}
      <div class="rail-card-text">${escapeHtml(comment.text || '')}</div>
      <div class="rail-card-actions">
        <button class="rail-edit-btn" type="button">编辑</button>
        <button class="rail-card-delete" type="button">删除</button>
      </div>
    </div>`;

  // 从草稿与 DOM 移除本卡片（保存空内容 / 删除 共用）
  function removeCardAndComment() {
    const draft = loadDraft();
    const item = draft[blockId] || {};
    const comments = (Array.isArray(item.comments) ? item.comments : []).filter((c) => c.id !== comment.id);
    saveDraft({ [blockId]: { ...item, comments } });
    card.remove();
    const list = $zones.querySelector(`.rail-list[data-embed-rail-list="${blockId}"]`);
    if (list && !list.querySelector('.rail-card')) {
      const emp = document.createElement('div');
      emp.className = 'rail-empty';
      emp.textContent = '选中页面里的文字，点浮出的「💬 评论」添加；也可点「+ 新增批注」写整体意见。';
      list.appendChild(emp);
    }
    updatePinCount(blockId, savedCount(blockId));
  }

  // 保存（空内容视为丢弃，不污染草稿）
  card.querySelector('.rail-save').addEventListener('click', () => {
    const ta = card.querySelector('.rail-comment-input');
    const val = ta ? ta.value : '';
    if (!val.trim()) { removeCardAndComment(); return; }
    comment.text = val;
    comment.done = true;
    const draft = loadDraft();
    const item = draft[blockId] || {};
    const comments = Array.isArray(item.comments) ? item.comments : [];
    const idx = comments.findIndex((c) => c.id === comment.id);
    if (idx >= 0) comments[idx] = comment; else comments.push(comment);
    saveDraft({ [blockId]: { ...item, comments } });
    card.querySelector('.rail-card-text').textContent = comment.text;
    card.querySelector('.rail-card-edit').hidden = true;
    card.querySelector('.rail-card-read').hidden = false;
    updatePinCount(blockId, savedCount(blockId));
  });

  // 编辑
  card.querySelector('.rail-edit-btn').addEventListener('click', () => {
    const ta = card.querySelector('.rail-comment-input');
    if (ta) ta.value = comment.text || '';
    card.querySelector('.rail-card-edit').hidden = false;
    card.querySelector('.rail-card-read').hidden = true;
    ta?.focus();
  });

  // 点读态正文 → best-effort 跳到 iframe 内原文
  card.querySelector('.rail-card-read').addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // 不触发跳转
    if (!comment.quote) return;
    try {
      const iframe = $zones.querySelector(`.embed-iframe[data-embed-iframe="${blockId}"]`);
      if (!iframe || !iframe.contentWindow) return;
      const doc = iframe.contentDocument;
      if (!doc) return;
      // 尝试 find()
      if (typeof iframe.contentWindow.find === 'function') {
        iframe.contentWindow.find(comment.quote);
      }
    } catch { /* best-effort，失败静默 */ }
  });

  // 删除（编辑态/读态两处 .rail-card-delete 共用 removeCardAndComment）
  card.querySelectorAll('.rail-card-delete').forEach((btn) => {
    btn.addEventListener('click', removeCardAndComment);
  });

  railList.appendChild(card);

  if (editMode) {
    card.querySelector('.rail-comment-input')?.focus();
  }
}

let _commentSeq = 0;
// 仅统计"已保存且有内容"的评论数（空评论不计）
function savedCount(blockId) {
  return (loadDraft()[blockId]?.comments ?? []).filter((c) => c && (c.text || '').trim()).length;
}

/**
 * 新建一条评论卡片（编辑态）。创建时不落草稿——避免"点了没写"产生空评论；
 * 仅在「保存」且内容非空时才持久化。quote 为 null = 整体意见。
 */
function addEmbedComment(blockId, quote) {
  const id = `c-${blockId}-n${_commentSeq++}`;
  const comment = { id, quote: quote || null, text: '', done: false };
  appendRailCard(blockId, comment, /* editMode= */ true);
  return comment;
}

// best-effort 高亮：用 CSS Custom Highlight API 在 iframe 文档里高亮选区
function tryHighlightRange(iframeDoc, range, quote) {
  try {
    if (!iframeDoc || !range) return;
    if (typeof iframeDoc.defaultView?.CSS?.highlights === 'undefined') return;
    const hl = new iframeDoc.defaultView.Highlight(range);
    iframeDoc.defaultView.CSS.highlights.set('wb-hl', hl);
    // 注入高亮 CSS（幂等）
    if (!iframeDoc.getElementById('wb-hl-style')) {
      const s = iframeDoc.createElement('style');
      s.id = 'wb-hl-style';
      s.textContent = '::highlight(wb-hl){ background: rgba(250,204,21,.45); }';
      iframeDoc.head?.appendChild(s);
    }
  } catch { /* best-effort，失败静默 */ }
}

/**
 * 绑定 embed iframe 的选区交互。
 * 每次 iframe load 事件后调用。
 */
function bindEmbedIframe(blockId, iframe) {
  try {
    const iframeDoc = iframe.contentDocument;
    const iframeWin = iframe.contentWindow;
    if (!iframeDoc || !iframeWin) return;

    iframeDoc.addEventListener('mouseup', () => {
      try {
        const sel = iframeWin.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          hideFab();
          return;
        }
        const quote = sel.toString().trim();
        const range = sel.getRangeAt(0);
        const selRect = range.getBoundingClientRect();
        const iframeRect = iframe.getBoundingClientRect();

        // fab 定位到选区右上角。position:fixed 相对视口，
        // iframeRect.top + selRect.top 已是"选区相对视口"的坐标——不能再加 window.scrollY（否则随滚动被推到页底）。
        const fabX = iframeRect.left + selRect.right + 6;
        const fabY = iframeRect.top + selRect.top;
        showFab(fabX, fabY, blockId, quote, iframeDoc, range);
      } catch { hideFab(); }
    });
  } catch { /* best-effort */ }
}

// ── 浮动评论按钮（FAB）──────────────────────────────────
let _fab = null;
let _pendingComment = null; // { blockId, quote, iframeDoc, range }

function ensureFab() {
  if (_fab) return _fab;
  _fab = document.createElement('button');
  _fab.className = 'comment-fab';
  _fab.type = 'button';
  _fab.textContent = '💬 评论';
  _fab.hidden = true;
  _fab.addEventListener('click', () => {
    if (!_pendingComment) return;
    const { blockId, quote, iframeDoc, range } = _pendingComment;
    const comment = addEmbedComment(blockId, quote);
    tryHighlightRange(iframeDoc, range, quote);
    hideFab();
  });
  document.body.appendChild(_fab);
  return _fab;
}

function showFab(x, y, blockId, quote, iframeDoc, range) {
  const fab = ensureFab();
  fab.style.left = `${x}px`;
  fab.style.top  = `${y}px`;
  fab.hidden = false;
  _pendingComment = { blockId, quote, iframeDoc, range };
}

function hideFab() {
  if (_fab) _fab.hidden = true;
  _pendingComment = null;
}

// 点击页面其他地方隐藏 fab
document.addEventListener('mousedown', (e) => {
  if (_fab && !_fab.contains(e.target)) hideFab();
});

// ── 事件绑定 ─────────────────────────────────────────────
function bindInteractions() {
  // verdict 按钮
  $zones.querySelectorAll('.verdict-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bId = btn.dataset.blockId;
      const v = btn.dataset.verdict;
      // 视觉切换
      $zones.querySelectorAll(`.verdict-btn[data-block-id="${bId}"]`).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      // 显示 reason textarea
      const reasonDiv = btn.closest('.block-content')?.querySelector('.verdict-comment');
      if (reasonDiv) reasonDiv.hidden = false;
      // 需填理由软提醒（异议/疑问）
      saveDraft({ [bId]: { ...loadDraft()[bId], verdict: v } });
    });
  });

  // textarea 自动存草稿
  $zones.querySelectorAll('textarea').forEach((ta) => {
    const bId = ta.dataset.blockId;
    if (!bId) return;
    ta.addEventListener('input', () => {
      saveDraft({ [bId]: { ...loadDraft()[bId], text: ta.value } });
      // editable "已编辑·未提交" 标
      const status = ta.closest('.block-content')?.querySelector('.edit-status');
      if (status) status.hidden = ta.value.trim() === '';
    });
  });

  // choice 存草稿
  $zones.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((inp) => {
    const name = inp.name ?? '';
    const bId = name.replace(/^choice-/, '');
    if (!bId) return;
    inp.addEventListener('change', () => {
      saveDraft({ [bId]: { ...loadDraft()[bId], select: inp.value } });
    });
  });

  // embed iframe load → 绑定选区交互
  $zones.querySelectorAll('.embed-iframe[data-embed-iframe]').forEach((iframe) => {
    const blockId = iframe.dataset.embedIframe;
    if (!blockId) return;
    const doBindIframe = () => bindEmbedIframe(blockId, iframe);
    // 若已加载（src 已在 DOM 中）→ 立即绑定；否则等 load
    if (iframe.contentDocument?.readyState === 'complete') {
      doBindIframe();
    }
    iframe.addEventListener('load', doBindIframe);
  });

  // embed rail "+ 新增批注"按钮
  $zones.querySelectorAll('.rail-add[data-embed-add]').forEach((btn) => {
    const blockId = btn.dataset.embedAdd;
    if (!blockId) return;
    btn.addEventListener('click', () => {
      addEmbedComment(blockId, null);
    });
  });

  // checklist 三态点选
  $zones.querySelectorAll('.checklist-verdict-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bId    = btn.dataset.blockId;
      const itemId = btn.dataset.itemId;
      const label  = btn.dataset.label;
      if (!bId || !itemId) return;

      // 视觉：同组按钮清除选中，点击当前选中的则取消（toggle）
      const groupBtns = $zones.querySelectorAll(
        `.checklist-verdict-btn[data-block-id="${bId}"][data-item-id="${itemId}"]`,
      );
      const alreadySelected = btn.classList.contains('selected');
      groupBtns.forEach((b) => b.classList.remove('selected'));
      if (!alreadySelected) btn.classList.add('selected');

      // 草稿：checklistItems 是 { itemId: label } 的映射
      const draft = loadDraft();
      const item  = draft[bId] || {};
      const checklistItems = { ...(item.checklistItems || {}) };
      if (alreadySelected) {
        delete checklistItems[itemId];
      } else {
        checklistItems[itemId] = label;
      }
      saveDraft({ [bId]: { ...item, checklistItems } });
    });
  });

  // prototype SVG overlay 点击落 pin
  $zones.querySelectorAll('svg.proto-overlay[data-proto-overlay]').forEach((overlay) => {
    const blockId = overlay.dataset.protoOverlay;
    if (!blockId) return;

    overlay.addEventListener('click', (e) => {
      // 忽略点到已有 pin 标记的点击（pin 的 g 元素自行处理）
      if (e.target.closest('.proto-pin')) return;

      const rect = overlay.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top)  / rect.height) * 100;

      const pinId = `pin-${blockId}-${_pinSeq++}`;
      const pin = { id: pinId, xPct: +xPct.toFixed(2), yPct: +yPct.toFixed(2), text: '' };

      renderPinOnOverlay(blockId, pin, /* readMode= */ false);
    });
  });

  // 内联批注（普通 block，非 embed）：点按钮展开编辑态
  $zones.querySelectorAll('.comment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bId = btn.dataset.blockId;
      const box  = $zones.querySelector(`.comment-box[data-comment-box="${bId}"]`);
      const edit = $zones.querySelector(`.comment-edit[data-comment-edit="${bId}"]`);
      const read = $zones.querySelector(`.comment-read[data-comment-read="${bId}"]`);
      if (!box) return;
      if (box.hidden) {
        // 展开为编辑态
        box.hidden = false;
        if (edit) edit.hidden = false;
        if (read) read.hidden = true;
        btn.setAttribute('aria-expanded', 'true');
        box.querySelector('.comment-input')?.focus();
      } else {
        // 已展开 → 收起
        box.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // 内联批注 textarea 自动存草稿
  $zones.querySelectorAll('.comment-input').forEach((ta) => {
    const bId = ta.dataset.commentFor;
    if (!bId) return;
    ta.addEventListener('input', () => {
      const val = ta.value;
      saveDraft({ [bId]: { ...loadDraft()[bId], comment: val.trim() ? val : undefined } });
      updateCommentBtn(bId, val);
    });
  });

  // 内联批注「保存」按钮 → 切读态
  $zones.querySelectorAll('.comment-save[data-comment-save]').forEach((btn) => {
    const bId = btn.dataset.commentSave;
    if (!bId) return;
    btn.addEventListener('click', () => {
      const ta     = $zones.querySelector(`.comment-input[data-comment-for="${bId}"]`);
      const edit   = $zones.querySelector(`.comment-edit[data-comment-edit="${bId}"]`);
      const read   = $zones.querySelector(`.comment-read[data-comment-read="${bId}"]`);
      const textEl = $zones.querySelector(`.comment-read-text[data-comment-text="${bId}"]`);
      const val = ta ? ta.value : '';
      saveDraft({ [bId]: { ...loadDraft()[bId], comment: val.trim() ? val : undefined } });
      if (textEl) textEl.textContent = val;
      if (edit) edit.hidden = true;
      if (read) read.hidden = false;
      updateCommentBtn(bId, val);
    });
  });

  // 内联批注「编辑」按钮 → 切编辑态
  $zones.querySelectorAll('.comment-edit-btn[data-comment-edit-btn]').forEach((btn) => {
    const bId = btn.dataset.commentEditBtn;
    if (!bId) return;
    btn.addEventListener('click', () => {
      const edit = $zones.querySelector(`.comment-edit[data-comment-edit="${bId}"]`);
      const read = $zones.querySelector(`.comment-read[data-comment-read="${bId}"]`);
      if (edit) edit.hidden = false;
      if (read) read.hidden = true;
      $zones.querySelector(`.comment-input[data-comment-for="${bId}"]`)?.focus();
    });
  });

  // 内联批注「删除」按钮
  $zones.querySelectorAll('.comment-delete[data-comment-del]').forEach((btn) => {
    const bId = btn.dataset.commentDel;
    if (!bId) return;
    btn.addEventListener('click', () => {
      const draft = loadDraft();
      const item = { ...draft[bId] };
      delete item.comment;
      saveDraft({ [bId]: item });
      // 重置 UI
      const ta     = $zones.querySelector(`.comment-input[data-comment-for="${bId}"]`);
      const box    = $zones.querySelector(`.comment-box[data-comment-box="${bId}"]`);
      const edit   = $zones.querySelector(`.comment-edit[data-comment-edit="${bId}"]`);
      const read   = $zones.querySelector(`.comment-read[data-comment-read="${bId}"]`);
      if (ta) ta.value = '';
      if (edit) edit.hidden = false;
      if (read) read.hidden = true;
      if (box) box.hidden = true;
      updateCommentBtn(bId, '');
    });
  });

  // 原型编辑模式：拖动/缩放控件（复刻 prd-studio 的「编辑」模式）
  bindPrototypeEdit();

  // editable「保持原样即确认」（P2 · 病例 5：确认场景用 editable 是高摩擦）
  $zones.querySelectorAll('[data-editable-confirm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bid = btn.dataset.editableConfirm;
      const cur = loadDraft()[bid] ?? {};
      saveDraft({ [bid]: { ...cur, confirmed: true } });
      markEditableConfirmed(bid);
      updateDecisionProgress();
    });
  });

  // 只看变更开关
  const toggle = $diffMount.querySelector('#diff-only-changed');
  if (toggle) {
    toggle.addEventListener('change', () => {
      $zones.querySelectorAll('[data-change]').forEach((el) => {
        if (toggle.checked) {
          el.hidden = el.dataset.change === 'unchanged';
        } else {
          el.hidden = false;
        }
      });
    });
  }
}

// ── 提交 ─────────────────────────────────────────────────
$submitBtn.addEventListener('click', () => {
  const draft = loadDraft();
  const answeredIds = Object.keys(draft);
  const unanswered = unansweredDecisions(_blocks, answeredIds);
  const model = confirmModel(_blocks, answeredIds);
  openConfirmDialog(model, () => doSubmit(draft, answeredIds, unanswered));
});

// 提交前确认模态（DESIGN §13 P0-1）：可就地展开未表态/重要默认项并跳转补填
function openConfirmDialog(model, onConfirm) {
  // 降级：环境无 <dialog> 支持 → 退回原生 confirm，绝不阻断提交
  if (!$confirmDialog || typeof $confirmDialog.showModal !== 'function') {
    const mustN = (model.unansweredMust || []).length;
    const lines = [
      '你将：',
      `· 决策 ${model.decided} 项`,
      `· 接受 ${model.acceptedDefaults} 项默认（含 ${model.importantDefaults.length} 项重要）`,
      mustN > 0 ? `⚠️ 还有 ${mustN} 个必须决策的点没确定` : '',
      '\n确认提交？',
    ].filter(Boolean).join('\n');
    if (confirm(lines)) onConfirm();
    return;
  }
  $confirmDialog.innerHTML = confirmDialogHtml(model);
  $confirmDialog.querySelector('[data-act="cancel"]')?.addEventListener('click', () => $confirmDialog.close());
  $confirmDialog.querySelector('[data-act="confirm"]')?.addEventListener('click', () => {
    $confirmDialog.close();
    onConfirm();
  });
  $confirmDialog.querySelectorAll('[data-jump]').forEach((el) => {
    el.addEventListener('click', () => { $confirmDialog.close(); jumpToBlock(el.dataset.jump); });
  });
  $confirmDialog.showModal();
}

function confirmDialogHtml(model) {
  const must = model.unansweredMust || [];
  const opt = model.unansweredOptional || [];
  const secTag = (u) => (u.section ? `<span class="confirm-sec">${escapeHtml(u.section)}</span>` : '');

  // 必须决策未确定 → 顶部红字明确警示（用户要求）
  const mustWarn = must.length > 0
    ? `<div class="confirm-must-warn" role="alert">⚠️ 还有 <strong>${must.length}</strong> 个必须决策的点没确定</div>
  <ul class="confirm-list">${must.map((u) => `<li><button type="button" class="confirm-jump confirm-jump-must" data-jump="${escapeAttr(u.id)}">${escapeHtml(u.title)}</button>${secTag(u)}</li>`).join('')}</ul>`
    : '';

  // 可接受默认/推荐但未表态（次级）
  const optBlock = opt.length > 0
    ? `<details class="confirm-group" open>
    <summary><strong>${opt.length}</strong> 项可接受推荐/默认未表态（不填按推荐处理）</summary>
    <ul class="confirm-list">${opt.map((u) => `<li><button type="button" class="confirm-jump" data-jump="${escapeAttr(u.id)}">${escapeHtml(u.title)}</button>${secTag(u)}</li>`).join('')}</ul>
  </details>`
    : '';

  const importantBlock = model.importantDefaults.length > 0
    ? `<details class="confirm-group">
    <summary>接受 ${model.acceptedDefaults} 项默认（含 <strong>${model.importantDefaults.length}</strong> 项重要·建议过目）</summary>
    <ul class="confirm-list">${model.importantDefaults.map((d) => `<li><button type="button" class="confirm-jump" data-jump="${escapeAttr(d.id)}">${escapeHtml(d.title)}</button><span class="confirm-def">默认：${escapeHtml(String(d.default ?? ''))}</span></li>`).join('')}</ul>
  </details>`
    : `<div class="confirm-line">接受 <strong>${model.acceptedDefaults}</strong> 项默认</div>`;

  const okLabel = must.length > 0 ? '仍要提交' : '确认提交';
  return `<div class="confirm-form">
  <h2 class="confirm-title">确认提交</h2>
  <div class="confirm-line">已决策 <strong>${model.decided}</strong> 项</div>
  ${mustWarn}
  ${optBlock}
  ${importantBlock}
  <div class="confirm-actions">
    <button type="button" class="confirm-btn confirm-cancel" data-act="cancel">返回补填</button>
    <button type="button" class="confirm-btn confirm-ok${must.length > 0 ? ' confirm-ok-warn' : ''}" data-act="confirm">${okLabel}</button>
  </div>
</div>`;
}

function reintroBannerHtml() {
  return `<div class="reintro-banner" role="alert">
  <span class="reintro-icon" aria-hidden="true">⚠️</span>
  <span class="reintro-text">本轮议题可能重组，已突出新增/改动项。建议开启「只看变更」对照前后差异，或联系 AI 澄清。</span>
  <button type="button" class="reintro-close" aria-label="关闭提示">✕</button>
</div>`;
}

// 跳转到指定 block（提交确认模态内点击未表态/重要默认项时）
function jumpToBlock(id) {
  if (!id) return;
  // 防守：id 含特殊字符（引号等）时用 CSS.escape 避免选择器失效
  const safe = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id;
  const el = $zones.querySelector(`[data-block-id="${safe}"]`);
  if (!el) return;
  // 若目标块在隐藏的 tab 面里 → 先切到该面（保证从提交弹层能跳进隐藏 tab，防盲签）
  const facet = el.closest('.facet');
  if (facet && facet.hidden) activateFacet(Number(facet.dataset.facet));
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('block-flash');
  setTimeout(() => el.classList.remove('block-flash'), 1600);
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// 决策进度实时更新（DESIGN §13 P2）：statusBar 的 <progress> + 「已填 m/X」+ tab 角标
function updateDecisionProgress() {
  const prog = $zones.querySelector('.decision-progress');
  if (prog) {
    const answered = countAnsweredDecisions(_blocks, loadDraft());
    prog.value = answered;
    const count = $zones.querySelector('.decision-count');
    if (count) {
      const total = Number(count.dataset.total) || Number(prog.max) || 0;
      count.textContent = `已填 ${answered}/${total}`;
    }
  }
  updateFacetBadges();
  updateMobileBadges();
  refreshDecisionChip();
}

// ── tab 分面导航（DESIGN §15）─────────────────────────────
function activateFacet(idx) {
  $zones.querySelectorAll('.facet').forEach((f) => { f.hidden = Number(f.dataset.facet) !== idx; });
  $zones.querySelectorAll('.tab-nav .tab').forEach((t) => {
    const on = Number(t.dataset.facet) === idx;
    t.classList.toggle('tab-active', on);
    if (!t.disabled) t.setAttribute('aria-selected', String(on));
  });
  repositionVisiblePinComments();
}

// 按当前草稿选默认激活面：URL ?facet=<面名|序号> 优先；否则第一个"含未确认必须决策"的非空面；再否则第一个非空面
function activateDefaultFacet() {
  if (!$zones.querySelector('.tab-nav')) return;   // 非 tab 模式
  const groups = groupBySection(_blocks, _sectionData);

  // 深链：?facet=UI 设计 / ?facet=2（可分享某一面）
  const want = params.get('facet');
  if (want) {
    const byName = groups.findIndex((g) => g.section === want);
    const byIdx = Number.isInteger(Number(want)) ? Number(want) : -1;
    const hit = byName !== -1 ? byName : (groups[byIdx] ? byIdx : -1);
    if (hit !== -1) { activateFacet(hit); return; }
  }

  const draft = loadDraft();
  let idx = groups.findIndex((g) => g.blocks.length && sectionPendingStats(g.blocks, draft).must > 0);
  if (idx === -1) idx = groups.findIndex((g) => g.blocks.length);
  if (idx === -1) idx = 0;
  activateFacet(idx);
}

// 更新每个 tab 角标（未确认决策数 + 颜色：红=含必须、橙=只剩可接受、灰=已清零）
function updateFacetBadges() {
  const nav = $zones.querySelector('.tab-nav');
  if (!nav) return;
  const groups = groupBySection(_blocks, _sectionData);
  const draft = loadDraft();
  groups.forEach((g, i) => {
    const badge = nav.querySelector(`.tab-badge[data-facet="${i}"]`);
    if (!badge) return;
    const st = sectionPendingStats(g.blocks, draft);
    badge.textContent = String(st.must + st.optional);
    badge.className = `tab-badge tab-badge-${st.must > 0 ? 'must' : (st.optional > 0 ? 'optional' : 'done')}`;
  });
}

async function doSubmit(draft, answeredIds, unanswered) {
  // 构造 items
  const items = Object.entries(draft).map(([blockId, item]) => {
    const entries = [];
    if (item.verdict) entries.push({ blockId, type: 'verdict', value: item.verdict, comment: item.comment });
    else if (item.select) entries.push({ blockId, type: 'select', value: item.select, comment: item.comment });
    else if (item.text) entries.push({ blockId, type: 'text', value: item.text, comment: item.comment });
    // 看了但不改（P2 · 病例 5）：与"没看"(unanswered) 语义区分
    else if (item.confirmed === true) entries.push({ blockId, type: 'confirm', value: '保持原样', comment: item.comment });
    if (item.comment && !item.verdict && !item.select && !item.text && item.confirmed !== true) {
      entries.push({ blockId, type: 'comment', value: null, comment: item.comment });
    }
    // embed 飞书式评论 → 每条有文本的评论产生一条 feedback item
    if (Array.isArray(item.comments)) {
      item.comments.forEach((c) => {
        if (c && c.text) {
          entries.push({ blockId, type: 'pin', value: { quote: c.quote }, comment: c.text });
        }
      });
    }
    // checklist 三态 → 每个 item 产生一条 select feedback，value = 'itemId:label'
    if (item.checklistItems && typeof item.checklistItems === 'object') {
      Object.entries(item.checklistItems).forEach(([itemId, label]) => {
        if (label) {
          entries.push({ blockId, type: 'select', value: `${itemId}:${label}` });
        }
      });
    }
    // 原型控件移动（编辑模式）→ 每个被拖过的控件产生一条 move feedback（含归一化几何）
    if (item.moves && typeof item.moves === 'object') {
      Object.entries(item.moves).forEach(([widgetId, g]) => {
        entries.push({ blockId, type: 'move', value: { widgetId, ...g } });
      });
    }
    // prototype pin 批注 → 每条有文本的 pin 产生一条 pin feedback
    if (Array.isArray(item.pins)) {
      item.pins.forEach((pin) => {
        if (pin && pin.text) {
          entries.push({
            blockId,
            type: 'pin',
            value: { xPct: pin.xPct, yPct: pin.yPct },
            comment: pin.text,
          });
        }
      });
    }
    return entries;
  }).flat();

  const payload = {
    session: SESSION,
    round: Number(currentRound),
    submittedAt: new Date().toISOString(),
    items,
    unanswered,                                                    // = 需决策但"没看/未操作"（不含"看了不改"）
    sessionComment: ($sessionComment?.value ?? '').trim() || null,  // 会话级留言（P1 · 病例 6）
  };

  let resp;
  try {
    resp = await fetch(apiUrl('/api/feedback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    downloadFallback(payload);
    return;
  }

  if (resp.status === 409) {
    alert('该轮 AI 正在处理中，请等待或使用强制重试。');
    return;
  }

  if (!resp.ok) {
    if (confirm(`提交失败（HTTP ${resp.status}），是否下载为 JSON？`)) {
      downloadFallback(payload);
    }
    return;
  }

  // 成功：提示可离开（一次性 toast）
  const toastKey = `wb:${SESSION}:${currentRound}:toast-sent`;
  if (!sessionStorage.getItem(toastKey)) {
    sessionStorage.setItem(toastKey, '1');
    showToast('提交成功！AI 正在处理，你可以关闭此页面，回复后会变蓝提醒。');
  }
  $submitBtn.disabled = true;
  $submitBtn.textContent = '已提交';
}

function downloadFallback(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedback-${SESSION}-${currentRound}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(msg) {
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  Object.assign(div.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: '#1a1a1a', color: '#fff', padding: '10px 18px', borderRadius: '8px',
    zIndex: 9999, fontSize: '14px', maxWidth: '80vw',
  });
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

// ── 轮次解析 / 自动推进 ───────────────────────────────────
// 向服务端查最新一轮（用于固定 URL：不带 round 时跟随最新一轮）。
async function resolveLatestRound() {
  try {
    const resp = await fetch(apiUrl(`/api/status?session=${encodeURIComponent(SESSION)}`));
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data?.status?.round;
    return Number.isInteger(r) ? r : null;
  } catch { return null; }
}

// 就地推进到新一轮：重置本轮 UI 状态 + 重新载入渲染（无需手动刷新/换链接）。
async function advanceToRound(newRound) {
  currentRound = newRound;
  _latestRound = Math.max(Number(_latestRound) || 0, newRound);
  _historyRoundsCacheKey = '';
  $submitBtn.disabled = false;
  $submitBtn.textContent = '提交';
  updateSessionLabel();
  document.title = `第 ${newRound} 轮 — 振动编码工作台`;
  await loadAndRender();
  await refreshLatestDecisionState();
  await loadHistoryRounds();
  showToast(`AI 已生成第 ${newRound} 轮，已为你自动载入 ✦`);
}

// 启动：URL 不带 round → 解析为最新一轮；否则用 URL 指定的轮。
async function bootstrap() {
  await loadSessions();
  const resolvedLatest = await resolveLatestRound();
  if (resolvedLatest != null) _latestRound = resolvedLatest;
  if (currentRound == null) {
    currentRound = resolvedLatest ?? 1;
    updateSessionLabel();
  }
  await loadAndRender();
  await Promise.all([
    refreshLatestDecisionState(),
    loadStream({ initial: true }),
    loadHistoryRounds(),
  ]);
  setActiveView('decision');
}

// ── 状态轮询 ─────────────────────────────────────────────
let _prevState = null;
let _notifGranted = false;

if (Notification?.permission === 'granted') _notifGranted = true;
else if (Notification?.permission !== 'denied') {
  Notification?.requestPermission?.().then((p) => { if (p === 'granted') _notifGranted = true; });
}

async function pollStatus() {
  if (!SESSION) return;
  try {
    const resp = await fetch(apiUrl(`/api/status?session=${encodeURIComponent(SESSION)}`));
    if (!resp.ok) return;
    const status = await resp.json();

    // 自动推进：仅在"跟随最新轮"模式（URL 未锁定 round）下，服务端出现更高轮次才就地载入
    const latest = status?.status?.round;
    const latestChanged = Number.isInteger(latest) && latest !== _latestRound;
    if (Number.isInteger(latest)) {
      if (latestChanged) {
        _documentsCacheKey = '';
        _historyRoundsCacheKey = '';
        _latestBlocks = [];
      }
      _latestRound = latest;
    }
    if (FOLLOW_LATEST && Number.isInteger(latest) && currentRound != null && latest > currentRound) {
      await advanceToRound(latest);
      return;
    }
    if (latestChanged) {
      await Promise.all([
        refreshLatestDecisionState(),
        loadHistoryRounds(),
      ]);
    }

    const now = Date.now();

    $statusMount.innerHTML = statusBadgeHtml(status, now);

    // document.title 角标（已回复 / 处理中）
    const state = status.state;
    if (state === 'responded' && _prevState !== 'responded') {
      document.title = '🔵 已回复 — 振动编码工作台';
      if (_notifGranted) {
        new Notification('AI 已回复', { body: '新一轮内容已生成，请查看。' });
      }
    }

    _prevState = state;

    // 重试按钮事件（每次重新绑定）
    $statusMount.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleRetry(btn.dataset.action === 'force-retry'));
    });
  } catch { /* 轮询静默忽略 */ }
}

async function handleRetry(force = false) {
  if (force && !confirm('强制重试会忽略当前处理状态，可能导致重复处理，确认？')) return;
  try {
    await fetch(apiUrl(`/api/retry?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(currentRound)}&force=${force}`), { method: 'POST' });
  } catch { /* 静默 */ }
  await pollStatus();
}

// 每 3s 先同步最新轮状态，再并行拉增量消息与其他参与者意见。
// 同一轮询周期不重入，避免慢网络下乱序覆盖游标。
let _pollCycleRunning = false;
async function pollCycle() {
  if (_pollCycleRunning) return;
  _pollCycleRunning = true;
  try {
    await pollStatus();
    await Promise.all([loadParticipantFeedback(), loadStream()]);
  } finally {
    _pollCycleRunning = false;
  }
}
setInterval(() => { void pollCycle(); }, 3000);

// 决策进度：委托监听 $zones（一次绑定，innerHTML 重渲后仍生效）——决策类交互后刷新「已填 m/X」
['change', 'input', 'click'].forEach((evt) => {
  $zones.addEventListener(evt, updateDecisionProgress);
});

// tab 分面切换（委托，一次绑定）：点非灰 tab → 切到该面
$zones.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && !tab.classList.contains('tab-empty') && !tab.disabled) {
    activateFacet(Number(tab.dataset.facet));
  }
});

// ── 初始化 ────────────────────────────────────────────────
bootstrap();
pollStatus();
