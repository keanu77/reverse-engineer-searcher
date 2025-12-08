import PubMedClient from './PubMedClient.js';

/**
 * QueryValidator - 驗證搜尋式是否能涵蓋金標準文章
 */
class QueryValidator {
  constructor(pubMedClient = null) {
    this.pubMedClient = pubMedClient || new PubMedClient();
  }

  /**
   * 驗證單一搜尋式
   * @param {Object} query - 搜尋式物件
   * @param {string[]} goldPmids - 金標準 PMIDs
   * @returns {Promise<Object>} 驗證結果
   */
  async validateQuery(query, goldPmids) {
    try {
      const result = await this.pubMedClient.validateQueryCoversGoldPmids(
        query.query_string,
        goldPmids
      );

      return {
        ...query,
        hit_count: result.hit_count,
        covers_all_gold: result.covers_all_gold,
        missing_pmids: result.missing_pmids,
        query_translation: result.query_translation
      };
    } catch (error) {
      console.error(`Error validating query ${query.id}:`, error.message);
      return {
        ...query,
        hit_count: null,
        covers_all_gold: false,
        missing_pmids: goldPmids,
        error: error.message
      };
    }
  }

  /**
   * 批量驗證多個搜尋式（並行處理）
   * @param {Object[]} queries - 搜尋式陣列
   * @param {string[]} goldPmids - 金標準 PMIDs
   * @param {Object} options - 選項
   * @param {boolean} options.parallel - 是否並行驗證（預設 true）
   * @param {number} options.concurrency - 並行數量（預設 3）
   * @returns {Promise<Object[]>} 驗證結果陣列
   */
  async validateQueries(queries, goldPmids, options = {}) {
    const { parallel = true, concurrency = 3 } = options;

    if (parallel && queries.length <= concurrency) {
      // 查詢數少於並行數，直接全部並行
      console.log(`Validating ${queries.length} queries in parallel...`);
      const results = await Promise.all(
        queries.map(query => this.validateQuery(query, goldPmids))
      );
      return results;
    } else if (parallel) {
      // 分批並行處理
      console.log(`Validating ${queries.length} queries with concurrency ${concurrency}...`);
      const results = [];
      for (let i = 0; i < queries.length; i += concurrency) {
        const batch = queries.slice(i, i + concurrency);
        const batchResults = await Promise.all(
          batch.map(query => this.validateQuery(query, goldPmids))
        );
        results.push(...batchResults);

        // 批次間短暫延遲
        if (i + concurrency < queries.length) {
          await this._delay(200);
        }
      }
      return results;
    } else {
      // 順序驗證（舊的行為）
      const results = [];
      for (const query of queries) {
        const result = await this.validateQuery(query, goldPmids);
        results.push(result);
        await this._delay(300);
      }
      return results;
    }
  }

  /**
   * 生成警告訊息
   * @param {Object[]} validatedQueries - 驗證後的搜尋式陣列
   * @returns {string[]} 警告訊息陣列
   */
  generateWarnings(validatedQueries) {
    const warnings = [];

    for (const query of validatedQueries) {
      if (query.error) {
        warnings.push(`${query.label}: Unable to validate due to error - ${query.error}`);
      } else if (!query.covers_all_gold) {
        const missingList = query.missing_pmids.join(', ');
        warnings.push(`${query.label} does not include PMID(s): ${missingList}`);
      }

      if (query.hit_count && query.hit_count > 10000) {
        warnings.push(`${query.label} returns ${query.hit_count} results - consider adding more specific terms`);
      }
    }

    return warnings;
  }

  /**
   * 計算搜尋式的品質指標
   * @param {Object} query - 驗證後的搜尋式
   * @param {number} totalGold - 金標準文章總數
   * @returns {Object} 品質指標
   */
  calculateQualityMetrics(query, totalGold) {
    const capturedGold = totalGold - (query.missing_pmids?.length || 0);

    return {
      recall: totalGold > 0 ? capturedGold / totalGold : 0,
      nnt: query.hit_count && capturedGold > 0
        ? Math.round(query.hit_count / capturedGold)
        : null, // Number Needed to screen to find one gold article
      coverage_rate: `${capturedGold}/${totalGold}`
    };
  }

  /**
   * 延遲函數
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default QueryValidator;
