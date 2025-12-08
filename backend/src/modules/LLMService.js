import OpenAI from 'openai';

/**
 * LLMService - 使用 LLM 進行 term 分類與搜尋式生成
 * 支援：Groq (免費), OpenAI, Grok (xAI), Gemini, Ollama, 或任何 OpenAI 相容 API
 */

// 預設的 provider 設定
const PROVIDER_CONFIGS = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    strongModel: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY'
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    strongModel: 'gpt-4o',
    envKey: 'OPENAI_API_KEY'
  },
  grok: {
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-beta',
    strongModel: 'grok-beta',
    envKey: 'XAI_API_KEY'
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    strongModel: 'gemini-2.0-flash',
    envKey: 'GEMINI_API_KEY'
  },
  ollama: {
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    strongModel: 'llama3.2',
    envKey: null
  },
  custom: {
    baseURL: null,
    defaultModel: null,
    strongModel: null,
    envKey: 'CUSTOM_API_KEY'
  }
};

class LLMService {
  constructor(options = {}) {
    const provider = (options.provider || process.env.LLM_PROVIDER || 'groq').toLowerCase();

    // 取得 provider 設定
    const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.custom;

    // 決定 API key
    let apiKey = options.apiKey;
    if (!apiKey && config.envKey) {
      apiKey = process.env[config.envKey];
    }
    // 對於 Groq，也檢查舊的環境變數名稱
    if (!apiKey && provider === 'groq') {
      apiKey = process.env.GROQ_API_KEY;
    }

    // 決定 baseURL
    const baseURL = options.baseURL || config.baseURL;

    // 建立 OpenAI 相容客戶端
    this.client = new OpenAI({
      apiKey: apiKey || 'dummy-key',
      baseURL: baseURL
    });

    // 設定模型
    this.model = options.model || config.defaultModel;
    this.strongModel = options.strongModel || config.strongModel || this.model;

    this.provider = provider;
    this.supportsJsonMode = ['openai', 'groq', 'gemini'].includes(provider);

    console.log(`LLMService initialized: provider=${provider}, model=${this.model}, baseURL=${baseURL}`);
  }

