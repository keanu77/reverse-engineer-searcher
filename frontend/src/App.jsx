import React, { useState, useMemo, useRef, useCallback } from "react";
import axios from "axios";

// Components
import {
  AdvancedSettings,
  ArticlesSection,
  ErrorMessage,
  LoadingSection,
  QueriesSection,
  TermsAnalysisTable,
  LOADING_STEPS,
} from "./components";

const BlogSection = React.lazy(() => import("./components/BlogSection"));

// Hooks
import { useLLMConfig } from "./hooks/useLLMConfig";
import { useBlogGeneration } from "./hooks/useBlogGeneration";

// Utils
import { getErrorMessage } from "./utils/errorMessages";

// 設定 axios 超時
axios.defaults.timeout = 120000;

// CSV 欄位 escape：所有欄位都用引號包裹，內部引號加倍
const escapeCsvField = (value) => {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""')}"`;
};

function App() {
  // 主要狀態
  const [pmidInput, setPmidInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [errorType, setErrorType] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // AbortController ref 用於取消進行中的請求
  const abortControllerRef = useRef(null);

  // LLM 配置 Hook
  const llmConfigHook = useLLMConfig();

  // 部落格生成 Hook
  const blogHook = useBlogGeneration();

  // 即時 PMID 解析結果
  const parsedPmids = useMemo(() => {
    return pmidInput
      .split(/[\s,;\n]+/)
      .map((s) => s.trim().replace(/\D/g, ""))
      .filter((s) => s.length > 0 && s.length <= 12);
  }, [pmidInput]);

  const uniquePmids = useMemo(() => [...new Set(parsedPmids)], [parsedPmids]);
  const duplicateCount = parsedPmids.length - uniquePmids.length;

  // 漸進式進度更新（非線性，前期快後期慢，避免假進度感）
  const simulateProgress = useCallback(() => {
    let currentProgress = 10;
    const interval = setInterval(() => {
      // 使用漸近函數：越接近 90% 越慢，永遠不會到 90%
      const remaining = 90 - currentProgress;
      const increment = Math.max(0.5, remaining * 0.08);
      currentProgress = Math.min(89, currentProgress + increment);

      // 根據進度推算步驟
      let step = 0;
      if (currentProgress >= 80) step = 4;
      else if (currentProgress >= 60) step = 3;
      else if (currentProgress >= 40) step = 2;
      else if (currentProgress >= 20) step = 1;

      setLoadingStep(step);
      setLoadingProgress(Math.round(currentProgress));
    }, 500);
    return interval;
  }, []);

  // 取消進行中的請求
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 提交搜尋
  const handleSubmit = async () => {
    if (uniquePmids.length === 0) {
      setError("請輸入至少一個有效的 PMID");
      setErrorType("validation");
      return;
    }

    if (uniquePmids.length > 10) {
      setError("最多只能輸入 10 個 PMID");
      setErrorType("validation");
      return;
    }

    // 取消之前的請求
    handleCancel();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setErrorType(null);
    setResult(null);
    setLoadingStep(0);
    setLoadingProgress(10);

    const progressInterval = simulateProgress();

    try {
      const requestBody = {
        pmids: uniquePmids,
        options: { maxTermsPerBlock: 10 },
      };

      const llmConfig = llmConfigHook.getLlmConfigForRequest();
      if (llmConfig) {
        requestBody.llmConfig = llmConfig;
      }

      const response = await axios.post(
        "/api/search-builder/from-pmids",
        requestBody,
        { signal: controller.signal },
      );
      setLoadingProgress(100);
      setResult(response.data);
    } catch (err) {
      if (axios.isCancel(err)) {
        setError("已取消請求");
        setErrorType("validation");
      } else {
        console.error("Error:", err);
        const errorInfo = getErrorMessage(err);
        setError(errorInfo.message);
        setErrorType(errorInfo.type);
      }
    } finally {
      clearInterval(progressInterval);
      abortControllerRef.current = null;
      setLoading(false);
      setLoadingStep(0);
      setLoadingProgress(0);
    }
  };

  // 複製功能
  const handleCopy = async (text, queryId) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(queryId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  // 導出 TXT
  const handleExportTxt = () => {
    if (!result?.queries) return;

    let content = `# Reverse-Engineer Searcher 搜尋策略報告\n`;
    content += `# 生成時間: ${new Date().toLocaleString("zh-TW")}\n`;
    content += `# LLM: ${result.meta?.llm_provider} / ${result.meta?.llm_model}\n\n`;

    content += `## 重要文獻 (${result.articles?.length || 0} 篇)\n`;
    result.articles?.forEach((a) => {
      content += `- PMID: ${a.pmid} | ${a.title} (${a.journal}, ${a.year})\n`;
    });
    content += `\n`;

    content += `## 搜尋策略\n\n`;
    result.queries.forEach((q) => {
      content += `### ${q.label}\n`;
      content += `命中數: ${q.hit_count?.toLocaleString() || "N/A"}\n`;
      content += `涵蓋率: ${q.quality_metrics?.coverage_rate || "N/A"}\n`;
      content += `NNT: ${q.quality_metrics?.nnt || "N/A"}\n\n`;

      Object.entries(q.translations || {}).forEach(([db, query]) => {
        content += `[${db.toUpperCase()}]\n${query}\n\n`;
      });
      content += `---\n\n`;
    });

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `search-strategy-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 導出 CSV
  const handleExportCsv = () => {
    if (!result?.queries) return;

    const rows = [
      ["版本", "資料庫", "搜尋式", "命中數", "涵蓋率", "NNT"].map(
        escapeCsvField,
      ),
    ];

    result.queries.forEach((q) => {
      Object.entries(q.translations || {}).forEach(([db, query]) => {
        rows.push([
          escapeCsvField(q.label),
          escapeCsvField(db.toUpperCase()),
          escapeCsvField(query),
          escapeCsvField(q.hit_count || ""),
          escapeCsvField(q.quality_metrics?.coverage_rate || ""),
          escapeCsvField(q.quality_metrics?.nnt || ""),
        ]);
      });
    });

    const csvContent = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `search-strategy-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 導出 RIS (文獻管理軟體通用格式)
  const handleExportRis = () => {
    if (!result?.articles) return;

    let content = "";
    result.articles.forEach((a) => {
      content += "TY  - JOUR\n";
      content += `TI  - ${a.title}\n`;
      content += `T2  - ${a.journal}\n`;
      content += `PY  - ${a.year}\n`;
      content += `AN  - ${a.pmid}\n`;
      content += `UR  - https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/\n`;
      content += "DB  - PubMed\n";
      if (a.mesh_major?.length > 0) {
        a.mesh_major.forEach((m) => {
          content += `KW  - ${m}\n`;
        });
      }
      content += "ER  - \n\n";
    });

    const blob = new Blob([content], {
      type: "application/x-research-info-systems;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `articles-${new Date().toISOString().slice(0, 10)}.ris`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 生成部落格文章
  const handleGenerateBlog = async (queryString) => {
    const llmConfig = llmConfigHook.getLlmConfigForRequest();
    await blogHook.generateBlog(queryString, uniquePmids, llmConfig);
  };

  // 複製部落格文章
  const handleCopyBlog = async () => {
    if (!blogHook.blogResult?.article) return;
    try {
      await navigator.clipboard.writeText(blogHook.blogResult.article);
      setCopiedId("blog");
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  // 導出部落格為 Markdown
  const handleExportBlogMd = () => {
    if (!blogHook.blogResult?.article) return;

    const blob = new Blob([blogHook.blogResult.article], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blog-${blogHook.blogResult.metadata?.topic?.substring(0, 30) || "article"}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Reverse-Engineer Searcher</h1>
        <p className="subtitle">
          反向工程搜尋字串生成器 | 從重要文獻自動產生 PubMed 搜尋策略
        </p>
        <p className="author">
          製作者：
          <a
            href="https://blog.sportsmedicine.tw/"
            target="_blank"
            rel="noopener noreferrer"
          >
            運動醫學科吳易澄醫師
          </a>
        </p>
      </header>

      {/* 輸入區段 */}
      <section className="input-section" aria-labelledby="input-heading">
        <h2 id="input-heading">輸入重要文獻 PMIDs</h2>

        <textarea
          value={pmidInput}
          onChange={(e) => setPmidInput(e.target.value)}
          placeholder="輸入 PMID，可用逗號、空格或換行分隔&#10;例如：&#10;12345678&#10;23456789&#10;34567890"
          disabled={loading}
          aria-label="輸入 PMID"
          aria-describedby="pmid-stats"
        />

        {/* 即時 PMID 統計 */}
        <div id="pmid-stats" className="pmid-stats" aria-live="polite">
          {uniquePmids.length > 0 ? (
            <>
              <span
                className={`pmid-count ${uniquePmids.length > 10 ? "error" : uniquePmids.length >= 3 ? "good" : "warning"}`}
              >
                檢測到 {uniquePmids.length} 個 PMID
              </span>
              {duplicateCount > 0 && (
                <span className="duplicate-warning">
                  （已自動移除 {duplicateCount} 個重複）
                </span>
              )}
              {uniquePmids.length > 10 && (
                <span className="error-text">最多只能輸入 10 個</span>
              )}
              {uniquePmids.length > 0 && uniquePmids.length < 3 && (
                <span className="warning-text">
                  建議至少輸入 3 個以獲得更好的結果
                </span>
              )}
            </>
          ) : (
            <span className="hint">
              建議輸入 3-5 篇您確定要被搜尋式撈到的核心文獻 PMID
            </span>
          )}
        </div>

        {/* 進階設定 */}
        <AdvancedSettings {...llmConfigHook} />

        <div className="button-row">
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !pmidInput.trim()}
            aria-busy={loading}
          >
            {loading ? "處理中..." : "生成搜尋字串"}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setPmidInput("");
              setResult(null);
              setError(null);
              blogHook.resetBlog();
            }}
            disabled={loading}
          >
            清除
          </button>
        </div>
      </section>

      {/* 載入進度 */}
      {loading && (
        <LoadingSection
          loadingStep={loadingStep}
          loadingProgress={loadingProgress}
          onCancel={handleCancel}
        />
      )}

      {/* 錯誤訊息 */}
      <ErrorMessage error={error} errorType={errorType} />

      {/* 空狀態引導 */}
      {!result && !loading && !error && (
        <section className="empty-state" aria-label="使用指引">
          <div className="empty-state-content">
            <h3>如何使用</h3>
            <ol>
              <li>在上方輸入框貼入 3-5 個您認為最重要的文獻 PMID</li>
              <li>系統會分析這些文獻的 MeSH 詞彙和關鍵字</li>
              <li>AI 自動產生三種版本的 PubMed 搜尋策略</li>
              <li>搜尋式同步翻譯為 Embase、Cochrane、WoS、Scopus 語法</li>
            </ol>
            <p className="empty-state-hint">
              適用於系統性文獻回顧（Systematic Review）的搜尋策略開發
            </p>
          </div>
        </section>
      )}

      {/* 結果區段 */}
      {result && (
        <>
          {/* Meta info */}
          {result.meta && (
            <div className="meta-info" aria-label="LLM 資訊">
              使用 LLM: {result.meta.llm_provider} / {result.meta.llm_model}
            </div>
          )}

          {/* 警告 */}
          {result.warnings?.length > 0 && (
            <section
              className="warnings-section"
              aria-labelledby="warnings-heading"
            >
              <h3 id="warnings-heading">注意事項</h3>
              <ul className="warnings-list" role="alert">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          {/* 文章列表 */}
          <ArticlesSection articles={result.articles} />

          {/* Term 分析表 */}
          <TermsAnalysisTable
            terms={result.terms}
            totalArticles={result.articles?.length}
          />

          {/* 搜尋式 */}
          <QueriesSection
            queries={result.queries}
            databases={result.databases}
            onCopy={handleCopy}
            copiedId={copiedId}
            onExportTxt={handleExportTxt}
            onExportCsv={handleExportCsv}
            onExportRis={handleExportRis}
          />

          {/* 部落格生成 */}
          <React.Suspense
            fallback={
              <div className="loading-section" role="status">
                載入中...
              </div>
            }
          >
            <BlogSection
              queries={result.queries}
              blogTopic={blogHook.blogTopic}
              setBlogTopic={blogHook.setBlogTopic}
              blogLoading={blogHook.blogLoading}
              blogResult={blogHook.blogResult}
              blogError={blogHook.blogError}
              onGenerateBlog={handleGenerateBlog}
              onCopyBlog={handleCopyBlog}
              onExportBlogMd={handleExportBlogMd}
              copiedId={copiedId}
            />
          </React.Suspense>

          {/* 免責聲明 */}
          <div className="disclaimer" role="note">
            本工具基於您選擇的重要文獻自動生成搜尋式，仍建議搭配資訊專家 /
            librarian 與人工調整後使用。
            <br />
            AI 生成的科普文章僅供參考，發布前請務必經過專業人員審核。
          </div>
        </>
      )}
    </div>
  );
}

export default App;
