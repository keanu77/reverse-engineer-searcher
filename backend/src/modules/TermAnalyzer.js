/**
 * TermAnalyzer - 分析與統計文章的 MeSH terms 和 keywords
 */

// MeSH check tags and headings that rarely define a review question.
// Age groups, sex and study-design headings are kept: they can be the question itself
// (paediatric, geriatric or sex-difference reviews), so the classifier decides.
const GENERIC_TERMS = new Set([
  'humans',
  'male',
  'female',
  'animals',
  'treatment outcome',
  'follow-up studies',
  'time factors',
  'reference values'
]);

class TermAnalyzer {
  constructor() {
    this.termMap = new Map();
  }

  /**
   * 分析多篇文章，建立 term 統計
   * @param {Object[]} articles - 文章陣列
   * @returns {Object[]} term 統計陣列
   */
  analyzeArticles(articles) {
    this.termMap.clear();

    for (const article of articles) {
      this._processArticleTerms(article);
    }

    // 計算 document frequency
    const terms = this._calculateDocFrequency(articles);

    // 排序：先按 doc_freq 降序，再按是否為 MeSH-major
    return terms.sort((a, b) => {
      // 優先排序：doc_freq
      if (b.doc_freq !== a.doc_freq) {
        return b.doc_freq - a.doc_freq;
      }
      // 其次：MeSH-major > MeSH > keyword
      const sourceOrder = { 'MeSH-major': 0, 'MeSH': 1, 'keyword': 2 };
      return (sourceOrder[a.source] ?? 3) - (sourceOrder[b.source] ?? 3);
    });
  }

  /**
   * 處理單篇文章的 terms
   */
  _processArticleTerms(article) {
    const termSources = [
      { list: article.mesh_major || [], source: 'MeSH-major' },
      { list: article.mesh_all || [], source: 'MeSH' },
      { list: article.keywords || [], source: 'keyword' }
    ];

    for (const { list, source } of termSources) {
      for (const rawTerm of list) {
        const normalized = this._normalizeTerm(rawTerm);
        const key = normalized;

        if (!this.termMap.has(key)) {
          this.termMap.set(key, {
            term: rawTerm,
            normalized,
            sources: new Set([source]),
            articles: new Set([article.pmid]),
            is_generic: GENERIC_TERMS.has(normalized)
          });
        } else {
          const existing = this.termMap.get(key);
          // Prefer the MeSH spelling over a keyword spelling of the same term.
          if (source !== 'keyword' && !existing.sources.has('MeSH') && !existing.sources.has('MeSH-major')) {
            existing.term = rawTerm;
          }
          existing.sources.add(source);
          existing.articles.add(article.pmid);
        }
      }
    }
  }

  /**
   * 正規化 term（小寫、去除多餘空白）
   */
  _normalizeTerm(term) {
    return term.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * 計算 document frequency
   */
  _calculateDocFrequency(articles) {
    const terms = [];

    for (const [_, termData] of this.termMap) {
      // 決定主要 source（優先順序：MeSH-major > MeSH > keyword）
      let primarySource = 'keyword';
      if (termData.sources.has('MeSH-major')) {
        primarySource = 'MeSH-major';
      } else if (termData.sources.has('MeSH')) {
        primarySource = 'MeSH';
      }

      terms.push({
        term: termData.term,
        normalized: termData.normalized,
        source: primarySource,
        all_sources: Array.from(termData.sources),
        doc_freq: termData.articles.size,
        is_generic: termData.is_generic,
        suggested_role: null // 會由 LLM 填入
      });
    }

    return terms;
  }

  /**
   * 過濾 terms，只保留符合條件的
   * @param {Object[]} terms - term 陣列
   * @param {Object} options - 過濾選項
   * @returns {Object[]} 過濾後的 term 陣列
   */
  filterTerms(terms, options = {}) {
    const {
      minDocFreq = 1,
      excludeGeneric = true,
      maxTerms = null
    } = options;

    let filtered = terms.filter(t => t.doc_freq >= minDocFreq);

    if (excludeGeneric) {
      filtered = filtered.filter(t => !t.is_generic);
    }

    if (maxTerms && filtered.length > maxTerms) {
      filtered = filtered.slice(0, maxTerms);
    }

    return filtered;
  }

  /**
   * 將 terms 按 PICO 角色分組
   * @param {Object[]} terms - 已標記 suggested_role 的 term 陣列
   * @returns {Object} 分組結果
   */
  groupTermsByRole(terms) {
    const groups = {
      P: [], // Population
      I: [], // Intervention/Exposure
      O: [], // Outcome
      D: [], // Study Design
      Other: []
    };

    for (const term of terms) {
      const role = term.suggested_role || 'Other';
      if (groups[role]) {
        groups[role].push(term);
      } else {
        groups.Other.push(term);
      }
    }

    return groups;
  }
}

export default TermAnalyzer;
