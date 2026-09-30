/**
 * QueryTranslator - 將 PubMed 檢索式轉成其他資料庫語法
 * 支援：Embase (Ovid)、Cochrane Library、Web of Science Core Collection、Scopus
 *
 * 先解析成布林樹（pubmedQuery.js）再逐節點輸出，每個二元運算都加括號。
 * 無法等價轉換之處一律產生警告；不支援的欄位標成「未轉換」，不靜默刪除。
 */
import { parsePubmedQuery } from "./pubmedQuery.js";

const TARGETS = ["embase", "cochrane", "wos", "scopus"];

const RCT_TEXT_WARNING =
  "RCT 在此資料庫沒有對應的文件類型，已改為簡單文字篩選（random*／placebo*），不是經驗證的 RCT filter，請改用已發表的篩選式";

// PubMed publication type → per-database rendering. Missing entries are unsupported.
const PUBLICATION_TYPES = {
  "randomized controlled trial": {
    embase: ["randomized controlled trial/", "Embase 的 RCT 是 Emtree 主題詞；系統性回顧建議改用已驗證的 Embase RCT 篩選式"],
    cochrane: ['"randomized controlled trial":pt', "檢索 CENTRAL 時通常不需要研究設計篩選"],
    wos: ["TS=(random* OR placebo*)", RCT_TEXT_WARNING],
    scopus: ["TITLE-ABS-KEY(random* OR placebo*)", RCT_TEXT_WARNING],
  },
  "clinical trial": {
    embase: ["clinical trial/"],
    cochrane: ['"clinical trial":pt'],
    wos: ['TS=("clinical trial*")', "WoS 沒有臨床試驗文件類型，已改為主題文字"],
    scopus: ['TITLE-ABS-KEY("clinical trial*")', "Scopus 沒有臨床試驗文件類型，已改為文字"],
  },
  review: {
    embase: ["review.pt."],
    cochrane: ['"review":pt'],
    wos: ["DT=(Review)"],
    scopus: ["DOCTYPE(re)"],
  },
  "systematic review": {
    embase: ["systematic review/"],
    cochrane: ['"systematic review":pt'],
    wos: ["DT=(Review)", "WoS 的 Review 文件類型包含非系統性回顧"],
    scopus: ["DOCTYPE(re)", "Scopus 的 Review 文件類型包含非系統性回顧"],
  },
  "meta-analysis": {
    embase: ["meta analysis/"],
    cochrane: ['"meta-analysis":pt'],
    wos: ['TS=("meta-analy*" OR metaanaly*)', "WoS 沒有統合分析文件類型，已改為主題文字"],
    scopus: ['TITLE-ABS-KEY("meta-analy*" OR metaanaly*)', "Scopus 沒有統合分析文件類型，已改為文字"],
  },
  editorial: { embase: ["editorial.pt."], cochrane: ['"editorial":pt'], wos: ["DT=(Editorial Material)"], scopus: ["DOCTYPE(ed)"] },
  letter: { embase: ["letter.pt."], cochrane: ['"letter":pt'], wos: ["DT=(Letter)"], scopus: ["DOCTYPE(le)"] },
};

const words = (text) => text.split(/\s+/).filter(Boolean);
const isPhrase = (text) => words(text).length > 1;
const hasTruncation = (text) => text.includes("*");

