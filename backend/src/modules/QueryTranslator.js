/**
 * QueryTranslator - 將 PubMed 搜尋語法轉換成其他資料庫格式
 * 支援：Embase (Ovid), Cochrane Library, Web of Science, Scopus
 */

class QueryTranslator {
  constructor() {
    // PubMed 欄位標籤對照表
    this.fieldMappings = {
      // PubMed -> 其他資料庫
      "[Mesh]": {
        embase: ".sh.", // Emtree subject heading
        cochrane: "[mh]", // MeSH descriptor
        wos: "TS=", // Topic (沒有 MeSH，用主題替代)
        scopus: "INDEXTERMS()",
      },
      "[tiab]": {
        embase: ".ti,ab.",
        cochrane: ":ti,ab",
        wos: "TI= OR AB=",
        scopus: "TITLE-ABS()",
      },
      "[ti]": {
        embase: ".ti.",
        cochrane: ":ti",
        wos: "TI=",
        scopus: "TITLE()",
      },
      "[ab]": {
        embase: ".ab.",
        cochrane: ":ab",
        wos: "AB=",
        scopus: "ABS()",
      },
      "[pt]": {
        embase: ".pt.",
        cochrane: ":pt",
        wos: "DT=",
        scopus: "DOCTYPE()",
      },
      "[tw]": {
        embase: ".tw.",
        cochrane: ":ti,ab,kw",
        wos: "TS=",
        scopus: "TITLE-ABS-KEY()",
      },
    };

    // 布林運算子轉換
    this.booleanMappings = {
      embase: { AND: "AND", OR: "OR", NOT: "NOT" },
      cochrane: { AND: "AND", OR: "OR", NOT: "NOT" },
      wos: { AND: "AND", OR: "OR", NOT: "NOT" },
      scopus: { AND: "AND", OR: "OR", NOT: "AND NOT" },
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
      embase: this.toEmbase(pubmedQuery),
      cochrane: this.toCochrane(pubmedQuery),
      wos: this.toWos(pubmedQuery),
      scopus: this.toScopus(pubmedQuery),
    };
  }

  /**
   * 在引號外的區段執行替換，保護引號內的內容不被修改
   * @param {string} text - 原始文字
   * @param {RegExp} pattern - 要替換的正則表達式
   * @param {Function|string} replacement - 替換函數或字串
   * @returns {string}
   */
  _replaceOutsideQuotes(text, pattern, replacement) {
    const segments = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (!inQuotes && char === '"') {
        // Entering quotes — apply replacement to accumulated segment first
        segments.push({ text: current, quoted: false });
        current = char;
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar) {
        // Exiting quotes
        current += char;
        segments.push({ text: current, quoted: true });
        current = "";
        inQuotes = false;
      } else {
        current += char;
      }
    }
    if (current) {
      segments.push({ text: current, quoted: inQuotes });
    }

