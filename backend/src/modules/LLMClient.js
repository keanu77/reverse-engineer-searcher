import OpenAI from 'openai';

/**
 * LLMClient - Provider configuration and client initialization
 * Supports: Groq, OpenAI, Grok (xAI), Gemini, Ollama, or any OpenAI-compatible API
 */

const PROVIDER_CONFIGS = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    strongModel: 'openai/gpt-oss-120b',
    envKey: 'GROQ_API_KEY'
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    strongModel: 'gpt-4o',
    envKey: 'OPENAI_API_KEY'
  },
  grok: {
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.3',
    strongModel: 'grok-4.3',
    envKey: 'XAI_API_KEY'
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-3.6-flash',
    strongModel: 'gemini-3.6-flash',
    envKey: 'GEMINI_API_KEY'
  },
  ollama: {
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    strongModel: 'llama3.2',
    envKey: null
  },
  custom: {
    baseURL: null,
    defaultModel: null,
    strongModel: null,
    envKey: 'CUSTOM_API_KEY'
  }
};

class LLMClient {
  constructor(options = {}) {
    const provider = (options.provider || process.env.LLM_PROVIDER || 'groq').toLowerCase();

    // 取得 provider 設定
    const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.custom;

    // Credentials must be explicitly authorized by the request boundary.
    const apiKey = options.apiKey;
    if (!apiKey) throw new Error('Explicit LLM credentials required');

    // 決定 baseURL
    const baseURL = options.baseURL || config.baseURL;

    // 建立 OpenAI 相容客戶端
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL,
      timeout: 45000,
      maxRetries: 1,
      fetch: (url, init) => globalThis.fetch(url, { ...init, redirect: 'error' })
    });

    // 設定模型
    this.model = options.model || config.defaultModel;
    this.strongModel = options.strongModel || options.model || config.strongModel || this.model;

    this.provider = provider;
    this.supportsJsonMode = ['openai', 'groq', 'gemini'].includes(provider);


  }

  /**
   * 取得支援的 providers 列表
   */
  static getProviders() {
    return Object.keys(PROVIDER_CONFIGS).map(key => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      ...PROVIDER_CONFIGS[key]
    }));
  }
}

export { LLMClient, PROVIDER_CONFIGS };
export default LLMClient;
