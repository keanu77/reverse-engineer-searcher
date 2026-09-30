/**
 * PubMed query parser and linter.
 * Produces a boolean tree evaluated left to right (PubMed's rule), so other
 * databases can be rendered with explicit parentheses.
 *
 * Term node: { type: 'term', text, quoted, field, ...modifiers }
 *   field: mesh | tiab | ti | tw | pt | subheading | proximity | untagged | unsupported
 * Operator node: { type: 'op', op: 'AND' | 'OR' | 'NOT', left, right }
 */

const OPERATORS = new Set(["AND", "OR", "NOT"]);

const FIELD_ALIASES = {
  mesh: { field: "mesh" },
  mh: { field: "mesh" },
  "mesh terms": { field: "mesh" },
  "mesh:noexp": { field: "mesh", noexp: true },
  "mh:noexp": { field: "mesh", noexp: true },
  "mesh terms:noexp": { field: "mesh", noexp: true },
  majr: { field: "mesh", major: true },
  "mesh major topic": { field: "mesh", major: true },
  "majr:noexp": { field: "mesh", major: true, noexp: true },
  tiab: { field: "tiab" },
  "title/abstract": { field: "tiab" },
  ti: { field: "ti" },
  title: { field: "ti" },
  tw: { field: "tw" },
  "text word": { field: "tw" },
  pt: { field: "pt" },
  "publication type": { field: "pt" },
  sh: { field: "subheading" },
  subheading: { field: "subheading" },
};

const IDENTIFIER_FIELDS = new Set(["pmid", "uid", "pmcid", "doi", "aid", "lid"]);

export class QuerySyntaxError extends Error {}

function normaliseField(rawField) {
  const key = rawField.trim().toLowerCase();
  const proximity = key.match(/^(tiab|ti|ad|title\/abstract|title):~(\d+)$/);
  if (proximity) {
    const base = FIELD_ALIASES[proximity[1]].field;
    return { field: "proximity", proximityField: base, distance: Number(proximity[2]) };
  }
  return FIELD_ALIASES[key] || { field: "unsupported", rawField: rawField.trim() };
}

function tokenize(query) {
  const tokens = [];
  let i = 0;
  const readTag = () => {
    let j = i;
    while (j < query.length && /\s/.test(query[j])) j++;
    if (query[j] !== "[") return null;
    const close = query.indexOf("]", j);
    if (close === -1) throw new QuerySyntaxError("欄位標籤缺少右方括號 ]");
    i = close + 1;
    return query.slice(j + 1, close);
  };

  while (i < query.length) {
    const ch = query[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(" || ch === ")") { tokens.push({ kind: ch }); i++; continue; }
    if (ch === "[") throw new QuerySyntaxError("欄位標籤前面缺少檢索詞");
    if (ch === '"') {
      const close = query.indexOf('"', i + 1);
      if (close === -1) throw new QuerySyntaxError("引號沒有成對");
      const text = query.slice(i + 1, close).trim();
      i = close + 1;
      tokens.push({ kind: "word", text, quoted: true, tag: readTag() });
      continue;
    }
    let j = i;
    while (j < query.length && !/[\s()"[]/.test(query[j])) j++;
    const word = query.slice(i, j);
    i = j;
    if (OPERATORS.has(word)) { tokens.push({ kind: "op", op: word }); continue; }
    const tagDirect = query[i] === "[" ? readTag() : null;
    tokens.push({ kind: "word", text: word, quoted: false, tag: tagDirect });
  }
  return tokens;
}

function makeTerm(words) {
  const last = words[words.length - 1];
  const text = words.map((w) => w.text).join(" ");
  const quoted = words.length === 1 && last.quoted;
  if (!last.tag) return { type: "term", text, quoted, field: "untagged" };
  const field = normaliseField(last.tag);
  if (field.field === "mesh") {
    const [descriptor, qualifier] = text.split("/");
    return { type: "term", text: descriptor.trim(), quoted, ...field, ...(qualifier ? { qualifier: qualifier.trim() } : {}) };
  }
  return { type: "term", text, quoted, ...field };
}

export function parsePubmedQuery(query) {
  if (typeof query !== "string" || !query.trim()) throw new QuerySyntaxError("檢索式是空的");
  const tokens = tokenize(query);
  let pos = 0;

  const parsePrimary = () => {
    const token = tokens[pos];
    if (!token) throw new QuerySyntaxError("檢索式在運算子後面結束");
    if (token.kind === "(") {
      pos++;
      const inner = parseExpression();
      if (tokens[pos]?.kind !== ")") throw new QuerySyntaxError("括號沒有成對");
      pos++;
      return inner;
    }
    if (token.kind !== "word") throw new QuerySyntaxError(`此處不能出現「${token.op || token.kind}」`);
    // Consecutive untagged bare words up to (and including) the first tagged word form one phrase.
    const words = [];
    while (tokens[pos]?.kind === "word") {
      const word = tokens[pos];
      if (words.length && word.quoted) break;
      words.push(word);
      pos++;
      if (word.tag || word.quoted) break;
    }
    return makeTerm(words);
  };

  const parseExpression = () => {
    let left = parsePrimary();
    while (pos < tokens.length && tokens[pos].kind !== ")") {
      let op = "AND"; // Adjacent terms without an operator are ANDed by PubMed.
      if (tokens[pos].kind === "op") { op = tokens[pos].op; pos++; }
      left = { type: "op", op, left, right: parsePrimary() };
    }
    return left;
  };

  const tree = parseExpression();
  if (pos !== tokens.length) throw new QuerySyntaxError("括號沒有成對");
  return tree;
}

export function walkTerms(node, visit) {
  if (node.type === "term") visit(node);
  else { walkTerms(node.left, visit); walkTerms(node.right, visit); }
}

/**
 * Checks a generated PubMed query before it is validated or translated.
 * errors: the query must not be used; warnings: usable but worth a look.
 */
export function lintPubmedQuery(query) {
  const errors = [];
  const warnings = [];
  let tree = null;
  try {
    tree = parsePubmedQuery(query);
  } catch (error) {
    return { errors: [error instanceof QuerySyntaxError ? `語法錯誤：${error.message}` : "無法解析檢索式"], warnings, tree };
  }

  if (/\b(and|or|not)\b/.test(query.replace(/"[^"]*"/g, ""))) {
    warnings.push("布林運算子須為大寫（AND／OR／NOT），小寫會被當成一般字");
  }
  walkTerms(tree, (term) => {
    const raw = (term.rawField || "").toLowerCase();
    if (IDENTIFIER_FIELDS.has(raw)) errors.push(`檢索式不可直接指定 PMID 或其他識別碼（${term.text}[${term.rawField}]）`);
    else if (term.field === "unsupported") warnings.push(`欄位 [${term.rawField}] 無法翻譯到其他資料庫`);
    if (term.quoted && term.text.includes("*")) warnings.push(`引號內的截字不會生效：「${term.text}」`);
    if (/\*/.test(term.text) && /(^|\s)\w{1,3}\*/.test(term.text)) warnings.push(`截字字首少於 4 個字元：「${term.text}」`);
  });
  return { errors, warnings, tree };
}
