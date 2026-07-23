// 反馈提交按钮的轻量状态机。
// 提交完成后保持禁用，直到用户再次修改；提交请求进行中发生的新修改不能被误标为“已提交”。

const BUTTON_MODELS = Object.freeze({
  ready: { disabled: false, label: '提交' },
  dirty: { disabled: false, label: '再次提交' },
  submitting: { disabled: true, label: '提交中…' },
  'submitting-dirty': { disabled: true, label: '提交中…' },
  submitted: { disabled: true, label: '已提交' },
});

export function submitButtonModel(state) {
  return BUTTON_MODELS[state] ?? BUTTON_MODELS.ready;
}

export function submitStateAfterEdit(state) {
  if (state === 'submitted') return 'dirty';
  if (state === 'submitting') return 'submitting-dirty';
  return state;
}

export function submitStateAfterSuccess(state) {
  return state === 'submitting-dirty' ? 'dirty' : 'submitted';
}

export function submitStateAfterFailure(state, previousState = 'ready') {
  if (state === 'submitting-dirty' || previousState === 'dirty') return 'dirty';
  return 'ready';
}
