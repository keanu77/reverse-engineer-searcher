import { Router } from 'express';
import multer from 'multer';
import PubMedClient from '../modules/PubMedClient.js';
import TermAnalyzer from '../modules/TermAnalyzer.js';
import LLMService from '../modules/LLMService.js';
import QueryValidator from '../modules/QueryValidator.js';
import QueryTranslator from '../modules/QueryTranslator.js';
import PdfExtractor from '../modules/PdfExtractor.js';

const router = Router();

// 設定 multer 用於處理 PDF 上傳（存在記憶體中）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 限制 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('只接受 PDF 檔案'), false);
    }
  }
});

// 初始化翻譯器
const queryTranslator = new QueryTranslator();

/**
 * GET /api/search-builder/providers
 * 取得支援的 LLM providers 列表
 */
router.get('/providers', (req, res) => {
  const providers = LLMService.getProviders();
  res.json({
    providers,
    default: process.env.LLM_PROVIDER || 'groq'
  });
});

// PMID 嚴格驗證正則（只允許 1-12 位數字）
const PMID_REGEX = /^[0-9]{1,12}$/;

/**
 * 安全地記錄請求（隱藏敏感資訊）
 */
const sanitizeLogData = (data) => {
  const sanitized = { ...data };
  if (sanitized.llmConfig) {
    sanitized.llmConfig = {
      ...sanitized.llmConfig,
      apiKey: sanitized.llmConfig.apiKey ? '[REDACTED]' : undefined
    };
  }
  return sanitized;
};

/**
 * POST /api/search-builder/from-pmids
 * 根據 PMIDs 生成搜尋策略
 */
router.post('/from-pmids', async (req, res) => {
  try {
    const { pmids, options = {}, llmConfig = {} } = req.body;

    // 記錄請求（隱藏敏感資訊）
    console.log('Received request:', sanitizeLogData({ pmids, options, llmConfig }));

    // 1. 驗證輸入
    if (!pmids || !Array.isArray(pmids) || pmids.length === 0) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Please provide an array of PMIDs'
      });
    }

    // 嚴格驗證並清理 PMIDs
    const cleanedPmids = [];
    const invalidPmids = [];

    for (const p of pmids) {
      const trimmed = String(p).trim();
      if (PMID_REGEX.test(trimmed)) {
        cleanedPmids.push(trimmed);
      } else {
        const cleaned = trimmed.replace(/\D/g, '');
        if (cleaned.length > 0 && cleaned.length <= 12) {
          cleanedPmids.push(cleaned);
        } else if (trimmed.length > 0) {
          invalidPmids.push(trimmed);
        }
      }
    }

    // 去除重複
    const uniquePmids = [...new Set(cleanedPmids)];

    if (uniquePmids.length === 0) {
      return res.status(400).json({
        error: 'Invalid PMIDs',
        message: 'No valid PMIDs found in input',
        invalidPmids: invalidPmids.slice(0, 5) // 只回傳前 5 個無效的
      });
    }

    if (uniquePmids.length > 10) {
      return res.status(400).json({
        error: 'Too many PMIDs',
        message: 'Maximum 10 PMIDs allowed'
      });
    }

    // 2. 初始化模組
    const pubMedClient = new PubMedClient();
    const termAnalyzer = new TermAnalyzer();

    // 建立 LLMService（優先使用後端設定的 API key）
    const llmOptions = {
      provider: llmConfig.provider || process.env.LLM_PROVIDER || 'groq',
      // 只在前端明確提供時才使用前端的 API key
      apiKey: llmConfig.apiKey || undefined,
      baseURL: llmConfig.baseURL || undefined,
      model: llmConfig.model || undefined
    };
    const llmService = new LLMService(llmOptions);

    const queryValidator = new QueryValidator(pubMedClient);

    // 3. 從 PubMed 取得文章資料
    console.log(`Fetching articles for PMIDs: ${uniquePmids.join(', ')}`);
    const { articles, missingPmids } = await pubMedClient.fetchArticlesByPmids(uniquePmids);

    if (articles.length === 0) {
      return res.status(404).json({
        error: 'No articles found',
        message: 'None of the provided PMIDs were found in PubMed',
        missing_pmids: missingPmids
      });
    }

    // 4. 分析 terms
    console.log('Analyzing terms...');
    const allTerms = termAnalyzer.analyzeArticles(articles);

    // 過濾 terms（排除過於通用的，保留高頻的）
    const filteredTerms = termAnalyzer.filterTerms(allTerms, {
      minDocFreq: 1,
      excludeGeneric: true,
      maxTerms: 50
    });

    // 5. 使用 LLM 分類 terms
    console.log('Classifying terms with LLM...');
    const classifiedTerms = await llmService.classifyTerms(filteredTerms, articles);

    // 6. 按 PICO 角色分組
    const groupedTerms = termAnalyzer.groupTermsByRole(classifiedTerms);

    // 7. 生成搜尋式
    console.log('Generating search queries...');
    const queries = await llmService.generateSearchQueries(groupedTerms, articles, {
      maxTermsPerBlock: options.maxTermsPerBlock || 10
    });

    // 8. 驗證搜尋式
    console.log('Validating queries against PubMed...');
    const goldPmids = articles.map(a => a.pmid);
    const validatedQueries = await queryValidator.validateQueries(queries, goldPmids);

    // 9. 生成警告
    const warnings = queryValidator.generateWarnings(validatedQueries);

    // 如果有 PMID 找不到，加入警告
    if (missingPmids.length > 0) {
      warnings.unshift(`PMIDs not found in PubMed: ${missingPmids.join(', ')}`);
    }

    // 10. 計算品質指標並加入多資料庫翻譯
    const queriesWithMetrics = validatedQueries.map(q => ({
      ...q,
      quality_metrics: queryValidator.calculateQualityMetrics(q, goldPmids.length),
      translations: queryTranslator.translateAll(q.query_string)
    }));

    // 11. 組裝回應
    const response = {
      pmids: uniquePmids,
      articles: articles.map(a => ({
        pmid: a.pmid,
        title: a.title,
        journal: a.journal,
        year: a.year,
        mesh_major: a.mesh_major,
        mesh_all: a.mesh_all,
        keywords: a.keywords
      })),
      terms: classifiedTerms.map(t => ({
        term: t.term,
        source: t.source,
        doc_freq: t.doc_freq,
        suggested_role: t.suggested_role
      })),
      queries: queriesWithMetrics,
      warnings,
      meta: {
        total_articles_found: articles.length,
        total_terms_analyzed: allTerms.length,
        filtered_terms_count: filteredTerms.length,
        missing_pmids: missingPmids,
        llm_provider: llmService.provider,
        llm_model: llmService.model
      },
      databases: QueryTranslator.getDatabaseInfo()
    };

    res.json(response);

  } catch (error) {
    console.error('Error in /from-pmids:', error);
    res.status(500).json({
      error: 'Processing failed',
      message: error.message
    });
  }
});

