/**
 * QueryTranslator - 將 PubMed 搜尋語法轉換成其他資料庫格式
 * 支援：Embase (Ovid), Cochrane Library, Web of Science, Scopus
 */

class QueryTranslator {
  constructor() {
    // PubMed 欄位標籤對照表
    this.fieldMappings = {
      // PubMed -> 其他資料庫
      '[Mesh]': {
        embase: '.sh.',  // Emtree subject heading
        cochrane: '[mh]',  // MeSH descriptor
        wos: 'TS=',  // Topic (沒有 MeSH，用主題替代)
        scopus: 'INDEXTERMS()'
      },
      '[tiab]': {
        embase: '.ti,ab.',
        cochrane: ':ti,ab',
        wos: 'TI= OR AB=',
        scopus: 'TITLE-ABS()'
      },
      '[ti]': {
        embase: '.ti.',
        cochrane: ':ti',
        wos: 'TI=',
        scopus: 'TITLE()'
      },
      '[ab]': {
        embase: '.ab.',
        cochrane: ':ab',
        wos: 'AB=',
        scopus: 'ABS()'
      },
      '[pt]': {
        embase: '.pt.',
        cochrane: ':pt',
        wos: 'DT=',
        scopus: 'DOCTYPE()'
      },
      '[tw]': {
        embase: '.tw.',
        cochrane: ':ti,ab,kw',
        wos: 'TS=',
        scopus: 'TITLE-ABS-KEY()'
      }
    };

    // 布林運算子轉換
    this.booleanMappings = {
      embase: { AND: 'AND', OR: 'OR', NOT: 'NOT' },
      cochrane: { AND: 'AND', OR: 'OR', NOT: 'NOT' },
      wos: { AND: 'AND', OR: 'OR', NOT: 'NOT' },
      scopus: { AND: 'AND', OR: 'OR', NOT: 'AND NOT' }
    };
  }

  /**
   * 將 PubMed 查詢轉換成所有支援的資料庫格式
   * @param {string} pubmedQuery - PubMed 搜尋式
   * @returns {Object} 各資料庫的搜尋式
   */
  translateAll(pubmedQuery) {
    return {
      pubmed: pubmedQuery,
      embase: this.toPubmedToEmbase(pubmedQuery),
      cochrane: this.toPubmedToCochrane(pubmedQuery),
      wos: this.toPubmedToWos(pubmedQuery),
      scopus: this.toPubmedToScopus(pubmedQuery)
    };
  }