/** "Osteoarthritis, Knee" → "Knee Osteoarthritis" (MeSH headings are often inverted). */
function naturalOrder(heading) {
  const parts = heading.split(/,\s*/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : heading;
}

// A text value for databases whose field syntax wraps values: word, "phrase", or proximity for truncated phrases.
function wrappedValue(text, adjacency) {
  if (!isPhrase(text)) return text;
  return hasTruncation(text) ? words(text).join(` ${adjacency} `) : `"${text}"`;
}

// A text value for databases whose field syntax is a suffix (Ovid, Cochrane).
function suffixValue(text, adjacency) {
  if (!isPhrase(text)) return text;
  return hasTruncation(text) ? `(${words(text).join(` ${adjacency} `)})` : `"${text}"`;
}

const unsupported = (term) => `<<未轉換：${term.text}[${term.rawField || term.field}]>>`;

const RENDERERS = {
  embase: {
    not: "NOT",
    mesh(term, warn) {
      warn(`MeSH「${term.text}」未必是 Emtree 詞，請在 Ovid 用 Map Term 確認對應`);
      const star = term.major ? "*" : "";
      return term.noexp ? `${star}${term.text}/` : `exp ${star}${term.text}/`;
    },
    tiab: (t) => `${suffixValue(t.text, "adj")}.ti,ab,kw.`,
    ti: (t) => `${suffixValue(t.text, "adj")}.ti.`,
    tw: (t) => `${suffixValue(t.text, "adj")}.mp.`,
    untagged: (t) => `${suffixValue(t.text, "adj")}.mp.`,
    proximity: (t) => `(${words(t.text).join(` adj${t.distance} `)}).ti,ab,kw.`,
  },
  cochrane: {
    not: "NOT",
    mesh(term, warn) {
      if (term.major) warn("Cochrane Library 不支援 MeSH major topic 限制，已改為一般 MeSH");
      return term.noexp ? `[mh ^"${term.text}"]` : `[mh "${term.text}"]`;
    },
    tiab: (t) => `${suffixValue(t.text, "NEXT")}:ti,ab,kw`,
    ti: (t) => `${suffixValue(t.text, "NEXT")}:ti`,
    tw: (t) => `${suffixValue(t.text, "NEXT")}:ti,ab,kw`,
    untagged: (t) => suffixValue(t.text, "NEXT"),
    proximity: (t) => `(${words(t.text).join(` NEAR/${t.distance} `)}):ti,ab,kw`,
  },
  wos: {
    not: "NOT",
    mesh(term, warn) {
      warn("Web of Science 沒有 MeSH，已改為主題檢索 TS=，不含下位詞，請補充同義詞");
      return `TS=("${naturalOrder(term.text)}")`;
    },
    tiab(t) {
      const value = wrappedValue(t.text, "NEAR/0");
      return `(TI=(${value}) OR AB=(${value}) OR AK=(${value}))`;
    },
    ti: (t) => `TI=(${wrappedValue(t.text, "NEAR/0")})`,
    tw: (t) => `TS=(${wrappedValue(t.text, "NEAR/0")})`,
    untagged: (t) => `TS=(${wrappedValue(t.text, "NEAR/0")})`,
    proximity: (t) => `TS=(${words(t.text).join(` NEAR/${t.distance} `)})`,
  },
  scopus: {
    not: "AND NOT",
    mesh(term, warn) {
      warn("Scopus 的 INDEXTERMS 不會自動展開下位詞，且並非所有紀錄都有 MeSH，請補充文字詞");
      return `INDEXTERMS("${term.text}")`;
    },
    tiab(t) {
      const value = wrappedValue(t.text, "PRE/0");
      return `(TITLE-ABS(${value}) OR AUTHKEY(${value}))`;
    },
    ti: (t) => `TITLE(${wrappedValue(t.text, "PRE/0")})`,
    tw: (t) => `TITLE-ABS-KEY(${wrappedValue(t.text, "PRE/0")})`,
    untagged: (t) => `TITLE-ABS-KEY(${wrappedValue(t.text, "PRE/0")})`,
    proximity: (t) => `TITLE-ABS(${words(t.text).join(` W/${t.distance} `)})`,
  },
};

function renderTerm(db, term, warn) {
  const renderer = RENDERERS[db];
  switch (term.field) {
    case "mesh":
      if (term.qualifier) warn(`MeSH 副標題「/${term.qualifier}」未轉換，已只保留主標題「${term.text}」`);
      return renderer.mesh(term, warn);
    case "tiab":
    case "ti":
      return renderer[term.field](term);
    case "tw":
      warn("[tw] 在 PubMed 涵蓋題名、摘要、MeSH 等多個欄位，轉換後範圍不同");
      return renderer.tw(term);
    case "untagged":
      warn(`「${term.text}」沒有指定欄位；PubMed 會自動詞彙對應，其他資料庫結果會不同`);
      return renderer.untagged(term);
    case "proximity":
      warn("近鄰檢索的距離定義各資料庫不同，請確認");
      return renderer.proximity(term);
    case "pt": {
      const mapping = PUBLICATION_TYPES[term.text.toLowerCase()]?.[db];
      if (!mapping) {
        warn(`出版類型「${term.text}」在此資料庫沒有對應`);
        return unsupported({ ...term, rawField: "pt" });
      }
      if (mapping[1]) warn(mapping[1]);
      return mapping[0];
    }
    default:
      warn(`欄位 [${term.rawField || term.field}] 在此資料庫沒有對應，請手動處理`);
      return unsupported(term);
  }
}

function render(db, node, warn) {
  if (node.type === "term") return renderTerm(db, node, warn);
  const op = node.op === "NOT" ? RENDERERS[db].not : node.op;
  return `(${render(db, node.left, warn)} ${op} ${render(db, node.right, warn)})`;
}

class QueryTranslator {
  /**
   * 將 PubMed 檢索式轉換成所有支援的資料庫格式
   * @param {string} pubmedQuery
   * @returns {{translations: Object<string, string|null>, warnings: Object<string, string[]>, error?: string}}
   */
  translateAll(pubmedQuery) {
    const translations = { pubmed: typeof pubmedQuery === "string" ? pubmedQuery : null };
    const warnings = { pubmed: [] };
    let tree;
    try {
      tree = parsePubmedQuery(pubmedQuery);
    } catch (error) {
      for (const db of TARGETS) {
        translations[db] = null;
        warnings[db] = [];
      }
      return { translations, warnings, error: `無法翻譯：${error.message}` };
    }
    for (const db of TARGETS) {
      const messages = new Set();
      translations[db] = render(db, tree, (message) => messages.add(message));
      warnings[db] = [...messages];
    }
    return { translations, warnings };
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
        description: "Elsevier 的生物醫學和藥學文獻資料庫；語法為 Ovid 介面，Embase.com 語法不同",
        url: "https://ovidsp.ovid.com/",
        searchUrl: null,
        canValidate: false,
        note: "需機構訂閱",
      },
      {
        id: "cochrane",
        name: "Cochrane Library",
        description: "實證醫學最重要的系統性回顧與臨床試驗資料庫",
        url: "https://www.cochranelibrary.com/advanced-search",
        searchUrl: null,
        canValidate: false,
      },
      {
        id: "wos",
        name: "Web of Science",
        description: "Clarivate 的多學科引文索引資料庫（Core Collection 進階檢索）",
        url: "https://www.webofscience.com/",
        searchUrl: null,
        canValidate: false,
        note: "需機構訂閱",
      },
      {
        id: "scopus",
        name: "Scopus",
        description: "Elsevier 的大型摘要和引文資料庫（進階檢索）",
        url: "https://www.scopus.com/",
        searchUrl: null,
        canValidate: false,
        note: "需機構訂閱",
      },
    ];
  }
}

export default QueryTranslator;
