import { timingSafeEqual } from 'node:crypto';
import { PROVIDER_CONFIGS } from './LLMClient.js';

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isLocal = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const matchesToken = (provided, expected) => {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function sanitizeLLMConfig(config = {}, req) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new RequestError('LLM 設定格式錯誤');
  }
  for (const [field, limit] of Object.entries({ provider: 30, apiKey: 512, baseURL: 500, model: 100 })) {
    if (config[field] !== undefined && (typeof config[field] !== 'string' || config[field].length > limit)) {
      throw new RequestError('LLM 設定格式或長度錯誤');
    }
  }
  const provider = (config.provider || process.env.LLM_PROVIDER || 'groq').toLowerCase();
  if (!Object.hasOwn(PROVIDER_CONFIGS, provider)) throw new RequestError('不支援的 LLM provider');
  const localProvider = provider === 'custom' || provider === 'ollama';
  if ((localProvider || config.baseURL) && (process.env.NODE_ENV === 'production' || !isLocal(req?.socket?.remoteAddress))) {
    throw new RequestError('自訂 API 與 Ollama 僅限本機開發使用');
  }
  if (config.baseURL && provider !== 'custom') throw new RequestError('自訂 API 端點請選擇 custom provider');
  if (provider === 'custom') {
    let url;
    try { url = new URL(config.baseURL); } catch { throw new RequestError('請提供有效的 API 端點'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new RequestError('API 端點不允許內嵌認證資料或查詢參數');
    }
    if (!config.model?.trim()) throw new RequestError('請指定自訂模型');
  }

  let apiKey = config.apiKey?.trim();
  if (!apiKey && localProvider) apiKey = 'local-no-key';
  if (!apiKey) {
    // CORS is not authorization. No request can silently spend an operator key.
    if (!matchesToken(req?.get?.('X-Service-Token'), process.env.AUTH_API_KEY)) {
      throw new RequestError('請輸入自己的 API Key，或輸入管理者提供的服務存取碼', 401);
    }
    apiKey = process.env[PROVIDER_CONFIGS[provider].envKey];
    if (!apiKey) throw new RequestError('此服務尚未設定所選 provider 的 API Key', 503);
  }
  return { provider, apiKey, baseURL: config.baseURL || undefined, model: config.model || undefined };
}

export { logFailure } from './SafeLogging.js';

export function publicError(error, fallback = '外部服務暫時無法完成請求，請稍後重試') {
  return error instanceof RequestError ? error.message : fallback;
}

export function errorStatus(error) {
  return error instanceof RequestError ? error.status : 502;
}
