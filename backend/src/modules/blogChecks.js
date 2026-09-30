/**
 * Post-generation checks for the health-education article.
 * The model is instructed not to fabricate; these checks verify what can be verified mechanically.
 */

export const DISCLAIMER =
  "> 本文僅供衛教參考，內容依據所列文獻摘要整理，無法取代醫師診察、超音波或 MRI 等影像檢查。症狀持續或惡化請就醫。";

// Absolute efficacy claims (Taiwan Medical Care Act §85 and general accuracy).
const ABSOLUTE_CLAIMS = [
  "保證", "根治", "治癒", "痊癒", "完全預防", "百分之百", "100%", "無副作用", "沒有副作用",
  "絕對有效", "一定有效", "最有效", "特效", "神效", "立即見效",
];

/** PMIDs cited in the text as "PMID 123", "PMID: 123" or "[PMID:123]". */
export function citedPmids(text) {
  return [...new Set([...text.matchAll(/PMID\s*[:：]?\s*(\d{1,9})/gi)].map((m) => m[1]))];
}

/** Numbers with a decimal point or percent sign — the kind that are easy to invent. */
function statisticalNumbers(text) {
  return [...new Set([...text.matchAll(/\d+(?:\.\d+)?\s*%|\d+\.\d+/g)].map((m) => m[0].replace(/\s+/g, "")))];
}

/**
 * @param {string} article
 * @param {{pmid: string, title?: string, abstract?: string}[]} sources
 * @returns {{warnings: string[], citedPmids: string[]}}
 */
export function checkBlogArticle(article, sources) {
  const warnings = [];
  const sourcePmids = new Set(sources.map((s) => String(s.pmid)));
  const cited = citedPmids(article);

  const unknown = cited.filter((pmid) => !sourcePmids.has(pmid));
  if (unknown.length) warnings.push(`文中引用了不在來源清單中的 PMID：${unknown.join(", ")}，請刪除或更正`);
  if (!cited.length) warnings.push("文中沒有標示任何 PMID 引用，無法對應各段內容的來源");

  const sourceText = sources.map((s) => `${s.title || ""} ${s.abstract || ""}`).join(" ").replace(/\s+/g, "");
  const unsupported = statisticalNumbers(article).filter((n) => !sourceText.includes(n));
  if (unsupported.length) {
    warnings.push(`以下數字在來源摘要中找不到，可能為模型編造，請逐一核對：${unsupported.slice(0, 10).join("、")}`);
  }

  const claims = ABSOLUTE_CLAIMS.filter((word) => article.includes(word));
  if (claims.length) warnings.push(`含絕對化或療效保證用語：${claims.join("、")}，發布前請改寫`);

  return { warnings, citedPmids: cited };
}
