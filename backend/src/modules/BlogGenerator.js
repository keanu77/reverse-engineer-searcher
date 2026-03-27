/**
 * BlogGenerator - 使用 LLM 生成科普衛教文章
 */

class BlogGenerator {
  constructor(llmClient) {
    this.llmClient = llmClient;
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

      const response = await this.llmClient.client.chat.completions.create({
        model: this.llmClient.strongModel,
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
          model: this.llmClient.strongModel,
          provider: this.llmClient.provider
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
}

export { BlogGenerator };
export default BlogGenerator;
