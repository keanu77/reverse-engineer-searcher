/**
 * QueryGenerator - 使用 LLM 生成三種版本的 PubMed 搜尋式
 */

class QueryGenerator {
  constructor(llmClient) {
    this.llmClient = llmClient;
  }

  /**
   * 生成三種版本的 PubMed 搜尋式
   */
  async generateSearchQueries(groupedTerms, articles, options = {}) {
    const { maxTermsPerBlock = 10 } = options;

    const articleInfo = articles.map(a =>
      `PMID ${a.pmid}: "${a.title}" (${a.journal}, ${a.year})`
    ).join('\n');

    const termsInfo = Object.entries(groupedTerms)
      .filter(([role, terms]) => terms.length > 0 && role !== 'Other')
      .map(([role, terms]) => {
        const roleLabel = {
          P: 'Population',
          I: 'Intervention/Exposure',
          O: 'Outcome',
          D: 'Study Design'
        }[role];
        const termList = terms.slice(0, maxTermsPerBlock * 2)
          .map(t => `  - ${t.term} (${t.source}, freq: ${t.doc_freq})`)
          .join('\n');
        return `${roleLabel} (${role}):\n${termList}`;
      }).join('\n\n');

    const systemPrompt = `You are an expert in systematic review search strategy development for PubMed.
Your task is to create Boolean search queries that will retrieve all the gold standard articles while minimizing irrelevant results.

## PubMed Search Syntax Rules (MUST follow exactly)

1. **MeSH terms**: "Term Name"[Mesh] - use exact MeSH heading with quotes if multi-word
2. **Title/Abstract**: term[tiab] or "phrase"[tiab] - for free-text searching
3. **Publication type**: "randomized controlled trial"[pt]
4. **Truncation**: therap*[tiab] - only at word END, not with MeSH
5. **Boolean operators**: AND, OR, NOT - MUST be UPPERCASE
6. **Grouping**: Use parentheses - (term1[tiab] OR term2[tiab]) AND term3[Mesh]
7. **Phrase search**: "exact phrase"[tiab] - quotes for multi-word phrases

## CRITICAL Syntax Rules
- Every search block MUST be enclosed in parentheses
- Boolean operators MUST be UPPERCASE
- Field tags MUST be lowercase: [Mesh], [tiab], [pt]
- NO spaces between term and field tag: term[tiab] NOT term [tiab]
- Multi-word MeSH terms need quotes: "Heart Failure"[Mesh]

## Strategy Guidelines
1. **SENSITIVE**: Maximum recall - many OR terms, synonyms, truncation, broader MeSH terms
2. **BALANCED**: Core MeSH terms + key free-text terms, good precision/recall balance
3. **COMPACT**: Minimal essential terms, high specificity, focused search`;

    const userPrompt = `Create 3 PubMed search strategies to retrieve these gold standard articles:

${articleInfo}

Available classified terms:

${termsInfo}

Generate three search query versions:

1. SENSITIVE: Maximum recall - use many synonyms, broader terms, and truncation
2. BALANCED: Good balance - use core MeSH terms plus key free-text terms
3. COMPACT: High precision - only essential specific terms

Requirements:
- Each query MUST include Population AND Intervention blocks at minimum
- Include Study Design filter if relevant terms exist
- Queries must be valid PubMed syntax
- Aim to capture ALL gold standard PMIDs

Respond in JSON format only:
{
  "queries": [
    {
      "id": "sensitive",
      "label": "Sensitive Version",
      "query_string": "the actual PubMed query",
      "description": "Brief explanation of this strategy",
      "blocks_used": ["P", "I", "D"]
    },
    {
      "id": "balanced",
      "label": "Balanced Version",
      "query_string": "...",
      "description": "...",
      "blocks_used": ["P", "I"]
    },
    {
      "id": "compact",
      "label": "Compact Version",
      "query_string": "...",
      "description": "...",
      "blocks_used": ["P", "I"]
    }
  ]
}`;

    try {
      const requestOptions = {
        model: this.llmClient.strongModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5
      };

      if (this.llmClient.supportsJsonMode) {
        requestOptions.response_format = { type: 'json_object' };
      }

      const response = await this.llmClient.client.chat.completions.create(requestOptions);
      const content = response.choices[0].message.content;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const result = JSON.parse(jsonMatch[0]);
      return result.queries || [];
    } catch (error) {
      console.error('Error generating search queries:', error.message);
      return this._generateQueriesFallback(groupedTerms, articles, options);
    }
  }