  /**
   * 取得支援的 providers 列表
   */
  static getProviders() {
    return Object.keys(PROVIDER_CONFIGS).map(key => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      ...PROVIDER_CONFIGS[key]
    }));
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
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      };

      // 只有支援 JSON mode 的 provider 才加上
      if (this.supportsJsonMode) {
        requestOptions.response_format = { type: 'json_object' };
      }

      const response = await this.client.chat.completions.create(requestOptions);
      const content = response.choices[0].message.content;

      // 嘗試解析 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const result = JSON.parse(jsonMatch[0]);
      const classificationMap = new Map(
        result.classifications.map(c => [c.term.toLowerCase(), c.role])
      );

      return terms.map(t => ({
        ...t,
        suggested_role: classificationMap.get(t.term.toLowerCase()) || 'Other'
      }));
    } catch (error) {
      console.error('Error classifying terms:', error.message);
      return this._classifyTermsFallback(terms, articles);
    }
  }

  /**
   * 備用分類方法
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
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      });

      const content = response.choices[0].message.content;
      const lines = content.split('\n').filter(l => l.includes('|'));

      const classificationMap = new Map();
      for (const line of lines) {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length >= 2) {
          const term = parts[0].replace(/^-\s*/, '').toLowerCase();
          const role = parts[1].toUpperCase().charAt(0);
          if (['P', 'I', 'O', 'D'].includes(role)) {
            classificationMap.set(term, role);
          }
        }
      }

      return terms.map(t => ({
        ...t,
        suggested_role: classificationMap.get(t.term.toLowerCase()) || 'Other'
      }));
    } catch (error) {
      console.error('Fallback classification also failed:', error.message);
      return terms.map(t => ({ ...t, suggested_role: 'Other' }));
    }
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
        model: this.strongModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5
      };

      if (this.supportsJsonMode) {
        requestOptions.response_format = { type: 'json_object' };
      }

      const response = await this.client.chat.completions.create(requestOptions);
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
      const response = await this.client.chat.completions.create({
        model: this.model,
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
   * 生成科普部落格文章
   * @param {Array} primaryArticles - 主要文章（用戶提供的 PMID）
   * @param {Array} supportingArticles - 輔助文章（搜尋到的相關文章）
   * @param {string} topic - 研究主題
   * @param {Object} options - 選項
   * @returns {Object} 生成的文章
   */
  async generateBlogArticle(primaryArticles, supportingArticles, topic, options = {}) {
    const {
      wordCount = '2000-2500',
      language = 'zh-TW',
      tone = 'educational' // educational, professional, casual
    } = options;

    // 準備主要文章摘要（詳細）
    const primarySummaries = primaryArticles.map((a, i) => {
      let summary = `【主要文獻 ${i + 1}】PMID: ${a.pmid}\n   標題: "${a.title}"`;
      if (a.journal) summary += `\n   期刊: ${a.journal}`;
      if (a.year) summary += ` (${a.year})`;
      if (a.abstract) {
        // 主要文章取完整摘要（最多500字）
        const abstractPreview = a.abstract.substring(0, 500);
        summary += `\n   摘要: ${abstractPreview}${a.abstract.length > 500 ? '...' : ''}`;
      }
      return summary;
    }).join('\n\n');

    // 準備輔助文章摘要（簡要）
    const supportingSummaries = supportingArticles.map((a, i) => {
      let summary = `【輔助文獻 ${i + 1}】PMID: ${a.pmid}\n   標題: "${a.title}"`;
      if (a.journal) summary += `\n   期刊: ${a.journal}`;
      if (a.year) summary += ` (${a.year})`;
      if (a.abstract) {
        // 輔助文章取摘要前250字
        const abstractPreview = a.abstract.substring(0, 250);
        summary += `\n   摘要: ${abstractPreview}${a.abstract.length > 250 ? '...' : ''}`;
      }
      return summary;
    }).join('\n\n');

    const totalArticles = primaryArticles.length + supportingArticles.length;

    const systemPrompt = `你是一位專業的醫學科普作家，擅長將複雜的醫學研究轉化為一般大眾能理解的文章。

## 最重要原則：禁止幻覺與虛構

**嚴格禁止任何形式的虛構或幻覺內容：**
- 只能使用提供的文獻摘要中明確提到的資訊
- 不要編造任何具體數據、百分比、統計數字（除非文獻摘要中有明確提及）
- 不要虛構研究結果、樣本數、效果量等
- 不要假設文獻沒有提到的內容
- 如果資訊不足，請誠實說明「根據現有研究」而非編造細節
- 寧可寫得保守、籠統，也不要虛構具體數據

## 文章架構原則（主要 vs 輔助文獻）

**重要：文章內容應以「主要文獻」為核心主軸！**
- 主要文獻（用戶指定的研究）：這些是文章的核心，應佔 70-80% 的篇幅，詳細介紹其研究目的、方法、發現
- 輔助文獻（搜尋到的相關研究）：用來補充背景知識、佐證主要發現、或提供不同角度的觀點，佔 20-30% 篇幅

## 寫作原則

1. **主軸明確**: 以主要文獻的研究發現為文章核心
2. **資料來源**: 所有內容必須來自提供的文獻摘要，不要添加額外資訊
3. **科學準確性**: 忠實呈現文獻內容，不誇大、不扭曲
4. **客觀中立**: 平衡呈現，說明研究限制和不確定性
5. **易於理解**: 避免艱深術語，必要時加以解釋
6. **誠實透明**: 對於不確定的內容，使用「研究顯示」「可能」「有待進一步研究」等措辭

## 引用方式

- 描述研究發現時，使用如「一項研究發現...」「根據 2023 年發表的研究...」
- 不要編造作者姓名或機構名稱（除非摘要中有提及）
- 使用 PMID 作為引用依據

## 文章結構建議（約 ${wordCount} 字）

1. **引言** (約250字): 說明為什麼這個主題重要，引起讀者興趣
2. **背景知識** (約350字): 簡單介紹相關的基礎知識（可引用輔助文獻）
3. **主要研究發現** (約800-1000字): 詳細介紹主要文獻的研究內容、方法與發現
4. **相關研究佐證** (約300字): 引用輔助文獻補充或佐證主要發現
5. **實際意義** (約350字): 這些研究對一般人有什麼意義（但不要給出具體醫療建議）
6. **限制與展望** (約200字): 研究限制、需要更多研究的地方
7. **結語** (約150字): 總結重點，提醒讀者諮詢專業醫療人員

## 格式要求

- 使用 Markdown 格式
- 適當使用小標題、條列式
- 字數約 ${wordCount} 字
- 使用繁體中文 (台灣用語)
- 不要在文章中列出參考文獻（參考文獻會另外顯示）
- 結尾加上免責聲明：本文僅供參考，不構成醫療建議，如有健康問題請諮詢專業醫療人員`;

    const userPrompt = `請根據以下文獻，撰寫一篇關於「${topic}」的科普衛教文章。

## 主要文獻（文章核心，需詳細介紹，佔 70-80% 篇幅）

${primarySummaries || '（無主要文獻）'}

## 輔助文獻（補充背景與佐證，佔 20-30% 篇幅）

${supportingSummaries || '（無輔助文獻）'}

## 嚴格要求

1. **以主要文獻為主軸**：詳細介紹主要文獻的研究內容，輔助文獻用於補充
2. **禁止幻覺**：只能使用上述文獻摘要中明確提到的資訊，不要編造任何數據或結果
3. 如果摘要資訊不夠詳細，請用「研究顯示」「根據研究」等籠統說法，不要虛構具體數字
4. 字數：約 ${wordCount} 字
5. 語言：繁體中文（台灣用語）
6. 風格：科普衛教，客觀但易懂
7. 目標讀者：一般大眾、對健康議題有興趣的民眾
8. 結尾必須包含免責聲明

請開始撰寫文章：`;

    try {
      console.log(`Generating blog article about "${topic}" based on ${primaryArticles.length} primary + ${supportingArticles.length} supporting articles...`);

      const response = await this.client.chat.completions.create({
        model: this.strongModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // 降低 temperature 以減少幻覺
        max_tokens: 5000
      });

      const content = response.choices[0].message.content;

      // 計算字數
      const charCount = content.replace(/\s/g, '').length;

      // 合併所有參考文獻
      const allArticles = [...primaryArticles, ...supportingArticles];

      return {
        success: true,
        article: content,
        metadata: {
          topic,
          primarySourceCount: primaryArticles.length,
          supportingSourceCount: supportingArticles.length,
          totalSourceCount: totalArticles,
          charCount,
          wordCountTarget: wordCount,
          generatedAt: new Date().toISOString(),
          model: this.strongModel,
          provider: this.provider
        },
        references: allArticles.map(a => ({
          pmid: a.pmid,
          title: a.title,
          journal: a.journal,
          year: a.year,
          isPrimary: primaryArticles.some(p => p.pmid === a.pmid)
        }))
      };
    } catch (error) {
      console.error('Error generating blog article:', error.message);
      throw new Error(`無法生成文章: ${error.message}`);
    }
  }

  /**
   * 從文章標題推斷研究主題
   */
  inferTopicFromArticles(articles) {
    if (!articles || articles.length === 0) {
      return '醫學研究';
    }

    // 取第一篇文章的標題作為基礎
    const firstTitle = articles[0].title || '';

    // 嘗試找出共同的關鍵詞
    const allTitles = articles.map(a => a.title || '').join(' ');

    // 簡單的主題推斷：使用第一篇文章的主要主題
    // 實際應用中可以用更複雜的 NLP
    return firstTitle.length > 50 ? firstTitle.substring(0, 50) + '...' : firstTitle;
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
      const response = await this.client.chat.completions.create({
        model: this.model,
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

export default LLMService;
