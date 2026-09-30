import { logFailure } from './SafeLogging.js';
import axios from "axios";
import { parsePubmedXml } from "./pubmedXml.js";

const PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// 重試設定
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1秒起始延遲

// 快取設定
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小時
const CACHE_MAX_SIZE = 500; // 最多快取 500 篇文章
const articleCache = new Map();

/**
 * 簡單的快取條目
 */
class CacheEntry {
  constructor(data) {
    this.data = data;
    this.timestamp = Date.now();
  }

  isExpired() {
    return Date.now() - this.timestamp > CACHE_TTL_MS;
  }
}

/**
 * PubMedClient - 封裝對 PubMed E-utilities API 的呼叫
 */
class PubMedClient {
  constructor(apiKey = null) {
    this.apiKey = apiKey || process.env.PUBMED_API_KEY;
    this.axiosInstance = axios.create({
      baseURL: PUBMED_BASE_URL,
      timeout: 30000,
    });
  }

  /**
   * 從快取取得文章
   */
  _getCachedArticle(pmid) {
    const entry = articleCache.get(pmid);
    if (entry && !entry.isExpired()) {
      return entry.data;
    }
    if (entry) {
      articleCache.delete(pmid); // 清除過期條目
    }
    return null;
  }

  /**
   * 將文章存入快取（含大小上限和 LRU 淘汰）
   */
  _cacheArticle(article) {
    // 先清除過期條目
    if (articleCache.size >= CACHE_MAX_SIZE) {
      this._evictCache();
    }
    articleCache.set(article.pmid, new CacheEntry(article));
  }

  /**
   * 淘汰快取：先刪過期，再刪最舊的直到低於上限
   */
  _evictCache() {
    // 先清過期
    for (const [pmid, entry] of articleCache) {
      if (entry.isExpired()) {
        articleCache.delete(pmid);
      }
    }
    // 如果還超過上限，刪最舊的（Map 的插入順序）
    while (articleCache.size >= CACHE_MAX_SIZE) {
      const oldestKey = articleCache.keys().next().value;
      articleCache.delete(oldestKey);
    }
  }

  /**
   * 取得快取統計
   */
  static getCacheStats() {
    let validCount = 0;
    let expiredCount = 0;

    for (const [pmid, entry] of articleCache) {
      if (entry.isExpired()) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      total: articleCache.size,
      valid: validCount,
      expired: expiredCount,
    };
  }

  /**
   * 清除所有快取
   */
  static clearCache() {
    articleCache.clear();
  }

