import axios from 'axios';
import { parseStringPromise } from 'xml2js';

const PUBMED_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// 重試設定
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1秒起始延遲

// 快取設定
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小時
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
      timeout: 30000
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
   * 將文章存入快取
   */
  _cacheArticle(article) {
    articleCache.set(article.pmid, new CacheEntry(article));
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
      expired: expiredCount
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 帶有指數退避重試的請求包裝器
   * @param {Function} requestFn - 執行請求的函數
   * @param {string} operationName - 操作名稱（用於日誌）
   * @returns {Promise<any>}
   */
  async _withRetry(requestFn, operationName = 'request') {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        // 判斷是否應該重試
        const shouldRetry = this._isRetryableError(error);

        if (!shouldRetry || attempt === MAX_RETRIES) {
          console.error(`${operationName} failed after ${attempt} attempt(s):`, error.message);
          throw error;
        }

        // 計算延遲時間（指數退避：1s, 2s, 4s...）
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`${operationName} attempt ${attempt} failed, retrying in ${delayMs}ms...`);
        await this._delay(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * 判斷錯誤是否可重試
   */
  _isRetryableError(error) {
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
   * 根據 PMIDs 取得文章的完整 metadata（包含 MeSH terms 和 keywords）
   * @param {string[]} pmids - PMID 陣列
   * @returns {Promise<Object[]>} 文章資料陣列
   */
  async fetchArticlesByPmids(pmids) {
    if (!pmids || pmids.length === 0) {
      return { articles: [], missingPmids: [] };
    }

    // 先檢查快取
    const cachedArticles = [];
    const uncachedPmids = [];

    for (const pmid of pmids) {
      const cached = this._getCachedArticle(pmid);
      if (cached) {
        cachedArticles.push(cached);
        console.log(`Cache hit for PMID: ${pmid}`);
      } else {
        uncachedPmids.push(pmid);
      }
    }

    // 如果所有文章都在快取中
    if (uncachedPmids.length === 0) {
      console.log(`All ${pmids.length} articles served from cache`);
      const foundPmids = cachedArticles.map(a => a.pmid);
      const missingPmids = pmids.filter(p => !foundPmids.includes(p));
      return { articles: cachedArticles, missingPmids };
    }

    // 只取得未快取的文章
    console.log(`Fetching ${uncachedPmids.length} articles from PubMed (${cachedArticles.length} from cache)`);

    return this._withRetry(async () => {
      // 使用 efetch 取得完整的 XML 資料（包含 MeSH 和 Keywords）
      const response = await this.axiosInstance.get('/efetch.fcgi', {
        params: this._buildParams({
          db: 'pubmed',
          id: uncachedPmids.join(','),
          rettype: 'xml',
          retmode: 'xml'
        })
      });

      const parsed = await parseStringPromise(response.data, {
        explicitArray: false,
        mergeAttrs: true
      });

      const fetchedArticles = [];
      const pubmedArticleSet = parsed.PubmedArticleSet;

      if (!pubmedArticleSet || !pubmedArticleSet.PubmedArticle) {
        // 沒有找到新文章，但可能有快取的
        const allArticles = [...cachedArticles];
        const foundPmids = allArticles.map(a => a.pmid);
        const missingPmids = pmids.filter(p => !foundPmids.includes(p));
        return { articles: allArticles, missingPmids };
      }

      // 確保是陣列
      const articleList = Array.isArray(pubmedArticleSet.PubmedArticle)
        ? pubmedArticleSet.PubmedArticle
        : [pubmedArticleSet.PubmedArticle];

      for (const articleData of articleList) {
        const article = this._parseArticle(articleData);
        if (article) {
          fetchedArticles.push(article);
          // 存入快取
          this._cacheArticle(article);
        }
      }

      // 合併快取和新取得的文章
      const allArticles = [...cachedArticles, ...fetchedArticles];

      // 標記找不到的 PMIDs
      const foundPmids = allArticles.map(a => a.pmid);
      const missingPmids = pmids.filter(p => !foundPmids.includes(p));

      return {
        articles: allArticles,
        missingPmids
      };
    }, 'fetchArticlesByPmids');
  }

  /**
   * 解析單篇文章的 XML 資料
   */
  _parseArticle(articleData) {
    try {
      const medlineCitation = articleData.MedlineCitation;
      if (!medlineCitation) return null;

      const pmid = medlineCitation.PMID?._ || medlineCitation.PMID;
      const article = medlineCitation.Article;

      if (!article) return null;

      // 取得標題
      const title = article.ArticleTitle?._ || article.ArticleTitle || '';

      // 取得摘要
      let abstract = '';
      if (article.Abstract?.AbstractText) {
        const abstractText = article.Abstract.AbstractText;
        if (Array.isArray(abstractText)) {
          abstract = abstractText.map(t => t._ || t).join(' ');
        } else {
          abstract = abstractText._ || abstractText;
        }
      }

      // 取得期刊名稱
      const journal = article.Journal?.Title || article.Journal?.ISOAbbreviation || '';

      // 取得發表年份
      let year = '';
      const pubDate = article.Journal?.JournalIssue?.PubDate;
      if (pubDate) {
        year = pubDate.Year || pubDate.MedlineDate?.substring(0, 4) || '';
      }

      // 取得 MeSH Terms
      const meshHeadings = medlineCitation.MeshHeadingList?.MeshHeading || [];
      const meshList = Array.isArray(meshHeadings) ? meshHeadings : [meshHeadings];

      const meshMajor = [];
      const meshAll = [];

      for (const mesh of meshList) {
        if (!mesh.DescriptorName) continue;

        const descriptorName = mesh.DescriptorName._ || mesh.DescriptorName;
        const isMajor = mesh.DescriptorName.MajorTopicYN === 'Y';

        meshAll.push(descriptorName);
        if (isMajor) {
          meshMajor.push(descriptorName);
        }

        // 也處理 Qualifiers（若需要更細緻的 MeSH 資訊）
        if (mesh.QualifierName) {
          const qualifiers = Array.isArray(mesh.QualifierName)
            ? mesh.QualifierName
            : [mesh.QualifierName];
          for (const qual of qualifiers) {
            const qualName = qual._ || qual;
            if (qual.MajorTopicYN === 'Y') {
              meshMajor.push(`${descriptorName}/${qualName}`);
            }
          }
        }
      }

      // 取得 Author Keywords
      const keywordList = medlineCitation.KeywordList?.Keyword || [];
      const keywords = [];
      const kwList = Array.isArray(keywordList) ? keywordList : [keywordList];
      for (const kw of kwList) {
        const keyword = kw._ || kw;
        if (keyword) {
          keywords.push(keyword);
        }
      }

      return {
        pmid: String(pmid),
        title,
        abstract,
        journal,
        year: String(year),
        mesh_major: [...new Set(meshMajor)],
        mesh_all: [...new Set(meshAll)],
        keywords: [...new Set(keywords)]
      };
    } catch (error) {
      console.error('Error parsing article:', error.message);
      return null;
    }
  }

  /**
   * 執行 PubMed 搜尋並取得命中數量和 PMID 列表
   * @param {string} query - PubMed 搜尋字串
   * @param {number} retmax - 最多回傳幾筆 PMID（預設 500）
   * @returns {Promise<Object>} { count, pmids }
   */
  async searchPubMed(query, retmax = 500) {
    return this._withRetry(async () => {
      const response = await this.axiosInstance.get('/esearch.fcgi', {
        params: this._buildParams({
          db: 'pubmed',
          term: query,
          retmax,
          retmode: 'json',
          usehistory: 'n'
        })
      });

      const result = response.data.esearchresult;

      if (result.errorlist?.phrasesnotfound?.length > 0) {
        console.warn('Some phrases not found:', result.errorlist.phrasesnotfound);
      }

      return {
        count: parseInt(result.count, 10),
        pmids: result.idlist || [],
        queryTranslation: result.querytranslation || ''
      };
    }, 'searchPubMed');
  }

  /**
   * 驗證特定 PMIDs 是否在搜尋結果中
   * @param {string} query - PubMed 搜尋字串
   * @param {string[]} goldPmids - 要檢查的 PMID 陣列
   * @returns {Promise<Object>} 驗證結果
   */
  async validateQueryCoversGoldPmids(query, goldPmids) {
    try {
      // 先取得搜尋結果
      const searchResult = await this.searchPubMed(query, 10000);

      // 檢查 gold PMIDs 是否都在結果中
      const hitPmidSet = new Set(searchResult.pmids);
      const missingPmids = goldPmids.filter(pmid => !hitPmidSet.has(pmid));

      return {
        hit_count: searchResult.count,
        covers_all_gold: missingPmids.length === 0,
        missing_pmids: missingPmids,
        query_translation: searchResult.queryTranslation
      };
    } catch (error) {
      console.error('Error validating query:', error.message);
      throw new Error(`Failed to validate query: ${error.message}`);
    }
  }
}

export default PubMedClient;
