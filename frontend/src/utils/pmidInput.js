/**
 * PMID parsing shared by the input boxes; mirrors backend/src/modules/pmidInput.js.
 * PMCIDs and DOIs are rejected with a reason rather than having their digits stripped,
 * which would silently select a different article.
 */
const PATTERNS = [
  /^(\d{1,9})$/,
  /^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})\/?(?:[?#].*)?$/i,
  /^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/(\d{1,9})\/?(?:[?#].*)?$/i,
];

function reasonFor(value) {
  if (/^PMC\d+$/i.test(value)) return "PMC 編號（PMCID）不是 PMID";
  if (/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(value)) return "DOI 不是 PMID";
  return "無法辨識";
}

/** @returns {{pmids: string[], rejected: {input: string, reason: string}[], duplicates: number}} */
export function parsePmidText(text) {
  const tokens = String(text || "")
    .replace(/PMID\s*[:：]?\s*/gi, "")
    .split(/[\s,;，；、]+/)
    .filter(Boolean);
  const pmids = [];
  const rejected = [];
  let duplicates = 0;
  for (const token of tokens) {
    const match = PATTERNS.map((p) => token.match(p)).find(Boolean);
    if (!match || Number(match[1]) === 0) {
      rejected.push({ input: token, reason: reasonFor(token) });
    } else {
      const pmid = String(Number(match[1]));
      if (pmids.includes(pmid)) duplicates++;
      else pmids.push(pmid);
    }
  }
  return { pmids, rejected, duplicates };
}