/**
 * POST /api/search-builder/validate-query
 * 驗證單一搜尋式
 */
router.post('/validate-query', async (req, res) => {
  try {
    const { query_string, gold_pmids } = req.body;

    if (!query_string || !gold_pmids) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Please provide query_string and gold_pmids'
      });
    }

    const pubMedClient = new PubMedClient();
    const result = await pubMedClient.validateQueryCoversGoldPmids(query_string, gold_pmids);

    res.json({
      query_string,
      ...result
    });

  } catch (error) {
    console.error('Error in /validate-query:', error);
    res.status(500).json({
      error: 'Validation failed',
      message: error.message
    });
  }
});

/**
 * GET /api/search-builder/fetch-article/:pmid
 * 取得單一文章資訊
 */
router.get('/fetch-article/:pmid', async (req, res) => {
  try {
    const { pmid } = req.params;

    if (!pmid || !/^\d+$/.test(pmid)) {
      return res.status(400).json({
        error: 'Invalid PMID',
        message: 'PMID must be a numeric string'
      });
    }

    const pubMedClient = new PubMedClient();
    const { articles, missingPmids } = await pubMedClient.fetchArticlesByPmids([pmid]);

    if (articles.length === 0) {
      return res.status(404).json({
        error: 'Article not found',
        message: `PMID ${pmid} was not found in PubMed`
      });
    }

    res.json(articles[0]);

  } catch (error) {
    console.error('Error in /fetch-article:', error);
    res.status(500).json({
      error: 'Fetch failed',
      message: error.message
    });
  }
});

/**
 * POST /api/search-builder/extract-from-pdf
 * 從 PDF 中提取 PMIDs
 */
router.post('/extract-from-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        message: '請上傳 PDF 檔案'
      });
    }

    console.log(`Processing PDF: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

    const pdfExtractor = new PdfExtractor();
    const result = await pdfExtractor.extractFromBuffer(req.file.buffer);

    if (result.pmids.length === 0) {
      return res.json({
        success: true,
        pmids: [],
        count: 0,
        message: '未在 PDF 中找到 PMID。請確認 PDF 包含 PubMed 參考文獻。',
        metadata: result.metadata
      });
    }

    res.json({
      success: true,
      pmids: result.pmids,
      count: result.count,
      matches: result.matches.slice(0, 20), // 只回傳前 20 個匹配詳情
      metadata: result.metadata,
      message: `成功從 PDF 中提取 ${result.count} 個 PMID`
    });

  } catch (error) {
    console.error('Error extracting PMIDs from PDF:', error);

    // 處理 multer 錯誤
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'PDF 檔案大小不能超過 10MB'
      });
    }

    res.status(500).json({
      error: 'PDF processing failed',
      message: error.message || '處理 PDF 時發生錯誤'
    });
  }
});

/**
 * POST /api/search-builder/test-llm
 * 測試 LLM 連線
 */
router.post('/test-llm', async (req, res) => {
  try {
    const { provider, apiKey, baseURL, model } = req.body;

    const llmService = new LLMService({
      provider: provider || 'groq',
      apiKey,
      baseURL,
      model
    });

    // 簡單測試
    const response = await llmService.client.chat.completions.create({
      model: llmService.model,
      messages: [{ role: 'user', content: 'Say "OK" if you can read this.' }],
      max_tokens: 10
    });

    const reply = response.choices[0]?.message?.content || '';

    res.json({
      success: true,
      provider: llmService.provider,
      model: llmService.model,
      response: reply
    });

  } catch (error) {
    console.error('Error testing LLM:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
