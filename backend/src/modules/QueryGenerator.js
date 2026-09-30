import { logFailure } from './SafeLogging.js';
import { completionText, extractJsonObject } from './llmOutput.js';
import { lintPubmedQuery } from './pubmedQuery.js';

/**
 * QueryGenerator - 使用 LLM 生成三種版本的 PubMed 搜尋式
 * 產出一律經過格式與語法檢查；不合格的策略會帶 lint_errors，由路由決定是否使用。
 */

const STRATEGIES = [
  { id: 'sensitive', label: 'Sensitive Version', description: 'Maximum recall with broad terms' },
  { id: 'balanced', label: 'Balanced Version', description: 'Balance between precision and recall' },
  { id: 'compact', label: 'Compact Version', description: 'High precision with specific terms' },
];

const ROLE_LABELS = { P: 'Population', I: 'Intervention/Exposure', O: 'Outcome', D: 'Study Design' };

const SYSTEM_PROMPT = `You are an information specialist building PubMed search strategies for systematic reviews.
Build Boolean queries from the supplied controlled vocabulary and free-text terms.

## PubMed syntax (follow exactly)
- MeSH: "Heading Name"[Mesh] (quote multi-word headings). Use [Mesh:NoExp] only when narrower terms must be excluded.
- Free text: word[tiab] or "exact phrase"[tiab].
- Truncation: only at the end of a single unquoted word with at least 4 letters before *, e.g. therap*[tiab]. Never inside quotes.
- Publication type: "randomized controlled trial"[pt].
- Boolean operators in UPPERCASE: AND, OR, NOT. PubMed evaluates left to right, so wrap every concept block in parentheses.
- Never use PMID, DOI, journal, author or date fields to force retrieval of the example articles.

## Method
- Each concept block combines its MeSH heading(s) OR free-text synonyms (MeSH alone misses records not yet indexed).
- Combine concept blocks with AND. Population AND Intervention at minimum.
- A study-design block is optional; if used, pair [pt] with free-text design words, because [pt] misses unindexed records.
- SENSITIVE: most synonyms and truncation. BALANCED: core headings plus key free text. COMPACT: fewest, most specific terms.`;

function buildUserPrompt(groupedTerms, articles, maxTermsPerBlock) {
  const articleInfo = articles.map(a => {
    const types = (a.publication_types || []).join('; ');
    return `PMID ${a.pmid}: "${a.title}" (${a.journal}, ${a.year})${types ? ` [${types}]` : ''}`;
  }).join('\n');

  const termsInfo = Object.entries(groupedTerms)
    .filter(([role, terms]) => terms.length > 0 && ROLE_LABELS[role])
    .map(([role, terms]) => {
      const termList = terms.slice(0, maxTermsPerBlock * 2)
        .map(t => `  - ${t.term} (${t.source}, in ${t.doc_freq} of ${articles.length} articles)`)
        .join('\n');
      return `${ROLE_LABELS[role]} (${role}):\n${termList}`;
    }).join('\n\n');

  return `Example articles the strategies should retrieve (do not reference them by identifier):
${articleInfo}

Classified terms:
${termsInfo}

Respond with JSON only:
{"queries": [
  {"id": "sensitive", "label": "Sensitive Version", "query_string": "...", "description": "...", "blocks_used": ["P", "I"]},
  {"id": "balanced", "label": "Balanced Version", "query_string": "...", "description": "...", "blocks_used": ["P", "I"]},
  {"id": "compact", "label": "Compact Version", "query_string": "...", "description": "...", "blocks_used": ["P", "I"]}
]}`;
}

