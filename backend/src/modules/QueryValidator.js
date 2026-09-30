import { logFailure } from './SafeLogging.js';
import PubMedClient from './PubMedClient.js';

/**
 * QueryValidator - 檢查檢索式是否涵蓋種子文獻，並以獨立驗證組估計泛化能力
 *
 * validation_status:
 *   verified   PubMed 正常執行並完成比對
 *   unreliable PubMed 回報找不到片語或欄位（部分條件可能被忽略），結果僅供參考
 *   skipped    檢索式有語法錯誤，未送出
 *   failed     PubMed 暫時無法驗證，涵蓋與否未知
 */
class QueryValidator {
  constructor(pubMedClient = null) {
    this.pubMedClient = pubMedClient || new PubMedClient();
  }

  async validateQuery(query, seedPmids, validationPmids = []) {
    if (query.lint_errors?.length) {
      return this._withMetrics({ ...query, validation_status: 'skipped', hit_count: null, missing_pmids: [], covers_all_gold: null }, seedPmids, validationPmids);
    }
    try {
      const result = await this.pubMedClient.validateQueryCoversGoldPmids(query.query_string, [...seedPmids, ...validationPmids]);
      const captured = new Set(result.captured_pmids);
      const seedMissing = seedPmids.filter(p => !captured.has(p));
      const validated = {
        ...query,
        validation_status: result.pubmed_errors.length ? 'unreliable' : 'verified',
        hit_count: result.hit_count,
        missing_pmids: seedMissing,
        covers_all_gold: seedMissing.length === 0,
        query_translation: result.query_translation,
        pubmed_errors: result.pubmed_errors,
        pubmed_warnings: result.pubmed_warnings,
      };
      if (validationPmids.length) {
        validated.validation_set = {
          captured: validationPmids.filter(p => captured.has(p)),
          missing: validationPmids.filter(p => !captured.has(p)),
        };
      }
      return this._withMetrics(validated, seedPmids, validationPmids);
    } catch (error) {
      logFailure(`Error validating query ${query.id}:`, error);
      return this._withMetrics({
        ...query,
        validation_status: 'failed',
        hit_count: null,
        missing_pmids: [],
        covers_all_gold: null,
        error: error.retryable === false ? error.message : 'PubMed 驗證暫時失敗，請稍後重試',
      }, seedPmids, validationPmids);
    }
  }

  /**
   * 依序驗證（每條兩次 ESearch），避免超過 NCBI 速率限制
   */
  async validateQueries(queries, seedPmids, { validationPmids = [] } = {}) {
    const results = [];
    for (const query of queries) {
      results.push(await this.validateQuery(query, seedPmids, validationPmids));
    }
    return results;
  }

  _withMetrics(query, seedPmids, validationPmids) {
    return { ...query, quality_metrics: this.calculateQualityMetrics(query, seedPmids.length, validationPmids.length) };
  }

  /**
   * 種子涵蓋率只代表這組種子文獻，不是對所有相關文獻的召回率；
   * 驗證組未參與選詞與產生檢索式，才能用來估計泛化能力。
   */
  calculateQualityMetrics(query, seedCount, validationCount = 0) {
    const known = ['verified', 'unreliable'].includes(query.validation_status) && seedCount > 0;
    const captured = known ? seedCount - query.missing_pmids.length : null;
    const metrics = {
      seed_coverage: known ? `${captured}/${seedCount}` : null,
      seed_coverage_ratio: known ? captured / seedCount : null,
      // Hits per captured seed: screening workload relative to the seeds, not precision.
      hits_per_seed: known && captured > 0 && Number.isFinite(query.hit_count) ? Math.round(query.hit_count / captured) : null,
    };
    if (validationCount > 0) {
      const hit = query.validation_set?.captured.length;
      metrics.validation_coverage = known ? `${hit}/${validationCount}` : null;
      metrics.validation_coverage_ratio = known ? hit / validationCount : null;
    }
    return metrics;
  }

  generateWarnings(validatedQueries) {
    const warnings = [];
    for (const q of validatedQueries) {
      const label = q.label || q.id;
      if (q.validation_status === 'failed') {
        warnings.push(`${label}：無法驗證（${q.error}），涵蓋情況未知`);
        continue;
      }
      if (q.validation_status === 'skipped') {
        warnings.push(`${label}：檢索式有錯誤，未送 PubMed 驗證（${(q.lint_errors || []).join('；')}）`);
        continue;
      }
      for (const message of q.pubmed_errors || []) warnings.push(`${label}：${message}（部分條件可能被 PubMed 忽略）`);
      for (const message of q.pubmed_warnings || []) warnings.push(`${label}：${message}`);
      if (q.missing_pmids?.length) warnings.push(`${label}：未涵蓋種子文獻 PMID ${q.missing_pmids.join(', ')}`);
      if (q.validation_set?.missing.length) warnings.push(`${label}：未涵蓋驗證組 PMID ${q.validation_set.missing.join(', ')}`);
      if (q.hit_count === 0) warnings.push(`${label}：PubMed 命中 0 筆`);
      else if (q.hit_count > 10000) {
        warnings.push(`${label}：命中 ${q.hit_count.toLocaleString('en-US')} 筆，篩選工作量大；是否縮小範圍應依研究問題決定，不要只為了減量而刪詞`);
      }
    }
    return warnings;
  }
}

export default QueryValidator;
