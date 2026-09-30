import { logFailure } from './SafeLogging.js';
import { completionText, extractJsonObject, normaliseRole, normaliseTermKey } from './llmOutput.js';
/**
 * TermClassifier - 使用 LLM 將 terms 分類為 PICO 角色
 */

class TermClassifier {
  constructor(llmClient) {
    this.llmClient = llmClient;
  }

  /**
   * 將 terms 分類為 P/I/O/D
   */
  async classifyTerms(terms, articles) {
    const articleSummaries = articles.map(a =>
      `PMID ${a.pmid}: ${a.title}`
    ).join('\n');

    const termList = terms.map(t =>
      `- ${t.term} (source: ${t.source}, frequency: ${t.doc_freq}/${articles.length})`
    ).join('\n');

    const systemPrompt = `You are an expert in systematic review methodology and information retrieval for medical/scientific literature.
Your task is to classify terms according to the PICO framework for building a systematic review search strategy.

## Classification Categories

- **P (Population)**: Patient population, disease, condition, demographic characteristics, anatomical sites
  Examples: "Diabetes Mellitus", "Elderly", "Children", "Knee Osteoarthritis", "Heart Failure"

- **I (Intervention/Exposure)**: Treatments, interventions, therapies, exposures, diagnostic tests, drugs
  Examples: "Physical Therapy", "Metformin", "Surgery", "Vaccination", "Exercise"
  Note: MeSH terms ending in /therapy, /drug therapy, /surgery typically indicate Intervention

- **O (Outcome)**: Clinical outcomes, endpoints, measurements, effects, adverse events
  Examples: "Mortality", "Quality of Life", "Pain", "Recovery", "Blood Pressure"

- **D (Design)**: Study design, methodology, publication type
  Examples: "Randomized Controlled Trial", "Meta-Analysis", "Cohort Study", "Systematic Review"

- **Other**: Generic terms, modifiers, or terms that don't clearly fit PICO
  Examples: "Humans", "Male", "Female", "Treatment Outcome" (too generic)

## Classification Guidelines

1. Consider the CONTEXT of the research topic from the article titles
2. Higher frequency terms (appearing in multiple articles) are usually more relevant
3. When a term could fit multiple categories, choose the PRIMARY role
4. Be conservative - if uncertain, classify as "Other"
5. MeSH major topics are more important than other terms`;

    const userPrompt = `Based on these gold standard articles for a systematic review:

${articleSummaries}

Please classify each of the following terms into P, I, O, D, or Other:

${termList}

Respond in JSON format only. Include confidence level (high/medium/low):
{
  "classifications": [
    {"term": "term name", "role": "P|I|O|D|Other", "confidence": "high|medium|low", "reasoning": "brief explanation"}
  ]
}`;

    try {
      const requestOptions = {
        model: this.llmClient.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0
      };

      // 只有支援 JSON mode 的 provider 才加上
      if (this.llmClient.supportsJsonMode) {
        requestOptions.response_format = { type: 'json_object' };
      }

      const response = await this.llmClient.client.chat.completions.create(requestOptions);
      const result = extractJsonObject(completionText(response));
      if (!Array.isArray(result.classifications)) throw new Error('classifications 不是陣列');
      const roles = new Map();
      for (const item of result.classifications) {
        const role = normaliseRole(item?.role);
        if (typeof item?.term === 'string' && role) roles.set(normaliseTermKey(item.term), role);
      }
      return applyRoles(terms, roles, 'llm');
    } catch (error) {
      logFailure('Error classifying terms:', error);
      return this._classifyTermsFallback(terms, articles);
    }
  }

  /**
   * 備用分類方法：每行「term | role」
   */
  async _classifyTermsFallback(terms, articles) {
    const articleSummaries = articles.map(a => `PMID ${a.pmid}: ${a.title}`).join('\n');
    const termList = terms.map(t => `- ${t.term}`).join('\n');

    const prompt = `Based on these systematic review articles:
${articleSummaries}

Classify each term as P (Population), I (Intervention), O (Outcome), D (Design), or Other.
Format each line as: term | role

Terms to classify:
${termList}`;

    try {
      const response = await this.llmClient.client.chat.completions.create({
        model: this.llmClient.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      });

      const roles = new Map();
      for (const line of completionText(response).split('\n')) {
        const parts = line.replace(/^\s*[-*]?\s*\|?|\|\s*$/g, '').split('|').map(s => s.trim()).filter(Boolean);
        const role = parts.length >= 2 ? normaliseRole(parts[1]) : null;
        if (role) roles.set(normaliseTermKey(parts[0]), role);
      }
      return applyRoles(terms, roles, 'fallback');
    } catch (error) {
      logFailure('Fallback classification also failed:', error);
      return terms.map(t => ({ ...t, suggested_role: 'Other', classification_status: 'failed' }));
    }
  }
}

/** Attach roles; terms the model did not return stay "Other" and are marked unclassified. */
function applyRoles(terms, roles, source) {
  return terms.map(t => {
    const role = roles.get(normaliseTermKey(t.term));
    return role
      ? { ...t, suggested_role: role, classification_status: 'classified', classification_source: source }
      : { ...t, suggested_role: 'Other', classification_status: 'unclassified', classification_source: source };
  });
}

export { TermClassifier };
export default TermClassifier;
