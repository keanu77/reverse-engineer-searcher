/**
 * Strict PMID parsing. Other identifiers (PMCID, DOI) are rejected with a reason
 * instead of having their digits stripped out, which would name a different article.
 */

const PATTERNS = [
  /^(\d{1,9})$/,
  /^PMID\s*:?\s*(\d{1,9})$/i,
  /^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})\/?(?:[?#].*)?$/i,
  /^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/(\d{1,9})\/?(?:[?#].*)?$/i,
];

function reasonFor(value) {
  if (/^PMC\d+$/i.test(value)) return "這是 PMC 編號（PMCID），不是 PMID";
  if (/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\//i.test(value)) return "這是 DOI，不是 PMID";
  return "不是有效的 PMID（只接受數字、PMID: 數字或 PubMed 網址）";
}

/**
 * @param {unknown[]} values
 * @returns {{pmids: string[], rejected: {input: string, reason: string}[], duplicates: number}}
 */
export function parsePmidList(values) {
  const pmids = [];
  const rejected = [];
  let duplicates = 0;
  for (const raw of Array.isArray(values) ? values : []) {
    const input = String(raw ?? "").trim();
    if (!input) continue;
    const match = PATTERNS.map((pattern) => input.match(pattern)).find(Boolean);
    if (!match) {
      rejected.push({ input: input.slice(0, 60), reason: reasonFor(input) });
      continue;
    }
    const pmid = String(Number(match[1]));
    if (pmid === "0") {
      rejected.push({ input, reason: "PMID 不能是 0" });
    } else if (pmids.includes(pmid)) {
      duplicates++;
    } else {
      pmids.push(pmid);
    }
  }
  return { pmids, rejected, duplicates };
}