  /**
   * 備用搜尋式生成方法
   */
  async _generateQueriesFallback(groupedTerms, articles, options) {
    const { maxTermsPerBlock = 10 } = options;

    const articleInfo = articles.map(a => `PMID ${a.pmid}: "${a.title}"`).join('\n');

    const termsInfo = Object.entries(groupedTerms)
      .filter(([role, terms]) => terms.length > 0 && role !== 'Other')
      .map(([role, terms]) => {
        const termList = terms.slice(0, maxTermsPerBlock)
          .map(t => t.term).join(', ');
        return `${role}: ${termList}`;
      }).join('\n');

    const prompt = `Create 3 PubMed search strategies for these articles:
${articleInfo}

Available terms by PICO category:
${termsInfo}

Generate exactly 3 queries in this format:

SENSITIVE:
[query here]

BALANCED:
[query here]

COMPACT:
[query here]

Use proper PubMed syntax with [Mesh], [tiab], AND, OR operators.`;

    try {
      const response = await this.llmClient.client.chat.completions.create({
        model: this.llmClient.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5
      });

      const content = response.choices[0].message.content;
      const queries = [];

      const sections = content.split(/\n(?=SENSITIVE:|BALANCED:|COMPACT:)/i);
      for (const section of sections) {
        if (section.toLowerCase().includes('sensitive')) {
          queries.push({
            id: 'sensitive',
            label: 'Sensitive Version',
            query_string: this._extractQuery(section),
            description: 'Maximum recall with broad terms'
          });
        } else if (section.toLowerCase().includes('balanced')) {
          queries.push({
            id: 'balanced',
            label: 'Balanced Version',
            query_string: this._extractQuery(section),
            description: 'Balance between precision and recall'
          });
        } else if (section.toLowerCase().includes('compact')) {
          queries.push({
            id: 'compact',
            label: 'Compact Version',
            query_string: this._extractQuery(section),
            description: 'High precision with specific terms'
          });
        }
      }

      return queries;
    } catch (error) {
      console.error('Fallback query generation also failed:', error.message);
      throw new Error(`Failed to generate search queries: ${error.message}`);
    }
  }

  _extractQuery(text) {
    const lines = text.split('\n')
      .filter(l => l.trim() && !l.match(/^(SENSITIVE|BALANCED|COMPACT):/i))
      .join(' ')
      .trim();
    return lines;
  }

  /**
   * 優化搜尋式
   */
  async optimizeQuery(query, missingPmids, articles) {
    const missingArticles = articles.filter(a => missingPmids.includes(a.pmid));

    const missingInfo = missingArticles.map(a => {
      const terms = [
        ...a.mesh_major.map(t => `MeSH-major: ${t}`),
        ...a.mesh_all.slice(0, 10).map(t => `MeSH: ${t}`),
        ...a.keywords.map(t => `Keyword: ${t}`)
      ].join('\n  ');
      return `PMID ${a.pmid}: "${a.title}"\n  ${terms}`;
    }).join('\n\n');

    const prompt = `The following PubMed search query does not capture all gold standard articles:

Current query:
${query.query_string}

Missing articles and their terms:
${missingInfo}

Please modify the query to include these articles by adding appropriate terms using OR operators.
Focus on terms unique to the missing articles.

Return only the modified query string, nothing else.`;

    try {
      const response = await this.llmClient.client.chat.completions.create({
        model: this.llmClient.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      });

      const optimizedQuery = response.choices[0].message.content.trim();

      return {
        ...query,
        query_string: optimizedQuery,
        optimization_note: 'Query optimized to include missing articles'
      };
    } catch (error) {
      console.error('Error optimizing query:', error.message);
      return query;
    }
  }
}

export { QueryGenerator };
export default QueryGenerator;