  /**
   * 延遲工具函數
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 帶有指數退避重試的請求包裝器
   * @param {Function} requestFn - 執行請求的函數
   * @param {string} operationName - 操作名稱（用於日誌）
   * @returns {Promise<any>}
   */
  async _withRetry(requestFn, operationName = "request") {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        // 判斷是否應該重試
        const shouldRetry = this._isRetryableError(error);

        if (!shouldRetry || attempt === MAX_RETRIES) {
          logFailure("pubmed-request", error);
          throw error;
        }

        // 計算延遲時間（指數退避：1s, 2s, 4s...）
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `${operationName} attempt ${attempt} failed, retrying in ${delayMs}ms...`,
        );
        await this._delay(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * 判斷錯誤是否可重試
   */
  _isRetryableError(error) {
    if (error.retryable === false) return false;
    // 網路錯誤
    if (!error.response) {
      return true;
    }

    // 特定 HTTP 狀態碼可重試
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
    return retryableStatusCodes.includes(error.response.status);
  }

  /**
   * 建立帶有 API key 的 query params
   */
  _buildParams(params) {
    const baseParams = { ...params };
    if (this.apiKey) {
      baseParams.api_key = this.apiKey;
    }
    return baseParams;
  }

  /**
   * POST 到 E-utilities（長檢索式不受 URL 長度限制）
   */
  _post(endpoint, params) {
    return this.axiosInstance.post(endpoint, new URLSearchParams(this._buildParams(params)).toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  /**
   * 根據 PMIDs 取得文章 metadata，依輸入順序回傳
   * @param {string[]} pmids - PMID 陣列
   * @returns {Promise<{articles: Object[], missingPmids: string[]}>}
   */
  async fetchArticlesByPmids(pmids) {
    const requested = [...new Set((pmids || []).map((p) => String(p).trim()))];
    if (requested.length === 0) return { articles: [], missingPmids: [] };

    const found = new Map();
    for (const pmid of requested) {
      const cached = this._getCachedArticle(pmid);
      if (cached) found.set(pmid, cached);
    }
    const uncached = requested.filter((pmid) => !found.has(pmid));

    if (uncached.length > 0) {
      const fetched = await this._withRetry(async () => {
        const response = await this._post("/efetch.fcgi", {
          db: "pubmed",
          id: uncached.join(","),
          rettype: "xml",
          retmode: "xml",
        });
        return parsePubmedXml(response.data);
      }, "fetchArticlesByPmids");
      for (const article of fetched) {
        found.set(article.pmid, article);
        this._cacheArticle(article);
      }
    }

    return {
      articles: requested.filter((pmid) => found.has(pmid)).map((pmid) => found.get(pmid)),
      missingPmids: requested.filter((pmid) => !found.has(pmid)),
    };
  }

  /**
   * 執行 PubMed 搜尋，回傳命中數、PMID 與 PubMed 的錯誤／警告
   * @param {string} query - PubMed 搜尋字串
   * @param {Object|number} options - 選項物件或 retmax 數字（向下相容）
   */
  async searchPubMed(query, options = {}) {
    const opts = typeof options === "number" ? { maxResults: options } : options || {};
    const { maxResults = 500, sort = "relevance" } = opts;

    return this._withRetry(async () => {
      const response = await this._post("/esearch.fcgi", {
        db: "pubmed",
        term: query,
        retmax: maxResults,
        retmode: "json",
        sort,
      });
      return interpretESearch(response.data);
    }, "searchPubMed");
  }

  /**
   * 驗證檢索式是否涵蓋金標準 PMIDs。
   * 以「檢索式 AND 金標準 PMID」的交集判斷，不受 ESearch 只回傳前 10,000 筆的限制。
   * @param {string} query - PubMed 搜尋字串
   * @param {Array<string|number>} goldPmids - 要檢查的 PMID
   */
  async validateQueryCoversGoldPmids(query, goldPmids) {
    const gold = [...new Set(goldPmids.map((p) => String(p).trim()))].filter((p) => /^\d+$/.test(p));
    if (gold.length === 0) throw new Error("沒有有效的金標準 PMID");

    const total = await this.searchPubMed(query, { maxResults: 0 });
    const intersection = await this.searchPubMed(
      `(${query}) AND (${gold.map((pmid) => `${pmid}[uid]`).join(" OR ")})`,
      { maxResults: gold.length },
    );
    const captured = new Set(intersection.pmids);
    const missing = gold.filter((pmid) => !captured.has(pmid));

    return {
      hit_count: total.count,
      captured_pmids: gold.filter((pmid) => captured.has(pmid)),
      missing_pmids: missing,
      covers_all_gold: missing.length === 0,
      query_translation: total.queryTranslation,
      pubmed_errors: total.errors,
      pubmed_warnings: total.warnings,
    };
  }
}

const ERROR_LABELS = {
  phrasesnotfound: "PubMed 找不到片語",
  fieldsnotfound: "PubMed 不認得的欄位",
};
const WARNING_LABELS = {
  quotedphrasesnotfound: "PubMed 找不到引號片語",
  phrasesignored: "PubMed 忽略的字",
  outputmessages: "PubMed 訊息",
};

function listMessages(group, labels) {
  return Object.entries(labels).flatMap(([key, label]) =>
    (Array.isArray(group?.[key]) ? group[key] : []).map((item) => `${label}：${item}`),
  );
}

/**
 * 解讀 ESearch JSON。語法錯誤不重試；缺少有效 count 視為錯誤而不是零筆。
 */
function interpretESearch(data) {
  const result = data?.esearchresult;
  const fatal = result?.ERROR || data?.error;
  if (fatal) {
    const error = new Error(`PubMed 無法執行此檢索式：${fatal}`);
    error.retryable = false;
    throw error;
  }
  const count = Number(result?.count);
  if (!result || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("PubMed 回應格式異常，無法取得命中數");
  }
  return {
    count,
    pmids: Array.isArray(result.idlist) ? result.idlist.map(String) : [],
    queryTranslation: result.querytranslation || "",
    errors: listMessages(result.errorlist, ERROR_LABELS),
    warnings: listMessages(result.warninglist, WARNING_LABELS),
  };
}

export default PubMedClient;
