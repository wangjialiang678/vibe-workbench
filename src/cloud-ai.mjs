// 云端执行面的统一开关。只把精确的 on 视为启用，未配置与畸形值均安全地保持关闭。
export function cloudAiEnabled(env = process.env) {
  return env?.WB_CLOUD_AI === 'on';
}

export function cloudAiAuthMode(env = process.env) {
  const mode = env?.WB_CLOUD_AI_AUTH;
  if (mode == null || mode === '') return 'subscription';
  if (mode === 'subscription' || mode === 'apikey') return mode;
  const error = new Error('WB_CLOUD_AI_AUTH 仅支持 subscription 或 apikey');
  error.kind = 'auth';
  throw error;
}

export const CLOUD_AI_DISABLED_MESSAGE = '云端 AI 未启用';
