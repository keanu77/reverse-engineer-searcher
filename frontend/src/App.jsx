import React, { useState, useMemo } from 'react';
import axios from 'axios';

// Components
import {
  AdvancedSettings,
  ArticlesSection,
  BlogSection,
  ErrorMessage,
  LoadingSection,
  QueriesSection,
  TermsAnalysisTable,
  LOADING_STEPS
} from './components';

// Hooks
import { useLLMConfig } from './hooks/useLLMConfig';
import { useBlogGeneration } from './hooks/useBlogGeneration';

// 設定 axios 超時
axios.defaults.timeout = 60000;

// 錯誤訊息分類
const getErrorMessage = (error) => {
  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      return { type: 'timeout', message: '請求超時，請檢查網路連線後重試' };
    }
    return { type: 'network', message: '網路連接失敗，請檢查您的網路' };
  }

  const status = error.response.status;
  const data = error.response.data;

  if (status === 400) {
    return { type: 'validation', message: data.message || '輸入格式錯誤，請檢查 PMID' };
  }
  if (status === 404) {
    return { type: 'not_found', message: data.message || '找不到指定的文章' };
  }
  if (status === 429) {
    return { type: 'rate_limit', message: 'API 請求過於頻繁，請等待 30 秒後重試' };
  }
  if (status >= 500) {
    return { type: 'server', message: '伺服器發生錯誤，請稍後再試' };
  }

  return { type: 'unknown', message: data.message || '發生未知錯誤' };
};

function App() {
  // 主要狀態
  const [pmidInput, setPmidInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [errorType, setErrorType] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // LLM 配置 Hook
  const llmConfigHook = useLLMConfig();

  // 部落格生成 Hook
  const blogHook = useBlogGeneration();

  // 即時 PMID 解析結果
  const parsedPmids = useMemo(() => {
    return pmidInput
      .split(/[\s,;\n]+/)
      .map(s => s.trim().replace(/\D/g, ''))
      .filter(s => s.length > 0 && s.length <= 12);
  }, [pmidInput]);

  const uniquePmids = useMemo(() => [...new Set(parsedPmids)], [parsedPmids]);
  const duplicateCount = parsedPmids.length - uniquePmids.length;

  // 模擬進度更新
  const simulateProgress = () => {
    let step = 0;
    const interval = setInterval(() => {
      if (step < LOADING_STEPS.length - 1) {
        step++;
        setLoadingStep(step);
        setLoadingProgress(LOADING_STEPS[step].progress);
      }
    }, 3000);
    return interval;
  };

  // 提交搜尋
  const handleSubmit = async () => {
    if (uniquePmids.length === 0) {
      setError('請輸入至少一個有效的 PMID');
      setErrorType('validation');
      return;
    }

    if (uniquePmids.length > 10) {
      setError('最多只能輸入 10 個 PMID');
      setErrorType('validation');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorType(null);
    setResult(null);
    setLoadingStep(0);
    setLoadingProgress(LOADING_STEPS[0].progress);

    const progressInterval = simulateProgress();

    try {
      const requestBody = {
        pmids: uniquePmids,
        options: { maxTermsPerBlock: 10 }
      };

      const llmConfig = llmConfigHook.getLlmConfigForRequest();
      if (llmConfig) {
        requestBody.llmConfig = llmConfig;
      }

      const response = await axios.post('/api/search-builder/from-pmids', requestBody);
      setLoadingProgress(100);
      setResult(response.data);
    } catch (err) {
      console.error('Error:', err);
      const errorInfo = getErrorMessage(err);
      setError(errorInfo.message);
      setErrorType(errorInfo.type);
    } finally {
      clearInterval(progressInterval);
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
      console.error('Copy failed:', err);
    }
  };

  // 導出 TXT
  const handleExportTxt = () => {
    if (!result?.queries) return;

    let content = `# Reverse-Engineer Searcher 搜尋策略報告\n`;
    content += `# 生成時間: ${new Date().toLocaleString('zh-TW')}\n`;
    content += `# LLM: ${result.meta?.llm_provider} / ${result.meta?.llm_model}\n\n`;

    content += `## 重要文獻 (${result.articles?.length || 0} 篇)\n`;
    result.articles?.forEach(a => {
      content += `- PMID: ${a.pmid} | ${a.title} (${a.journal}, ${a.year})\n`;
    });
    content += `\n`;

    content += `## 搜尋策略\n\n`;
    result.queries.forEach(q => {
      content += `### ${q.label}\n`;
      content += `命中數: ${q.hit_count?.toLocaleString() || 'N/A'}\n`;
      content += `涵蓋率: ${q.quality_metrics?.coverage_rate || 'N/A'}\n`;
      content += `NNT: ${q.quality_metrics?.nnt || 'N/A'}\n\n`;

      Object.entries(q.translations || {}).forEach(([db, query]) => {
        content += `[${db.toUpperCase()}]\n${query}\n\n`;
      });
      content += `---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-strategy-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 導出 CSV
  const handleExportCsv = () => {
    if (!result?.queries) return;

    const rows = [['版本', '資料庫', '搜尋式', '命中數', '涵蓋率', 'NNT']];

    result.queries.forEach(q => {
      Object.entries(q.translations || {}).forEach(([db, query]) => {
        rows.push([
          q.label,
          db.toUpperCase(),
          `"${query.replace(/"/g, '""')}"`,
          q.hit_count || '',
          q.quality_metrics?.coverage_rate || '',
          q.quality_metrics?.nnt || ''
        ]);
      });
    });

    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-strategy-${new Date().toISOString().slice(0, 10)}.csv`;
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
      setCopiedId('blog');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  // 導出部落格為 Markdown
  const handleExportBlogMd = () => {
    if (!blogHook.blogResult?.article) return;

    const blob = new Blob([blogHook.blogResult.article], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blog-${blogHook.blogResult.metadata?.topic?.substring(0, 30) || 'article'}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Reverse-Engineer Searcher</h1>
        <p className="subtitle">反向工程搜尋字串生成器 | 從重要文獻自動產生 PubMed 搜尋策略</p>
        <p className="author">
          製作者：<a href="https://blog.sportsmedicine.tw/" target="_blank" rel="noopener noreferrer">運動醫學科吳易澄醫師</a>
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
              <span className={`pmid-count ${uniquePmids.length > 10 ? 'error' : uniquePmids.length >= 3 ? 'good' : 'warning'}`}>
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
                <span className="warning-text">建議至少輸入 3 個以獲得更好的結果</span>
              )}
            </>
          ) : (
            <span className="hint">建議輸入 3-5 篇您確定要被搜尋式撈到的核心文獻 PMID</span>
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
            {loading ? '處理中...' : '生成搜尋字串'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setPmidInput('');
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
        <LoadingSection loadingStep={loadingStep} loadingProgress={loadingProgress} />
      )}

      {/* 錯誤訊息 */}
      <ErrorMessage error={error} errorType={errorType} />

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
            <section className="warnings-section" aria-labelledby="warnings-heading">
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
          />

          {/* 部落格生成 */}
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

          {/* 免責聲明 */}
          <div className="disclaimer" role="note">
            本工具基於您選擇的重要文獻自動生成搜尋式，仍建議搭配資訊專家 / librarian 與人工調整後使用。
            <br />
            AI 生成的科普文章僅供參考，發布前請務必經過專業人員審核。
          </div>
        </>
      )}
    </div>
  );
}

export default App;