  /**
   * 轉換成 Embase (Ovid) 格式
   */
  toPubmedToEmbase(query) {
    let result = query;

    // 轉換 MeSH 為 Emtree
    // "Term"[Mesh] -> exp Term/ 或 Term.sh.
    result = result.replace(/"([^"]+)"\[Mesh\]/gi, (match, term) => {
      return `exp ${term}/`;
    });
    result = result.replace(/([^\s\(]+)\[Mesh\]/gi, (match, term) => {
      return `exp ${term.replace(/"/g, '')}/`;
    });

    // 轉換 [tiab]
    result = result.replace(/"([^"]+)"\[tiab\]/gi, (match, term) => {
      return `${term}.ti,ab.`;
    });
    result = result.replace(/([^\s\(\)]+)\[tiab\]/gi, (match, term) => {
      return `${term.replace(/"/g, '')}.ti,ab.`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `${term}.ti.`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `${term.replace(/"/g, '')}.ti.`;
    });

    // 轉換 [pt] publication type
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim();
      if (ptTerm.toLowerCase().includes('randomized controlled trial')) {
        return 'randomized controlled trial.pt.';
      }
      return `${ptTerm}.pt.`;
    });

    // 轉換截斷符號 * -> $ (Ovid 使用 $ 或 *)
    // Ovid 也支援 *，所以保留即可

    // 移除 PubMed 特有的欄位標籤（如果還有殘留）
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, '');

    return result;
  }

  /**
   * 轉換成 Cochrane Library 格式
   */
  toPubmedToCochrane(query) {
    let result = query;

    // 轉換 MeSH
    // "Term"[Mesh] -> [mh "Term"]
    result = result.replace(/"([^"]+)"\[Mesh\]/gi, (match, term) => {
      return `[mh "${term}"]`;
    });
    result = result.replace(/([^\s\(\)"]+)\[Mesh\]/gi, (match, term) => {
      return `[mh ${term}]`;
    });

    // 轉換 [tiab]
    result = result.replace(/"([^"]+)"\[tiab\]/gi, (match, term) => {
      return `"${term}":ti,ab`;
    });
    result = result.replace(/([^\s\(\)]+)\[tiab\]/gi, (match, term) => {
      const cleanTerm = term.replace(/"/g, '');
      if (cleanTerm.includes('*')) {
        return `${cleanTerm}:ti,ab`;
      }
      return `"${cleanTerm}":ti,ab`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `"${term}":ti`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `"${term.replace(/"/g, '')}":ti`;
    });

    // 轉換 [pt]
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim().toLowerCase();
      if (ptTerm.includes('randomized controlled trial')) {
        return '[pt "randomized controlled trial"]';
      }
      return `[pt "${term.trim()}"]`;
    });

    // 移除殘留標籤
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, '');

    return result;
  }

  /**
   * 轉換成 Web of Science 格式
   */
  toPubmedToWos(query) {
    let result = query;

    // WoS 沒有 MeSH，轉換為 Topic Search (TS=)
    result = result.replace(/"([^"]+)"\[Mesh\]/gi, (match, term) => {
      return `TS="${term}"`;
    });
    result = result.replace(/([^\s\(\)"]+)\[Mesh\]/gi, (match, term) => {
      return `TS="${term}"`;
    });

    // 轉換 [tiab] -> TI= OR AB=
    result = result.replace(/"([^"]+)"\[tiab\]/gi, (match, term) => {
      return `(TI="${term}" OR AB="${term}")`;
    });
    result = result.replace(/([^\s\(\)]+)\[tiab\]/gi, (match, term) => {
      const cleanTerm = term.replace(/"/g, '');
      return `(TI="${cleanTerm}" OR AB="${cleanTerm}")`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `TI="${term}"`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `TI="${term.replace(/"/g, '')}"`;
    });

    // 轉換 [pt] -> DT= (Document Type)
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim().toLowerCase();
      if (ptTerm.includes('randomized controlled trial')) {
        return 'DT="Article"';  // WoS 沒有直接對應，用 Article 近似
      }
      return `DT="${term.trim()}"`;
    });

    // WoS 使用 * 作為截斷符號，保持不變

    // 移除殘留標籤
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, '');

    return result;
  }

  /**
   * 轉換成 Scopus 格式
   */
  toPubmedToScopus(query) {
    let result = query;

    // Scopus 使用 INDEXTERMS() 對應 MeSH
    result = result.replace(/"([^"]+)"\[Mesh\]/gi, (match, term) => {
      return `INDEXTERMS("${term}")`;
    });
    result = result.replace(/([^\s\(\)"]+)\[Mesh\]/gi, (match, term) => {
      return `INDEXTERMS("${term}")`;
    });

    // 轉換 [tiab] -> TITLE-ABS()
    result = result.replace(/"([^"]+)"\[tiab\]/gi, (match, term) => {
      return `TITLE-ABS("${term}")`;
    });
    result = result.replace(/([^\s\(\)]+)\[tiab\]/gi, (match, term) => {
      const cleanTerm = term.replace(/"/g, '');
      return `TITLE-ABS("${cleanTerm}")`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `TITLE("${term}")`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `TITLE("${term.replace(/"/g, '')}")`;
    });

    // 轉換 [pt]
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim().toLowerCase();
      if (ptTerm.includes('randomized controlled trial')) {
        return 'DOCTYPE("ar")';  // Article
      }
      return `DOCTYPE("ar")`;
    });

    // Scopus NOT -> AND NOT
    result = result.replace(/\bNOT\b/g, 'AND NOT');

    // Scopus 使用 * 作為截斷符號，保持不變

    // 移除殘留標籤
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, '');

    return result;
  }

  /**
   * 取得資料庫資訊
   */
  static getDatabaseInfo() {
    return [
      {
        id: 'pubmed',
        name: 'PubMed',
        description: '美國國家醫學圖書館的免費生物醫學文獻資料庫',
        url: 'https://pubmed.ncbi.nlm.nih.gov/',
        searchUrl: 'https://pubmed.ncbi.nlm.nih.gov/?term=',
        canValidate: true
      },
      {
        id: 'embase',
        name: 'Embase (Ovid)',
        description: 'Elsevier 的生物醫學和藥學文獻資料庫',
        url: 'https://www.embase.com/',
        searchUrl: null,
        canValidate: false,
        note: '需機構訂閱'
      },
      {
        id: 'cochrane',
        name: 'Cochrane Library',
        description: '實證醫學最重要的系統性回顧資料庫',
        url: 'https://www.cochranelibrary.com/',
        searchUrl: 'https://www.cochranelibrary.com/advanced-search?q=',
        canValidate: false
      },
      {
        id: 'wos',
        name: 'Web of Science',
        description: 'Clarivate 的多學科引文索引資料庫',
        url: 'https://www.webofscience.com/',
        searchUrl: null,
        canValidate: false,
        note: '需機構訂閱'
      },
      {
        id: 'scopus',
        name: 'Scopus',
        description: 'Elsevier 的大型摘要和引文資料庫',
        url: 'https://www.scopus.com/',
        searchUrl: null,
        canValidate: false,
        note: '需機構訂閱'
      }
    ];
  }
}

export default QueryTranslator;