/** Keep one valid entry per strategy id and attach lint results. */
function normaliseQueries(rawQueries) {
  const byId = new Map();
  for (const item of Array.isArray(rawQueries) ? rawQueries : []) {
    const id = String(item?.id || '').toLowerCase();
    const query = typeof item?.query_string === 'string' ? item.query_string.trim() : '';
    if (!query || byId.has(id) || !STRATEGIES.some(s => s.id === id)) continue;
    byId.set(id, { ...item, query_string: query });
  }
  return STRATEGIES.filter(s => byId.has(s.id)).map(s => {
    const item = byId.get(s.id);
    const lint = lintPubmedQuery(item.query_string);
    return {
      id: s.id,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : s.label,
      description: typeof item.description === 'string' ? item.description : s.description,
      blocks_used: Array.isArray(item.blocks_used) ? item.blocks_used.filter(b => typeof b === 'string') : [],
      query_string: item.query_string,
      lint_errors: lint.errors,
      lint_warnings: lint.warnings,
    };
  });
}

/** Fallback format: "SENSITIVE:" / "BALANCED:" / "COMPACT:" headings, possibly with markdown. */
function parseSectionedQueries(text) {
  const header = /^[\s>#*_\d.)-]*(SENSITIVE|BALANCED|COMPACT)\b[\s*_]*:?[\s*_]*(.*)$/i;
  const sections = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const match = line.match(header);
    if (match) {
      current = match[1].toLowerCase();
      sections.set(current, match[2].trim() ? [match[2].trim()] : []);
    } else if (current) {
      sections.get(current).push(line.trim());
    }
  }
  // The query is the first non-empty, non-fence line that contains a field tag.
  return [...sections].map(([id, lines]) => ({
    id,
    query_string: lines.find(l => l && !l.startsWith('```') && /\[[^\]]+\]/.test(l)) || '',
  }));
}

class QueryGenerator {
  constructor(llmClient) {
    this.llmClient = llmClient;
  }

  /**
   * 生成三種版本的 PubMed 搜尋式
   */
  async generateSearchQueries(groupedTerms, articles, options = {}) {
    const maxTermsPerBlock = Number.isInteger(options.maxTermsPerBlock) && options.maxTermsPerBlock > 0
      ? options.maxTermsPerBlock : 10;

    try {
      const requestOptions = {
        model: this.llmClient.strongModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(groupedTerms, articles, maxTermsPerBlock) }
        ],
        temperature: 0.2
      };
      if (this.llmClient.supportsJsonMode) {
        requestOptions.response_format = { type: 'json_object' };
      }

      const response = await this.llmClient.client.chat.completions.create(requestOptions);
      const queries = normaliseQueries(extractJsonObject(completionText(response)).queries);
      if (queries.length === STRATEGIES.length) return queries;
      throw new Error(`模型只回傳 ${queries.length} 條有效檢索式`);
    } catch (error) {
      logFailure('Error generating search queries:', error);
      return this._generateQueriesFallback(groupedTerms, articles, maxTermsPerBlock);
    }
  }

  /**
   * 備用搜尋式生成方法
   */
  async _generateQueriesFallback(groupedTerms, articles, maxTermsPerBlock) {
    const termsInfo = Object.entries(groupedTerms)
      .filter(([role, terms]) => terms.length > 0 && ROLE_LABELS[role])
      .map(([role, terms]) => `${role}: ${terms.slice(0, maxTermsPerBlock).map(t => t.term).join(', ')}`)
      .join('\n');

    const prompt = `${SYSTEM_PROMPT}

Articles:
${articles.map(a => `- "${a.title}"`).join('\n')}

Terms by PICO category:
${termsInfo}

Write exactly three lines and nothing else:
SENSITIVE: <PubMed query>
BALANCED: <PubMed query>
COMPACT: <PubMed query>`;

    try {
      const response = await this.llmClient.client.chat.completions.create({
        model: this.llmClient.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      });
      return normaliseQueries(parseSectionedQueries(completionText(response)));
    } catch (error) {
      logFailure('Fallback query generation also failed:', error);
      throw new Error('無法產生檢索式，請稍後再試或更換模型');
    }
  }
}

export { QueryGenerator };
export default QueryGenerator;
