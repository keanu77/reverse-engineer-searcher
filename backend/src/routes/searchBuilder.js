import { Router } from "express";
import PubMedClient from "../modules/PubMedClient.js";
import TermAnalyzer from "../modules/TermAnalyzer.js";
import LLMService from "../modules/LLMService.js";
import QueryValidator from "../modules/QueryValidator.js";
import QueryTranslator from "../modules/QueryTranslator.js";
import { parsePmidList } from "../modules/pmidInput.js";
import { sanitizeLLMConfig, logFailure, publicError, errorStatus } from "../modules/RequestSecurity.js";

const router = Router();

// 初始化翻譯器
const queryTranslator = new QueryTranslator();

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
 * GET /api/search-builder/providers
 * 取得支援的 LLM providers 列表
 */
router.get("/providers", (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";
  const providers = LLMService.getProviders().filter(p => !isProduction || !["custom", "ollama"].includes(p.id));
  res.json({
    providers,
    default: process.env.LLM_PROVIDER || "groq",
    // 告知前端目前是否為生產環境（影響某些功能可用性）
    isProduction,
  });
});

// Seeds and validation PMIDs share this upper bound per group.
const MAX_SEED_PMIDS = 10;
const MAX_VALIDATION_PMIDS = 20;

const badRequest = (res, message, extra = {}) => res.status(400).json({ error: "Invalid input", message, ...extra });

function rejectedMessage(rejected) {
  return rejected.map((r) => `${r.input}：${r.reason}`).join("；");
}

/**
 * POST /api/search-builder/from-pmids
 * 根據種子 PMIDs 生成搜尋策略；可另給驗證組 PMIDs 做獨立檢查
 */
