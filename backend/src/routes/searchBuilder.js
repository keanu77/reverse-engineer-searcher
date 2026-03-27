import { Router } from "express";
import PubMedClient from "../modules/PubMedClient.js";
import TermAnalyzer from "../modules/TermAnalyzer.js";
import LLMService from "../modules/LLMService.js";
import QueryValidator from "../modules/QueryValidator.js";
import QueryTranslator from "../modules/QueryTranslator.js";

const router = Router();
const isProduction = process.env.NODE_ENV === "production";

// 初始化翻譯器
const queryTranslator = new QueryTranslator();

// 允許的 LLM providers 列表
const ALLOWED_PROVIDERS = [
  "groq",
  "openai",
  "gemini",
  "grok",
  "ollama",
  "custom",
];

// 輸入驗證限制
const VALIDATION_LIMITS = {
  maxPmids: 10,
  maxQueryStringLength: 5000,
  maxTopicLength: 200,
  maxApiKeyLength: 200,
  maxBaseURLLength: 200,
  maxModelLength: 100,
};

/**
 * 驗證並清理 LLM 配置
 * 安全考量：在生產環境中不允許自訂 baseURL 以防止資料洩漏
 */
const sanitizeLLMConfig = (llmConfig = {}) => {
  const provider = (llmConfig.provider || "").toLowerCase();

  // 驗證 provider 是否在允許列表中
  if (provider && !ALLOWED_PROVIDERS.includes(provider)) {
    throw new Error(`不支援的 LLM provider: ${provider}`);
  }

  // 在生產環境中，禁止自訂 baseURL（防止資料洩漏攻擊）
  if (isProduction && llmConfig.baseURL) {
    console.warn("Production mode: Custom baseURL rejected for security");
    throw new Error("生產環境不允許自訂 API 端點");
  }

  // 在生產環境中，禁止使用 custom provider
  if (isProduction && provider === "custom") {
    throw new Error("生產環境不允許使用自訂 provider");
  }

  // 驗證長度限制
  if (
    llmConfig.apiKey &&
    llmConfig.apiKey.length > VALIDATION_LIMITS.maxApiKeyLength
  ) {
    throw new Error("API Key 長度超過限制");
  }
  if (
    llmConfig.baseURL &&
    llmConfig.baseURL.length > VALIDATION_LIMITS.maxBaseURLLength
  ) {
    throw new Error("Base URL 長度超過限制");
  }
  if (
    llmConfig.model &&
    llmConfig.model.length > VALIDATION_LIMITS.maxModelLength
  ) {
    throw new Error("Model 名稱長度超過限制");
  }

  return {
    provider: provider || process.env.LLM_PROVIDER || "groq",
    apiKey: llmConfig.apiKey || undefined,
    baseURL: (!isProduction && llmConfig.baseURL) || undefined,
    model: llmConfig.model || undefined,
  };
};

/**
 * GET /api/search-builder/providers
 * 取得支援的 LLM providers 列表
 */
