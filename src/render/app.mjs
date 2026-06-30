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
const ROUND   = params.get('round')   ?? '';

const DRAFT_KEY = `wb:${SESSION}:${ROUND}:fb`;

// ── 元素引用 ─────────────────────────────────────────────
const $zones        = document.getElementById('zones-mount');
const $statusMount  = document.getElementById('status-badge-mount');
const $diffMount    = document.getElementById('diff-toggle-mount');
const $submitBtn    = document.getElementById('submit-btn');
const $sessionLabel = document.getElementById('session-label');

$sessionLabel.textContent = SESSION ? `会话 ${SESSION}  ·  轮 ${ROUND}` : '（无会话）';

// ── 草稿 ─────────────────────────────────────────────────
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') ?? {}; }
  catch { return {}; }
}

function saveDraft(patch) {
  const draft = loadDraft();
  Object.assign(draft, patch);
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

// ── 渲染 ─────────────────────────────────────────────────
let _blocks = [];   // 当前轮 blocks（带 _change）

async function loadAndRender() {
  let data;
  try {
    const resp = await fetch(`/api/content?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(ROUND)}`);
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
    // 批注（inline）：还原内容并就地展开显示
    if (item.comment != null && item.comment !== '') {
      const ta = $zones.querySelector(`.comment-input[data-comment-for="${blockId}"]`);
      const box = $zones.querySelector(`.comment-box[data-comment-box="${blockId}"]`);
      if (ta) ta.value = item.comment;
      if (box) box.hidden = false;
      updateCommentBtn(blockId, item.comment);
    }
    // embed pins：还原所有落点钉子 + 内联批注
    if (Array.isArray(item.pins) && item.pins.length > 0) {
      const overlay = $zones.querySelector(`.embed-overlay[data-embed-overlay="${blockId}"]`);
      if (overlay) {
        item.pins.forEach((pin, idx) => {
          renderPin(overlay, blockId, pin, idx);
        });
        updatePinCount(blockId, item.pins.length);
      }
    }
  });
}

// 批注按钮文案：有内容→提示可收起；空→恢复"+批注"
function updateCommentBtn(blockId, val) {
  const btn = $zones.querySelector(`.comment-btn[data-block-id="${blockId}"]`);
  if (btn) btn.textContent = (val && val.trim()) ? '批注 ✓（点击收起）' : '+批注';
}

// ── embed 落点辅助 ──────────────────────────────────────────

/**
 * 在 overlay 内绝对定位放一个钉子（编号圆点）+ 内联 textarea（批注）。
 * pin-comment 故意不带 data-block-id，避免被通用 textarea handler 误当 text 草稿。
 * 用 data-pin-index + 闭包写回 draft.pins[idx].comment。
 */
function renderPin(overlay, blockId, pin, idx) {
  const dot = document.createElement('div');
  dot.className = 'embed-pin';
  dot.textContent = String(idx + 1);
  dot.style.left = `${pin.xPct}%`;
  dot.style.top = `${pin.yPct}%`;

  const ta = document.createElement('textarea');
  ta.className = 'pin-comment';
  ta.setAttribute('data-pin-index', String(idx));
  ta.setAttribute('rows', '2');
  ta.setAttribute('placeholder', `批注 #${idx + 1}`);
  ta.style.left = `${pin.xPct}%`;
  ta.style.top = `${pin.yPct}%`;
  if (pin.comment) ta.value = pin.comment;

  ta.addEventListener('input', () => {
    const draft = loadDraft();
    const item = draft[blockId] || {};
    const pins = Array.isArray(item.pins) ? item.pins : [];
    if (pins[idx]) pins[idx].comment = ta.value;
    saveDraft({ [blockId]: { ...item, pins } });
  });

  overlay.appendChild(dot);
  overlay.appendChild(ta);
}

function updatePinCount(blockId, count) {
  const el = $zones.querySelector(`.embed-pin-count[data-embed-count="${blockId}"]`);
  if (el) el.textContent = `${count} 条批注`;
}

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

  // embed 批注模式 toggle
  $zones.querySelectorAll('.embed-annotate-toggle').forEach((checkbox) => {
    const blockId = checkbox.dataset.embed;
    if (!blockId) return;
    checkbox.addEventListener('change', () => {
      const overlay = $zones.querySelector(`.embed-overlay[data-embed-overlay="${blockId}"]`);
      if (!overlay) return;
      if (checkbox.checked) {
        overlay.removeAttribute('hidden');
      } else {
        overlay.setAttribute('hidden', '');
      }
    });
  });

  // embed overlay 点击落点
  $zones.querySelectorAll('.embed-overlay').forEach((overlay) => {
    const blockId = overlay.dataset.embedOverlay;
    if (!blockId) return;
    overlay.addEventListener('click', (e) => {
      const rect = overlay.getBoundingClientRect();
      const xPct = Math.max(0, Math.min(100, (e.offsetX / overlay.clientWidth) * 100));
      const yPct = Math.max(0, Math.min(100, (e.offsetY / overlay.clientHeight) * 100));

      const draft = loadDraft();
      const item = draft[blockId] || {};
      const pins = Array.isArray(item.pins) ? item.pins : [];
      const idx = pins.length;
      const pin = { xPct, yPct, comment: '' };
      pins.push(pin);
      saveDraft({ [blockId]: { ...item, pins } });

      renderPin(overlay, blockId, pin, idx);
      updatePinCount(blockId, pins.length);
    });
  });

  // 批注（inline：点按钮就地展开输入框，内容就地显示、可编辑，不弹窗）
  $zones.querySelectorAll('.comment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bId = btn.dataset.blockId;
      const box = $zones.querySelector(`.comment-box[data-comment-box="${bId}"]`);
      if (!box) return;
      const willShow = box.hidden;
      box.hidden = !willShow;
      btn.setAttribute('aria-expanded', String(willShow));
      if (willShow) box.querySelector('.comment-input')?.focus();
    });
  });
  $zones.querySelectorAll('.comment-input').forEach((ta) => {
    const bId = ta.dataset.commentFor;
    if (!bId) return;
    ta.addEventListener('input', () => {
      const val = ta.value;
      saveDraft({ [bId]: { ...loadDraft()[bId], comment: val.trim() ? val : undefined } });
      updateCommentBtn(bId, val);
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
    // embed 落点 pins → 每个 pin 产生一条 feedback item
    if (Array.isArray(item.pins)) {
      item.pins.forEach((pin) => {
        entries.push({ blockId, type: 'pin', value: { xPct: pin.xPct, yPct: pin.yPct }, comment: pin.comment || '' });
      });
    }
    return entries;
  }).flat();

  const payload = {
    session: SESSION,
    round: Number(ROUND),
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
  const toastKey = `wb:${SESSION}:${ROUND}:toast-sent`;
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
  a.download = `feedback-${SESSION}-${ROUND}.json`;
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
    await fetch(`/api/retry?session=${encodeURIComponent(SESSION)}&round=${encodeURIComponent(ROUND)}&force=${force}`, { method: 'POST' });
  } catch { /* 静默 */ }
  await pollStatus();
}

// 每 3s 轮询
setInterval(pollStatus, 3000);

// ── 初始化 ────────────────────────────────────────────────
loadAndRender();
pollStatus();