    return segments
      .map((seg) => {
        if (seg.quoted) return seg.text;
        return seg.text.replace(pattern, replacement);
      })
      .join("");
  }

  /**
   * 轉換成 Embase (Ovid) 格式
   */
  toEmbase(query) {
    let result = query;

    // 轉換 MeSH 為 Emtree
    result = result.replace(/"([^"]+)"\[Mesh\]/gi, (match, term) => {
      return `exp ${term}/`;
    });
    result = result.replace(/([^\s\(]+)\[Mesh\]/gi, (match, term) => {
      return `exp ${term.replace(/"/g, "")}/`;
    });

    // 轉換 [tiab]
    result = result.replace(/"([^"]+)"\[tiab\]/gi, (match, term) => {
      return `${term}.ti,ab.`;
    });
    result = result.replace(/([^\s\(\)]+)\[tiab\]/gi, (match, term) => {
      return `${term.replace(/"/g, "")}.ti,ab.`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `${term}.ti.`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `${term.replace(/"/g, "")}.ti.`;
    });

    // 轉換 [pt] publication type
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim();
      if (ptTerm.toLowerCase().includes("randomized controlled trial")) {
        return "randomized controlled trial.pt.";
      }
      return `${ptTerm}.pt.`;
    });

    // 移除殘留標籤
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, "");

    return result;
  }

  /**
   * 轉換成 Cochrane Library 格式
   */
  toCochrane(query) {
    let result = query;

    // 轉換 MeSH
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
      const cleanTerm = term.replace(/"/g, "");
      if (cleanTerm.includes("*")) {
        return `${cleanTerm}:ti,ab`;
      }
      return `"${cleanTerm}":ti,ab`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `"${term}":ti`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `"${term.replace(/"/g, "")}":ti`;
    });

    // 轉換 [pt]
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim().toLowerCase();
      if (ptTerm.includes("randomized controlled trial")) {
        return '[pt "randomized controlled trial"]';
      }
      return `[pt "${term.trim()}"]`;
    });

    // 移除殘留標籤
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, "");

    return result;
  }

  /**
   * 轉換成 Web of Science 格式
   */
  toWos(query) {
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
      const cleanTerm = term.replace(/"/g, "");
      return `(TI="${cleanTerm}" OR AB="${cleanTerm}")`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `TI="${term}"`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `TI="${term.replace(/"/g, "")}"`;
    });

    // 轉換 [pt] -> DT= (Document Type)
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim().toLowerCase();
      if (ptTerm.includes("randomized controlled trial")) {
        return 'DT="Article"';
      }
      return `DT="${term.trim()}"`;
    });

    // 移除殘留標籤
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, "");

    return result;
  }

  /**
   * 轉換成 Scopus 格式
   */
  toScopus(query) {
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
      const cleanTerm = term.replace(/"/g, "");
      return `TITLE-ABS("${cleanTerm}")`;
    });

    // 轉換 [ti]
    result = result.replace(/"([^"]+)"\[ti\]/gi, (match, term) => {
      return `TITLE("${term}")`;
    });
    result = result.replace(/([^\s\(\)]+)\[ti\]/gi, (match, term) => {
      return `TITLE("${term.replace(/"/g, "")}")`;
    });

    // 轉換 [pt]
    result = result.replace(/"?([^"\[\]]+)"?\[pt\]/gi, (match, term) => {
      const ptTerm = term.trim().toLowerCase();
      if (ptTerm.includes("randomized controlled trial")) {
        return 'DOCTYPE("ar")';
      }
      return `DOCTYPE("ar")`;
    });

    // Scopus NOT -> AND NOT（保護引號內的 NOT 不被替換）
    result = this._replaceOutsideQuotes(result, /\bNOT\b/g, "AND NOT");

    // 移除殘留標籤
    result = result.replace(/\[(mesh|tiab|ti|ab|tw|pt)\]/gi, "");

    return result;
  }

  /**
   * 取得資料庫資訊
   */
  static getDatabaseInfo() {
    return [
      {
        id: "pubmed",
        name: "PubMed",
        description: "美國國家醫學圖書館的免費生物醫學文獻資料庫",
        url: "https://pubmed.ncbi.nlm.nih.gov/",
        searchUrl: "https://pubmed.ncbi.nlm.nih.gov/?term=",
        canValidate: true,
      },
      {
        id: "embase",
        name: "Embase (Ovid)",
        description: "Elsevier 的生物醫學和藥學文獻資料庫",
        url: "https://www.embase.com/",
        searchUrl: null,
        canValidate: false,
        note: "需機構訂閱",
      },
      {
        id: "cochrane",
        name: "Cochrane Library",
        description: "實證醫學最重要的系統性回顧資料庫",
        url: "https://www.cochranelibrary.com/",
        searchUrl: "https://www.cochranelibrary.com/advanced-search?q=",
        canValidate: false,
      },
      {
        id: "wos",
        name: "Web of Science",
        description: "Clarivate 的多學科引文索引資料庫",
        url: "https://www.webofscience.com/",
        searchUrl: null,
        canValidate: false,
        note: "需機構訂閱",
      },
      {
        id: "scopus",
        name: "Scopus",
        description: "Elsevier 的大型摘要和引文資料庫",
        url: "https://www.scopus.com/",
        searchUrl: null,
        canValidate: false,
        note: "需機構訂閱",
      },
    ];
  }
}

export default QueryTranslator;