router.get("/providers", (req, res) => {
  const providers = LLMService.getProviders();
  res.json({
    providers,
    default: process.env.LLM_PROVIDER || "groq",
    // 告知前端目前是否為生產環境（影響某些功能可用性）
    isProduction,
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
      apiKey: sanitized.llmConfig.apiKey ? "[REDACTED]" : undefined,
    };
  }
  return sanitized;
};

/**
 * POST /api/search-builder/from-pmids
 * 根據 PMIDs 生成搜尋策略
 */
router.post("/from-pmids", async (req, res) => {
  try {
    const { pmids, options = {}, llmConfig = {} } = req.body;

    // 記錄請求（隱藏敏感資訊）
    console.log(
      "Received request:",
      sanitizeLogData({ pmids, options, llmConfig }),
    );

    // 1. 驗證輸入
    if (!pmids || !Array.isArray(pmids) || pmids.length === 0) {
      return res.status(400).json({
        error: "Invalid input",
        message: "Please provide an array of PMIDs",
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
        const cleaned = trimmed.replace(/\D/g, "");
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
        error: "Invalid PMIDs",
        message: "No valid PMIDs found in input",
        invalidPmids: invalidPmids.slice(0, 5), // 只回傳前 5 個無效的
      });
    }

    if (uniquePmids.length > 10) {
      return res.status(400).json({
        error: "Too many PMIDs",
        message: "Maximum 10 PMIDs allowed",
      });
    }

    // 2. 初始化模組
    const pubMedClient = new PubMedClient();
    const termAnalyzer = new TermAnalyzer();

    // 建立 LLMService（使用經過驗證和清理的配置）
    const llmOptions = sanitizeLLMConfig(llmConfig);
    const llmService = new LLMService(llmOptions);

    const queryValidator = new QueryValidator(pubMedClient);

    // 3. 從 PubMed 取得文章資料
    console.log(`Fetching articles for PMIDs: ${uniquePmids.join(", ")}`);
    const { articles, missingPmids } =
      await pubMedClient.fetchArticlesByPmids(uniquePmids);

    if (articles.length === 0) {
      return res.status(404).json({
        error: "No articles found",
        message: "None of the provided PMIDs were found in PubMed",
        missing_pmids: missingPmids,
      });
    }

    // 4. 分析 terms
    console.log("Analyzing terms...");
    const allTerms = termAnalyzer.analyzeArticles(articles);

    // 過濾 terms（排除過於通用的，保留高頻的）
    const filteredTerms = termAnalyzer.filterTerms(allTerms, {
      minDocFreq: 1,
      excludeGeneric: true,
      maxTerms: 50,
    });

    // 5. 使用 LLM 分類 terms
    console.log("Classifying terms with LLM...");
    const classifiedTerms = await llmService.classifyTerms(
      filteredTerms,
      articles,
    );

    // 6. 按 PICO 角色分組
    const groupedTerms = termAnalyzer.groupTermsByRole(classifiedTerms);

    // 7. 生成搜尋式
    console.log("Generating search queries...");
    const queries = await llmService.generateSearchQueries(
      groupedTerms,
      articles,
      {
        maxTermsPerBlock: options.maxTermsPerBlock || 10,
      },
    );

    // 8. 驗證搜尋式
    console.log("Validating queries against PubMed...");
    const goldPmids = articles.map((a) => a.pmid);
    const validatedQueries = await queryValidator.validateQueries(
      queries,
      goldPmids,
    );

    // 9. 生成警告
    const warnings = queryValidator.generateWarnings(validatedQueries);

    // 如果有 PMID 找不到，加入警告
    if (missingPmids.length > 0) {
      warnings.unshift(`PMIDs not found in PubMed: ${missingPmids.join(", ")}`);
    }

    // 10. 計算品質指標並加入多資料庫翻譯
    const queriesWithMetrics = validatedQueries.map((q) => ({
      ...q,
      quality_metrics: queryValidator.calculateQualityMetrics(
        q,
        goldPmids.length,
      ),
      translations: queryTranslator.translateAll(q.query_string),
    }));

    // 11. 組裝回應
    const response = {
      pmids: uniquePmids,
      articles: articles.map((a) => ({
        pmid: a.pmid,
        title: a.title,
        journal: a.journal,
        year: a.year,
        mesh_major: a.mesh_major,
        mesh_all: a.mesh_all,
        keywords: a.keywords,
      })),
      terms: classifiedTerms.map((t) => ({
        term: t.term,
        source: t.source,
        doc_freq: t.doc_freq,
        suggested_role: t.suggested_role,
      })),
      queries: queriesWithMetrics,
      warnings,
      meta: {
        total_articles_found: articles.length,
        total_terms_analyzed: allTerms.length,
        filtered_terms_count: filteredTerms.length,
        missing_pmids: missingPmids,
        llm_provider: llmService.provider,
        llm_model: llmService.model,
      },
      databases: QueryTranslator.getDatabaseInfo(),
    };

    res.json(response);
  } catch (error) {
    console.error("Error in /from-pmids:", error);
    res.status(500).json({
      error: "Processing failed",
      message: error.message,
    });
  }
});

/**
 * POST /api/search-builder/validate-query
 * 驗證單一搜尋式
 */
router.post("/validate-query", async (req, res) => {
  try {
    const { query_string, gold_pmids } = req.body;

    if (!query_string || !gold_pmids) {
      return res.status(400).json({
        error: "Invalid input",
        message: "Please provide query_string and gold_pmids",
      });
    }

    const pubMedClient = new PubMedClient();
    const result = await pubMedClient.validateQueryCoversGoldPmids(
      query_string,
      gold_pmids,
    );

    res.json({
      query_string,
      ...result,
    });
  } catch (error) {
    console.error("Error in /validate-query:", error);
    res.status(500).json({
      error: "Validation failed",
      message: error.message,
    });
  }
});

/**
 * GET /api/search-builder/fetch-article/:pmid
 * 取得單一文章資訊
 */
router.get("/fetch-article/:pmid", async (req, res) => {
  try {
    const { pmid } = req.params;

    if (!pmid || !/^\d+$/.test(pmid)) {
      return res.status(400).json({
        error: "Invalid PMID",
        message: "PMID must be a numeric string",
      });
    }

    const pubMedClient = new PubMedClient();
    const { articles, missingPmids } = await pubMedClient.fetchArticlesByPmids([
      pmid,
    ]);

    if (articles.length === 0) {
      return res.status(404).json({
        error: "Article not found",
        message: `PMID ${pmid} was not found in PubMed`,
      });
    }

    res.json(articles[0]);
  } catch (error) {
    console.error("Error in /fetch-article:", error);
    res.status(500).json({
      error: "Fetch failed",
      message: error.message,
    });
  }
});

/**
 * POST /api/search-builder/generate-blog
 * 根據搜尋結果生成科普部落格文章
 */
router.post("/generate-blog", async (req, res) => {
  try {
    const {
      query_string,
      topic,
      gold_pmids = [],
      llmConfig = {},
      options = {},
    } = req.body;

    // 輸入驗證
    if (!query_string) {
      return res.status(400).json({
        error: "Invalid input",
        message: "請提供搜尋式 (query_string)",
      });
    }

    // 驗證 query_string 長度
    if (
      typeof query_string !== "string" ||
      query_string.length > VALIDATION_LIMITS.maxQueryStringLength
    ) {
      return res.status(400).json({
        error: "Invalid input",
        message: `搜尋式長度超過限制（最多 ${VALIDATION_LIMITS.maxQueryStringLength} 字元）`,
      });
    }

    // 驗證 topic 長度
    if (
      topic &&
      (typeof topic !== "string" ||
        topic.length > VALIDATION_LIMITS.maxTopicLength)
    ) {
      return res.status(400).json({
        error: "Invalid input",
        message: `主題長度超過限制（最多 ${VALIDATION_LIMITS.maxTopicLength} 字元）`,
      });
    }

    // 驗證 gold_pmids
    if (!Array.isArray(gold_pmids)) {
      return res.status(400).json({
        error: "Invalid input",
        message: "gold_pmids 必須是陣列",
      });
    }

    if (gold_pmids.length > VALIDATION_LIMITS.maxPmids) {
      return res.status(400).json({
        error: "Invalid input",
        message: `PMIDs 數量超過限制（最多 ${VALIDATION_LIMITS.maxPmids} 個）`,
      });
    }

    // 清理並驗證 PMIDs
    const cleanedGoldPmids = gold_pmids
      .map((p) => String(p).trim().replace(/\D/g, ""))
      .filter((p) => p.length > 0 && p.length <= 12);

    console.log(
      "Generating blog article for query:",
      query_string.substring(0, 100) + "...",
    );
    console.log("Gold PMIDs (primary sources):", cleanedGoldPmids);

    // 1. 初始化 PubMed Client
    const pubMedClient = new PubMedClient();

    // 2. 執行搜尋取得前 10 篇相關文章
    console.log("Searching PubMed for relevant articles...");
    const searchResult = await pubMedClient.searchPubMed(query_string, {
      maxResults: 15,
    });

    if (!searchResult.pmids || searchResult.pmids.length === 0) {
      return res.status(404).json({
        error: "No articles found",
        message: "搜尋式沒有找到任何文章，無法生成部落格",
      });
    }

    // 3. 取得文章詳細資訊（包含摘要）
    // 合併 gold_pmids 和搜尋結果，確保 gold_pmids 都包含在內
    // 確保 gold PMIDs 不受 slice 限制，額外補充搜尋結果
    const searchOnlyPmids = searchResult.pmids.filter(
      (p) => !cleanedGoldPmids.includes(p),
    );
    const allPmids = [...cleanedGoldPmids, ...searchOnlyPmids.slice(0, 15)];
    console.log(`Fetching details for ${allPmids.length} articles...`);
    const { articles } = await pubMedClient.fetchArticlesByPmids(allPmids);

    if (articles.length === 0) {
      return res.status(404).json({
        error: "No article details found",
        message: "無法取得文章詳細資訊",
      });
    }

    // 4. 分類文章：主要文章 (gold) vs 輔助文章
    const goldPmidSet = new Set(cleanedGoldPmids.map((p) => String(p)));
    const primaryArticles = articles.filter((a) =>
      goldPmidSet.has(String(a.pmid)),
    );
    const supportingArticles = articles
      .filter((a) => !goldPmidSet.has(String(a.pmid)))
      .slice(0, 10 - primaryArticles.length);

    console.log(
      `Primary articles: ${primaryArticles.length}, Supporting articles: ${supportingArticles.length}`,
    );

    // 5. 初始化 LLM Service（使用經過驗證和清理的配置）
    const llmOptions = sanitizeLLMConfig(llmConfig);
    const llmService = new LLMService(llmOptions);

    // 6. 決定主題（如果沒有提供，從主要文章推斷）
    const articleTopic =
      topic ||
      llmService.inferTopicFromArticles(
        primaryArticles.length > 0 ? primaryArticles : articles,
      );

    // 7. 生成部落格文章（含 fallback 處理）
    console.log(`Generating blog article about: ${articleTopic}`);
    let blogResult;
    try {
      blogResult = await llmService.generateBlogArticle(
        primaryArticles,
        supportingArticles,
        articleTopic,
        {
          wordCount: options.wordCount || "2000-2500",
          language: options.language || "zh-TW",
        },
      );
    } catch (blogError) {
      console.error(
        "Blog generation failed, returning partial result:",
        blogError.message,
      );
      // 回傳部分結果：至少有文章清單和主題
      return res.json({
        success: false,
        article: null,
        metadata: {
          topic: articleTopic,
          primarySourceCount: primaryArticles.length,
          supportingSourceCount: supportingArticles.length,
          totalSourceCount: primaryArticles.length + supportingArticles.length,
          error: blogError.message,
          generatedAt: new Date().toISOString(),
        },
        references: [...primaryArticles, ...supportingArticles].map((a) => ({
          pmid: a.pmid,
          title: a.title,
          journal: a.journal,
          year: a.year,
          isPrimary: primaryArticles.some((p) => p.pmid === a.pmid),
        })),
        searchInfo: {
          query: query_string,
          totalResults: searchResult.count,
          primaryArticlesUsed: primaryArticles.length,
          supportingArticlesUsed: supportingArticles.length,
        },
      });
    }

    // 8. 回傳結果
    res.json({
      success: true,
      ...blogResult,
      searchInfo: {
        query: query_string,
        totalResults: searchResult.count,
        primaryArticlesUsed: primaryArticles.length,
        supportingArticlesUsed: supportingArticles.length,
      },
    });
  } catch (error) {
    console.error("Error generating blog:", error);
    res.status(500).json({
      error: "Blog generation failed",
      message: error.message || "生成部落格文章時發生錯誤",
    });
  }
});

/**
 * POST /api/search-builder/test-llm
 * 測試 LLM 連線
 */
router.post("/test-llm", async (req, res) => {
  try {
    const { provider, apiKey, baseURL, model } = req.body;

    // 使用安全的 LLM 配置驗證
    const llmOptions = sanitizeLLMConfig({ provider, apiKey, baseURL, model });
    const llmService = new LLMService(llmOptions);

    // 簡單測試，添加超時設定
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 秒超時

    try {
      const response = await llmService.client.chat.completions.create(
        {
          model: llmService.model,
          messages: [
            { role: "user", content: 'Say "OK" if you can read this.' },
          ],
          max_tokens: 10,
        },
        { signal: controller.signal },
      );

      clearTimeout(timeoutId);
      const reply = response.choices[0]?.message?.content || "";

      res.json({
        success: true,
        provider: llmService.provider,
        model: llmService.model,
        response: reply,
      });
    } catch (abortError) {
      clearTimeout(timeoutId);
      if (abortError.name === "AbortError") {
        throw new Error("LLM 連線測試超時（30秒）");
      }
      throw abortError;
    }
  } catch (error) {
    console.error("Error testing LLM:", error);
    res.status(400).json({
      success: false,
      error: isProduction ? "連線測試失敗" : error.message,
    });
  }
});

export default router;
