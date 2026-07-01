// 浏览器入口（不单测）。
// 职责：读 URL → fetch 内容 → 渲染 → 草稿存 localStorage → 提交 → 轮询状态。
// 纯 DOM 事件绑定放在这里，渲染器是纯函数导入。
import { renderZones } from './attention-view.mjs';
import { diffToggleHtml } from './diff-view.mjs';
import { statusBadgeHtml } from './status-bar.mjs';
import { submitSummary, unansweredDecisions } from '../protocol/attention.mjs';

// ── URL 参数 ──────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SESSION = params.get('session') ?? '';
const URL_ROUND = params.get('round') ?? '';   // 可空：留空 = 自动跟随最新一轮（固定 URL）

// 当前展示的轮次；为 null 时在 bootstrap 里解析为服务端最新一轮，并可随新轮自动推进
let currentRound = URL_ROUND !== '' ? Number(URL_ROUND) : null;

function draftKey() { return `wb:${SESSION}:${currentRound}:fb`; }

// ── 元素引用 ─────────────────────────────────────────────
const $zones        = document.getElementById('zones-mount');
const $statusMount  = document.getElementById('status-badge-mount');
const $diffMount    = document.getElementById('diff-toggle-mount');
const $submitBtn    = document.getElementById('submit-btn');
const $sessionLabel = document.getElementById('session-label');

function updateSessionLabel() {
  $sessionLabel.textContent = SESSION
    ? `会话 ${SESSION}  ·  轮 ${currentRound ?? '…'}`
    : '（无会话）';
}
updateSessionLabel();

// ── 草稿 ─────────────────────────────────────────────────
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(draftKey()) ?? 'null') ?? {}; }
  catch { return {}; }
}

function saveDraft(patch) {
  const draft = loadDraft();
  Object.assign(draft, patch);
  localStorage.setItem(draftKey(), JSON.stringify(draft));
}

// ── 渲染 ─────────────────────────────────────────────────
let _blocks = [];   // 当前轮 blocks（带 _change）

async function loadAndRender() {
  let data;
  try {
    const resp = await fetch(`/api/content?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(currentRound)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    $zones.innerHTML = `<p class="load-error">加载内容失败：${escapeHtml(String(err.message))}</p>`;
    return;
  }

  _blocks = data.blocks ?? [];
  $zones.innerHTML = renderZones(_blocks);

  // 注入 diff 开关
  $diffMount.innerHTML = diffToggleHtml();

  // 恢复草稿 UI（简单：遍历 textarea/input）
  restoreDraftUI(loadDraft());

  // 激活 mermaid
  if (window.mermaid) {
    try { window.mermaid.run(); } catch { /* 降级 */ }
  }

  // 绑定互动事件
  bindInteractions();
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
  const summary = submitSummary(_blocks, answeredIds);

  // 提交前确认（§13 P0-1）
  const msg = [
    `你将：`,
    `· 决策 ${summary.decided} 项`,
    `· 接受 ${summary.acceptedDefaults} 项默认（含 ${summary.importantDefaults.length} 项重要）`,
    summary.unanswered.length > 0 ? `· ${summary.unanswered.length} 项未表态（${summary.unanswered.join(', ')}）` : '',
    `\n确认提交？`,
  ].filter(Boolean).join('\n');

  if (!confirm(msg)) return;

  doSubmit(draft, answeredIds, unanswered);
});

async function doSubmit(draft, answeredIds, unanswered) {
  // 构造 items
  const items = Object.entries(draft).map(([blockId, item]) => {
    const entries = [];
    if (item.verdict) entries.push({ blockId, type: 'verdict', value: item.verdict, comment: item.comment });
    else if (item.select) entries.push({ blockId, type: 'select', value: item.select, comment: item.comment });
    else if (item.text) entries.push({ blockId, type: 'text', value: item.text, comment: item.comment });
    if (item.comment && !item.verdict && !item.select && !item.text) {
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
    return entries;
  }).flat();

  const payload = {
    session: SESSION,
    round: Number(currentRound),
    submittedAt: new Date().toISOString(),
    items,
    unanswered,
  };

  let resp;
  try {
    resp = await fetch('/api/feedback', {
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
    const resp = await fetch(`/api/status?session=${encodeURIComponent(SESSION)}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data?.status?.round;
    return Number.isInteger(r) ? r : null;
  } catch { return null; }
}

// 就地推进到新一轮：重置本轮 UI 状态 + 重新载入渲染（无需手动刷新/换链接）。
async function advanceToRound(newRound) {
  currentRound = newRound;
  $submitBtn.disabled = false;
  $submitBtn.textContent = '提交';
  updateSessionLabel();
  document.title = `第 ${newRound} 轮 — 振动编码工作台`;
  await loadAndRender();
  showToast(`AI 已生成第 ${newRound} 轮，已为你自动载入 ✦`);
}

// 启动：URL 不带 round → 解析为最新一轮；否则用 URL 指定的轮。
async function bootstrap() {
  if (currentRound == null) {
    currentRound = (await resolveLatestRound()) ?? 1;
    updateSessionLabel();
  }
  await loadAndRender();
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
    const resp = await fetch(`/api/status?session=${encodeURIComponent(SESSION)}`);
    if (!resp.ok) return;
    const status = await resp.json();

    // 自动推进：服务端出现更高轮次 → 就地载入新一轮（无需手动刷新 / 换链接）
    const latest = status?.status?.round;
    if (Number.isInteger(latest) && currentRound != null && latest > currentRound) {
      await advanceToRound(latest);
      return;
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
    await fetch(`/api/retry?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(currentRound)}&force=${force}`, { method: 'POST' });
  } catch { /* 静默 */ }
  await pollStatus();
}

// 每 3s 轮询
setInterval(pollStatus, 3000);

// ── 初始化 ────────────────────────────────────────────────
bootstrap();
pollStatus();
