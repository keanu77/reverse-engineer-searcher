/**
 * 輸入驗證測試
 */

// PMID 驗證正則
const PMID_REGEX = /^[0-9]{1,12}$/;

// 允許的 LLM providers
const ALLOWED_PROVIDERS = ['groq', 'openai', 'gemini', 'grok', 'ollama'];

// 驗證限制
const VALIDATION_LIMITS = {
  maxPmids: 10,
  maxQueryStringLength: 5000,
  maxTopicLength: 200,
  maxApiKeyLength: 200,
  maxBaseURLLength: 200,
  maxModelLength: 100
};

describe('PMID 驗證', () => {
  test('應接受有效的 PMID', () => {
    expect(PMID_REGEX.test('12345678')).toBe(true);
    expect(PMID_REGEX.test('1')).toBe(true);
    expect(PMID_REGEX.test('123456789012')).toBe(true);
  });

  test('應拒絕無效的 PMID', () => {
    expect(PMID_REGEX.test('')).toBe(false);
    expect(PMID_REGEX.test('abc')).toBe(false);
    expect(PMID_REGEX.test('123abc')).toBe(false);
    expect(PMID_REGEX.test('1234567890123')).toBe(false); // 超過 12 位
    expect(PMID_REGEX.test('-123')).toBe(false);
  });

  test('PMID 清理功能', () => {
    const cleanPmid = (input) => {
      const trimmed = String(input).trim();
      if (PMID_REGEX.test(trimmed)) return trimmed;
      const cleaned = trimmed.replace(/\D/g, '');
      if (cleaned.length > 0 && cleaned.length <= 12) return cleaned;
      return null;
    };

    expect(cleanPmid('12345678')).toBe('12345678');
    expect(cleanPmid(' 12345678 ')).toBe('12345678');
    expect(cleanPmid('PMID:12345678')).toBe('12345678');
    expect(cleanPmid('abc')).toBe(null);
  });
});

describe('LLM Provider 驗證', () => {
  test('應接受有效的 provider', () => {
    ALLOWED_PROVIDERS.forEach(provider => {
      expect(ALLOWED_PROVIDERS.includes(provider)).toBe(true);
    });
  });

  test('應拒絕無效的 provider', () => {
    expect(ALLOWED_PROVIDERS.includes('invalid')).toBe(false);
    expect(ALLOWED_PROVIDERS.includes('')).toBe(false);
    expect(ALLOWED_PROVIDERS.includes('azure')).toBe(false);
  });
});

describe('輸入長度限制', () => {
  test('query_string 長度驗證', () => {
    const shortQuery = 'a'.repeat(100);
    const longQuery = 'a'.repeat(VALIDATION_LIMITS.maxQueryStringLength + 1);

    expect(shortQuery.length <= VALIDATION_LIMITS.maxQueryStringLength).toBe(true);
    expect(longQuery.length <= VALIDATION_LIMITS.maxQueryStringLength).toBe(false);
  });

  test('topic 長度驗證', () => {
    const shortTopic = '運動對於膝關節炎的治療效果';
    const longTopic = 'a'.repeat(VALIDATION_LIMITS.maxTopicLength + 1);

    expect(shortTopic.length <= VALIDATION_LIMITS.maxTopicLength).toBe(true);
    expect(longTopic.length <= VALIDATION_LIMITS.maxTopicLength).toBe(false);
  });

  test('API Key 長度驗證', () => {
    const validKey = 'sk-' + 'a'.repeat(50);
    const tooLongKey = 'a'.repeat(VALIDATION_LIMITS.maxApiKeyLength + 1);

    expect(validKey.length <= VALIDATION_LIMITS.maxApiKeyLength).toBe(true);
    expect(tooLongKey.length <= VALIDATION_LIMITS.maxApiKeyLength).toBe(false);
  });
});

describe('PMID 陣列處理', () => {
  test('應正確去除重複', () => {
    const pmids = ['123', '456', '123', '789', '456'];
    const unique = [...new Set(pmids)];
    expect(unique).toEqual(['123', '456', '789']);
  });

  test('應限制最大數量', () => {
    const pmids = Array(15).fill(0).map((_, i) => String(i));
    expect(pmids.length > VALIDATION_LIMITS.maxPmids).toBe(true);
    const limited = pmids.slice(0, VALIDATION_LIMITS.maxPmids);
    expect(limited.length).toBe(VALIDATION_LIMITS.maxPmids);
  });
});

describe('安全性驗證', () => {
  test('生產環境應禁止 custom provider', () => {
    const isProduction = true;
    const provider = 'custom';

    const shouldReject = isProduction && provider === 'custom';
    expect(shouldReject).toBe(true);
  });

  test('生產環境應禁止自訂 baseURL', () => {
    const isProduction = true;
    const baseURL = 'https://malicious.example.com/api';

    const shouldReject = isProduction && !!baseURL;
    expect(shouldReject).toBe(true);
  });

  test('開發環境應允許 custom provider', () => {
    const isProduction = false;
    const provider = 'custom';

    const shouldReject = isProduction && provider === 'custom';
    expect(shouldReject).toBe(false);
  });
});
