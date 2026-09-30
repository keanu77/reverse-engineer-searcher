import { logFailure } from './SafeLogging.js';
import { completionText } from './llmOutput.js';
import { checkBlogArticle, DISCLAIMER } from './blogChecks.js';

/**
 * BlogGenerator - 依文獻摘要生成繁體中文科普衛教文章
 * 摘要完整送入（含段落標籤）；免責聲明由程式固定附加；輸出後檢查引用、數字與絕對化用語。
 */

const SUPPORTING_SECTIONS = /^(RESULTS?|CONCLUSIONS?|FINDINGS|INTERPRETATION)$/i;

function describeSource(article, index, role) {
  const lines = [`【${role} ${index + 1}】PMID: ${article.pmid}`, `標題: ${article.title}`];
  if (article.journal || article.year) lines.push(`期刊: ${[article.journal, article.year].filter(Boolean).join(', ')}`);
  if (article.publication_types?.length) lines.push(`文獻類型: ${article.publication_types.join('; ')}`);
  lines.push(`摘要:\n${article.abstract}`);
  return lines.join('\n');
}

/** Supporting sources: keep result/conclusion sections, or the abstract end, so findings survive shortening. */
function supportingAbstract(article) {
  const sections = (article.abstract_sections || []).filter(s => SUPPORTING_SECTIONS.test(s.label));
  if (sections.length) return sections.map(s => `${s.label}: ${s.text}`).join('\n');
  return article.abstract.length > 800 ? `…${article.abstract.slice(-800)}` : article.abstract;
}

const SYSTEM_PROMPT = `你是醫學科普作者，把研究摘要改寫成一般民眾看得懂的繁體中文（台灣用語）衛教文章。

## 只能根據提供的摘要
- 每一個研究發現、數字、族群描述都必須來自下方摘要，並在該句句尾標註來源，例如（PMID: 12345678）。
- 摘要沒寫的數字、樣本數、效果量一律不要寫；資訊不足時直接說「摘要未提供細節」。
- 背景說明只能寫摘要中提到的內容，不要補充一般醫學知識。
- 資料不夠時寫短一點，不需要湊字數。

## 證據強度要說清楚
- 說明每篇研究的類型（隨機對照試驗、觀察性研究、系統性回顧、動物或細胞研究等）。
- 觀察性研究只能寫「相關」，不能寫成因果。動物或細胞研究不能推論到人類。
- 單一或小型研究的結果要標明有限。

## 用語限制
- 禁止絕對化或療效保證用語：保證、根治、治癒、完全預防、百分之百、無副作用、最有效、立即見效。
- 改用「研究顯示可能有助於」「可降低風險」「仍需更多研究」等措辭。
- 不提供個人化醫療建議，不寫藥物劑量。

## 格式
- Markdown，使用小標題。
- 不要自己寫參考文獻清單或免責聲明（系統會另外附上）。`;

class BlogGenerator {
  constructor(llmClient) {
    this.llmClient = llmClient;
  }

  /**
   * 生成科普部落格文章
   * @param {Array} primaryArticles - 主要文章（使用者提供的 PMID）
   * @param {Array} supportingArticles - 輔助文章（檢索到的相關文章）
   * @param {string} topic - 主題
   * @param {Object} options - { maxChars }
   */
  async generateBlogArticle(primaryArticles, supportingArticles, topic, options = {}) {
    const maxChars = Number.isInteger(options.maxChars) ? options.maxChars : 2500;
    const primary = primaryArticles.filter(a => a.abstract);
    const supporting = supportingArticles.filter(a => a.abstract);
    if (primary.length + supporting.length === 0) {
      throw new Error('所選文獻都沒有摘要，無法依據內容撰寫文章');
    }

    const primaryText = primary.map((a, i) => describeSource(a, i, '主要文獻')).join('\n\n');
    const supportingText = supporting
      .map((a, i) => describeSource({ ...a, abstract: supportingAbstract(a) }, i, '輔助文獻'))
      .join('\n\n');

    const userPrompt = `主題：「${topic}」
篇幅：最多約 ${maxChars} 字，以主要文獻為核心；輔助文獻只用來補充或對照。

## 主要文獻
${primaryText || '（無可用的主要文獻摘要）'}

## 輔助文獻
${supportingText || '（無）'}

請撰寫文章：`;

    let content;
    try {
      const response = await this.llmClient.client.chat.completions.create({
        model: this.llmClient.strongModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 8000
      });
      content = completionText(response);
    } catch (error) {
      logFailure('Error generating blog article:', error);
      throw new Error(`無法生成文章：${error.message}`);
    }

    const sources = [...primary, ...supporting];
    const { warnings, citedPmids } = checkBlogArticle(content, sources);
    const article = `${content}\n\n---\n\n${DISCLAIMER}`;
    const excluded = [...primaryArticles, ...supportingArticles].filter(a => !a.abstract);

    return {
      success: true,
      article,
      quality_warnings: [
        ...warnings,
        ...(excluded.length ? [`以下文獻沒有摘要，未納入撰寫：PMID ${excluded.map(a => a.pmid).join(', ')}`] : []),
      ],
      metadata: {
        topic,
        primarySourceCount: primary.length,
        supportingSourceCount: supporting.length,
        totalSourceCount: sources.length,
        charCount: content.replace(/[\s#*>_`-]/g, '').length,
        maxChars,
        generatedAt: new Date().toISOString(),
        model: this.llmClient.strongModel,
        provider: this.llmClient.provider
      },
      references: sources.map(a => ({
        pmid: a.pmid,
        title: a.title,
        journal: a.journal,
        year: a.year,
        publication_types: a.publication_types || [],
        isPrimary: primary.includes(a),
        isCited: citedPmids.includes(String(a.pmid))
      }))
    };
  }

  /**
   * 沒有指定主題時，以主要文獻的完整標題作為主題
   */
  inferTopicFromArticles(articles) {
    return articles?.find(a => a.title)?.title || '醫學研究';
  }
}

export { BlogGenerator };
export default BlogGenerator;