router.post("/from-pmids", async (req, res) => {
  try {
    const { pmids, validation_pmids = [], options = {}, llmConfig = {} } = req.body || {};
    if (!Array.isArray(pmids) || !Array.isArray(validation_pmids)) {
      return badRequest(res, "pmids 與 validation_pmids 必須是陣列");
    }

    const seeds = parsePmidList(pmids);
    const holdout = parsePmidList(validation_pmids);
    if (seeds.rejected.length || holdout.rejected.length) {
      return badRequest(res, `有無法辨識的 PMID：${rejectedMessage([...seeds.rejected, ...holdout.rejected])}`);
    }
    if (seeds.pmids.length === 0) return badRequest(res, "請至少提供一個種子文獻 PMID");
    if (seeds.pmids.length > MAX_SEED_PMIDS) return badRequest(res, `種子文獻最多 ${MAX_SEED_PMIDS} 篇`);
    if (holdout.pmids.length > MAX_VALIDATION_PMIDS) return badRequest(res, `驗證組最多 ${MAX_VALIDATION_PMIDS} 篇`);
    const overlap = holdout.pmids.filter((p) => seeds.pmids.includes(p));
    if (overlap.length) return badRequest(res, `驗證組不能包含種子文獻：${overlap.join(", ")}`);

    const pubMedClient = new PubMedClient();
    const termAnalyzer = new TermAnalyzer();
    const llmService = new LLMService(sanitizeLLMConfig(llmConfig, req));
    const queryValidator = new QueryValidator(pubMedClient);
    const warnings = [];

    const { articles: fetched, missingPmids } = await pubMedClient.fetchArticlesByPmids(seeds.pmids);
    if (missingPmids.length) warnings.push(`PubMed 查無這些種子 PMID：${missingPmids.join(", ")}`);
    const retracted = fetched.filter((a) => a.is_retracted);
    if (retracted.length) warnings.push(`已撤稿、未納入分析：PMID ${retracted.map((a) => a.pmid).join(", ")}`);
    const articles = fetched.filter((a) => !a.is_retracted);
    if (articles.length === 0) {
      return res.status(404).json({ error: "No articles found", message: "沒有可用的種子文獻（查無或已撤稿）", missing_pmids: missingPmids });
    }
    const unindexed = articles.filter((a) => !a.indexed_for_medline);
    if (unindexed.length) {
      warnings.push(`尚未完成 MeSH 標引：PMID ${unindexed.map((a) => a.pmid).join(", ")}；只用 MeSH 的區塊可能漏掉這類紀錄`);
    }

    const validationPmids = holdout.pmids;
    if (validationPmids.length) {
      const { missingPmids: missingValidation } = await pubMedClient.fetchArticlesByPmids(validationPmids);
      if (missingValidation.length) warnings.push(`PubMed 查無這些驗證組 PMID：${missingValidation.join(", ")}`);
    }

    const allTerms = termAnalyzer.analyzeArticles(articles);
    const filteredTerms = termAnalyzer.filterTerms(allTerms, { minDocFreq: 1, excludeGeneric: true, maxTerms: 50 });
    const classifiedTerms = await llmService.classifyTerms(filteredTerms, articles);
    const unclassified = classifiedTerms.filter((t) => t.classification_status !== "classified");
    if (unclassified.length === classifiedTerms.length && classifiedTerms.length) {
      warnings.push("詞彙分類失敗，檢索式只能依文獻標題產生，請人工檢查每個概念區塊");
    } else if (unclassified.length) {
      warnings.push(`${unclassified.length} 個詞未被模型分類（歸入 Other，不會進入檢索式）`);
    }

    const groupedTerms = termAnalyzer.groupTermsByRole(classifiedTerms);
    const maxTermsPerBlock = Number.isInteger(options.maxTermsPerBlock) ? Math.min(Math.max(options.maxTermsPerBlock, 1), 20) : 10;
    const queries = await llmService.generateSearchQueries(groupedTerms, articles, { maxTermsPerBlock });
    if (queries.length === 0) {
      return res.status(502).json({ error: "Generation failed", message: "模型沒有產生可用的檢索式，請重試或更換模型" });
    }
    if (queries.length < 3) warnings.push(`模型只產生 ${queries.length} 條有效檢索式`);

    const seedPmids = articles.map((a) => a.pmid);
    const validatedQueries = await queryValidator.validateQueries(queries, seedPmids, { validationPmids });
    warnings.push(...queryValidator.generateWarnings(validatedQueries));

    const queriesWithTranslations = validatedQueries.map((q) => {
      if (q.lint_errors.length) return { ...q, translations: { pubmed: q.query_string }, translation_warnings: {} };
      const { translations, warnings: translationWarnings, error } = queryTranslator.translateAll(q.query_string);
      return { ...q, translations, translation_warnings: translationWarnings, ...(error ? { translation_error: error } : {}) };
    });

    res.json({
      pmids: seeds.pmids,
      validation_pmids: validationPmids,
      articles: articles.map((a) => ({
        pmid: a.pmid,
        title: a.title,
        journal: a.journal,
        year: a.year,
        publication_types: a.publication_types,
        indexed_for_medline: a.indexed_for_medline,
        mesh_major: a.mesh_major,
        mesh_all: a.mesh_all,
        keywords: a.keywords,
      })),
      terms: classifiedTerms.map((t) => ({
        term: t.term,
        source: t.source,
        doc_freq: t.doc_freq,
        suggested_role: t.suggested_role,
        classification_status: t.classification_status,
      })),
      queries: queriesWithTranslations,
      warnings,
      meta: {
        generated_at: new Date().toISOString(),
        seeds_requested: seeds.pmids.length,
        seeds_used: articles.length,
        validation_set_size: validationPmids.length,
        total_terms_analyzed: allTerms.length,
        filtered_terms_count: filteredTerms.length,
        missing_pmids: missingPmids,
        llm_provider: llmService.provider,
        llm_model: llmService.strongModel,
        method_note: "種子涵蓋率只代表這組種子文獻；要估計對其他相關文獻的涵蓋，請提供未參與建構的驗證組 PMID。",
      },
      databases: QueryTranslator.getDatabaseInfo(),
    });
  } catch (error) {
    logFailure("from-pmids", error);
    res.status(errorStatus(error)).json({
      error: "Processing failed",
      message: publicError(error),
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
    logFailure("fetch-article", error);
    res.status(errorStatus(error)).json({
      error: "Fetch failed",
      message: publicError(error),
    });
  }
});

// Supporting sources exclude retracted and non-research items and animal-only studies.
const SUPPORTING_FILTER =
  " NOT (retracted publication[pt] OR retraction of publication[pt] OR comment[pt] OR letter[pt] OR editorial[pt])) NOT (animals[mh] NOT humans[mh])";
const MAX_BLOG_SOURCES = 10;

/**
 * POST /api/search-builder/generate-blog
 * 以使用者提供的主要文獻為核心、檢索結果為輔，生成科普文章
 */
router.post("/generate-blog", async (req, res) => {
  try {
    const { query_string, topic, gold_pmids = [], llmConfig = {} } = req.body || {};

    if (typeof query_string !== "string" || !query_string.trim()) {
      return badRequest(res, "請提供搜尋式 (query_string)");
    }
    if (query_string.length > VALIDATION_LIMITS.maxQueryStringLength) {
      return badRequest(res, `搜尋式長度超過限制（最多 ${VALIDATION_LIMITS.maxQueryStringLength} 字元）`);
    }
    if (topic != null && (typeof topic !== "string" || topic.length > VALIDATION_LIMITS.maxTopicLength)) {
      return badRequest(res, `主題長度超過限制（最多 ${VALIDATION_LIMITS.maxTopicLength} 字元）`);
    }
    if (!Array.isArray(gold_pmids)) return badRequest(res, "gold_pmids 必須是陣列");
    const gold = parsePmidList(gold_pmids);
    if (gold.rejected.length) return badRequest(res, `有無法辨識的 PMID：${rejectedMessage(gold.rejected)}`);
    if (gold.pmids.length > VALIDATION_LIMITS.maxPmids) {
      return badRequest(res, `PMIDs 數量超過限制（最多 ${VALIDATION_LIMITS.maxPmids} 個）`);
    }

    const llmService = new LLMService(sanitizeLLMConfig(llmConfig, req));
    const pubMedClient = new PubMedClient();
    const notes = [];

    const { articles: goldArticles, missingPmids } = await pubMedClient.fetchArticlesByPmids(gold.pmids);
    if (missingPmids.length) notes.push(`PubMed 查無主要文獻 PMID：${missingPmids.join(", ")}`);
    const retractedGold = goldArticles.filter((a) => a.is_retracted);
    if (retractedGold.length) notes.push(`主要文獻已撤稿、未納入：PMID ${retractedGold.map((a) => a.pmid).join(", ")}`);
    const primaryArticles = goldArticles.filter((a) => !a.is_retracted);

    const supportingSlots = MAX_BLOG_SOURCES - primaryArticles.length;
    let supportingArticles = [];
    let totalResults = 0;
    if (supportingSlots > 0) {
      const searchResult = await pubMedClient.searchPubMed(`((${query_string})${SUPPORTING_FILTER}`, { maxResults: supportingSlots + primaryArticles.length });
      totalResults = searchResult.count;
      const candidates = searchResult.pmids.filter((p) => !gold.pmids.includes(p)).slice(0, supportingSlots);
      if (candidates.length) {
        const { articles } = await pubMedClient.fetchArticlesByPmids(candidates);
        supportingArticles = articles.filter((a) => !a.is_retracted);
      } else {
        notes.push("補充檢索沒有找到其他文獻，只使用主要文獻");
      }
    }

    if (primaryArticles.length + supportingArticles.length === 0) {
      return res.status(404).json({ error: "No articles found", message: "沒有可用的文獻，無法生成文章" });
    }

    const articleTopic = topic?.trim() || llmService.inferTopicFromArticles(primaryArticles.length ? primaryArticles : supportingArticles);
    const blogResult = await llmService.generateBlogArticle(primaryArticles, supportingArticles, articleTopic);

    res.json({
      ...blogResult,
      quality_warnings: [...notes, ...blogResult.quality_warnings],
      searchInfo: {
        query: query_string,
        totalResults,
        primaryArticlesUsed: blogResult.metadata.primarySourceCount,
        supportingArticlesUsed: blogResult.metadata.supportingSourceCount,
      },
    });
  } catch (error) {
    logFailure("generate-blog", error);
    res.status(errorStatus(error)).json({
      success: false,
      error: "Blog generation failed",
      message: publicError(error),
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
    const llmOptions = sanitizeLLMConfig({ provider, apiKey, baseURL, model }, req);
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
          max_tokens: 128,
          ...(llmService.provider === 'groq' && llmService.model.startsWith('openai/gpt-oss-')
            ? { reasoning_effort: 'low', include_reasoning: false }
            : {}),
        },
        { signal: controller.signal },
      );

      clearTimeout(timeoutId);
      const reply = response.choices[0]?.message?.content || "";
      if (typeof reply !== 'string' || !reply.trim()) {
        throw new Error('Provider returned no visible completion');
      }

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
    logFailure("test-llm", error);
    res.status(errorStatus(error)).json({
      success: false,
      error: publicError(error, "連線測試失敗，請檢查設定後重試"),
    });
  }
});

export default router;
