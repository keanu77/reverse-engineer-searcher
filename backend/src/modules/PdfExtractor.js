import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

/**
 * PdfExtractor - 從 PDF 文件中提取 PMID
 */
class PdfExtractor {
  constructor() {
    // PMID 相關的正則表達式模式
    this.patterns = [
      // 標準 PMID 格式：PMID: 12345678 或 PMID 12345678
      /PMID[:\s]*(\d{7,8})/gi,
      // PubMed URL 格式
      /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{7,8})/gi,
      /ncbi\.nlm\.nih\.gov\/pubmed\/(\d{7,8})/gi,
      // PubMed ID 在括號內：(PMID: 12345678) 或 [PMID: 12345678]
      /[\[(]PMID[:\s]*(\d{7,8})[\])]/gi,
      // 參考文獻末尾的 PMID
      /\.\s*PMID[:\s]*(\d{7,8})/gi,
      // DOI 旁邊的 PMID（常見格式）
      /PMID[:\s]*(\d{7,8})\s*[.;,]/gi
    ];
  }

  /**
   * 從 PDF Buffer 中提取 PMIDs
   * @param {Buffer} pdfBuffer - PDF 文件的 Buffer
   * @returns {Promise<Object>} 提取結果
   */
  async extractFromBuffer(pdfBuffer) {
    try {
      const data = await pdf(pdfBuffer);
      return this.extractFromText(data.text, {
        pages: data.numpages,
        info: data.info
      });
    } catch (error) {
      console.error('PDF parsing error:', error.message);
      throw new Error(`無法解析 PDF 文件: ${error.message}`);
    }
  }

  /**
   * 從文本中提取 PMIDs
   * @param {string} text - 文本內容
   * @param {Object} metadata - PDF 元數據
   * @returns {Object} 提取結果
   */
  extractFromText(text, metadata = {}) {
    const foundPmids = new Set();
    const matches = [];

    // 使用所有模式進行匹配
    for (const pattern of this.patterns) {
      // 重置 regex lastIndex
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const pmid = match[1];
        if (this.isValidPmid(pmid) && !foundPmids.has(pmid)) {
          foundPmids.add(pmid);
          matches.push({
            pmid,
            context: this.getContext(text, match.index, 50)
          });
        }
      }
    }

    // 額外嘗試：尋找參考文獻區段中的獨立 7-8 位數字
    const referenceSectionPmids = this.extractFromReferenceSection(text);
    for (const pmid of referenceSectionPmids) {
      if (!foundPmids.has(pmid)) {
        foundPmids.add(pmid);
        matches.push({
          pmid,
          context: '(從參考文獻區段提取)'
        });
      }
    }

    return {
      pmids: Array.from(foundPmids).sort((a, b) => parseInt(a) - parseInt(b)),
      count: foundPmids.size,
      matches,
      metadata: {
        pages: metadata.pages,
        title: metadata.info?.Title,
        author: metadata.info?.Author
      }
    };
  }

  /**
   * 從參考文獻區段提取可能的 PMID
   * @param {string} text - 全文
   * @returns {string[]} PMIDs
   */
  extractFromReferenceSection(text) {
    const pmids = [];

    // 嘗試定位參考文獻區段
    const refPatterns = [
      /references?\s*\n/i,
      /bibliography\s*\n/i,
      /cited\s+literature\s*\n/i,
      /文獻\s*\n/i,
      /參考文獻\s*\n/i
    ];

    let refStartIndex = -1;
    for (const pattern of refPatterns) {
      const match = text.search(pattern);
      if (match !== -1 && (refStartIndex === -1 || match < refStartIndex)) {
        refStartIndex = match;
      }
    }

    if (refStartIndex !== -1) {
      const refSection = text.slice(refStartIndex);

      // 在參考文獻區段中尋找 7-8 位數字（可能是 PMID）
      const numberPattern = /\b(\d{7,8})\b/g;
      let match;
      while ((match = numberPattern.exec(refSection)) !== null) {
        const num = match[1];
        // 排除明顯不是 PMID 的數字（如年份、頁碼等）
        if (this.isLikelyPmid(num, refSection, match.index)) {
          pmids.push(num);
        }
      }
    }

    return pmids;
  }

  /**
   * 驗證 PMID 格式
   * @param {string} pmid - PMID 字串
   * @returns {boolean}
   */
  isValidPmid(pmid) {
    // PMID 是 7-8 位數字，不以 0 開頭（但有極少數例外）
    if (!/^\d{7,8}$/.test(pmid)) {
      return false;
    }

    const num = parseInt(pmid, 10);
    // PMID 目前範圍大約是 1 到 40000000+
    return num >= 1000000 && num <= 50000000;
  }

  /**
   * 判斷一個數字是否可能是 PMID（啟發式判斷）
   * @param {string} num - 數字字串
   * @param {string} context - 上下文
   * @param {number} index - 在上下文中的位置
   * @returns {boolean}
   */
  isLikelyPmid(num, context, index) {
    // 排除年份（1900-2030）
    const asInt = parseInt(num, 10);
    if (asInt >= 1900 && asInt <= 2030 && num.length === 4) {
      return false;
    }

    // 檢查上下文中是否有 PMID 相關關鍵字
    const surroundingText = context.slice(Math.max(0, index - 30), index + num.length + 30).toLowerCase();

    // 如果附近有 PMID、PubMed 等關鍵字，更可能是 PMID
    if (/pmid|pubmed|medline/i.test(surroundingText)) {
      return true;
    }

    // 排除頁碼模式（如 pp. 123-456, pages 123-456）
    if (/pp?\.\s*\d+|pages?\s*\d+/i.test(surroundingText)) {
      return false;
    }

    // 排除 DOI 模式
    if (/10\.\d{4,}/i.test(surroundingText)) {
      return false;
    }

    // 對於 7-8 位數字，如果在參考文獻區段且格式合理，認為是 PMID
    return this.isValidPmid(num);
  }

  /**
   * 獲取匹配位置的上下文
   * @param {string} text - 全文
   * @param {number} index - 匹配位置
   * @param {number} length - 上下文長度
   * @returns {string}
   */
  getContext(text, index, length) {
    const start = Math.max(0, index - length);
    const end = Math.min(text.length, index + length + 10);
    let context = text.slice(start, end).replace(/\s+/g, ' ').trim();

    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';

    return context;
  }
}

export default PdfExtractor;
