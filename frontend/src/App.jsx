import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

// 設定 axios 超時
axios.defaults.timeout = 60000; // 60 秒

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

// 載入步驟定義
const LOADING_STEPS = [
  { id: 'fetch', label: '正在從 PubMed 取得文章資料...', progress: 20 },
  { id: 'analyze', label: '正在分析 MeSH 詞彙與關鍵字...', progress: 40 },
  { id: 'classify', label: '正在使用 AI 進行 PICO 分類...', progress: 60 },
  { id: 'generate', label: '正在生成搜尋策略...', progress: 80 },
  { id: 'validate', label: '正在驗證搜尋式涵蓋率...', progress: 95 }
];

// 預設的 LLM Provider 設定
const DEFAULT_PROVIDERS = {
  groq: {
    name: 'Groq (免費)',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768']
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  gemini: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']
  },
  grok: {
    name: 'Grok (xAI)',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-beta',
    models: ['grok-beta']
  },
  custom: {
    name: '自訂 API',
    baseURL: '',
    defaultModel: '',
    models: []
  }
};

function App() {
  const [pmidInput, setPmidInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0); // 使用索引
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [errorType, setErrorType] = useState(null);
  const [roleFilter, setRoleFilter] = useState('all');
  const [copiedId, setCopiedId] = useState(null);

  // PDF 上傳相關狀態
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfResult, setPdfResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // 即時 PMID 解析結果
  const parsedPmids = useMemo(() => {
    return pmidInput
      .split(/[\s,;\n]+/)
      .map(s => s.trim().replace(/\D/g, ''))
      .filter(s => s.length > 0 && s.length <= 12);
  }, [pmidInput]);

  const uniquePmids = useMemo(() => [...new Set(parsedPmids)], [parsedPmids]);
  const duplicateCount = parsedPmids.length - uniquePmids.length;

  // 進階設定
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [llmConfig, setLlmConfig] = useState({
    provider: 'groq',
    apiKey: '',
    baseURL: '',
    model: ''
  });
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState(null);

  // 資料庫選擇
  const [selectedDatabase, setSelectedDatabase] = useState('pubmed');

  const handleProviderChange = (provider) => {
    const config = DEFAULT_PROVIDERS[provider];
    setLlmConfig({
      ...llmConfig,
      provider,
      baseURL: provider === 'custom' ? llmConfig.baseURL : '',
      model: config?.defaultModel || ''
    });
    setLlmTestResult(null);
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    setLlmTestResult(null);

    try {
      const response = await axios.post('/api/search-builder/test-llm', {
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey || undefined,
        baseURL: llmConfig.baseURL || undefined,
        model: llmConfig.model || undefined
      });

      setLlmTestResult({
        success: true,
        message: `連線成功! Provider: ${response.data.provider}, Model: ${response.data.model}`
      });
    } catch (err) {
      setLlmTestResult({
        success: false,
        message: err.response?.data?.error || err.message || '連線失敗'
      });
    } finally {
      setTestingLlm(false);
    }
  };

  // PDF 上傳處理
  const handlePdfUpload = async (file) => {
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('請上傳 PDF 檔案');
      setErrorType('validation');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('PDF 檔案大小不能超過 10MB');
      setErrorType('validation');
      return;
    }

    setPdfUploading(true);
    setPdfResult(null);
    setError(null);
    setErrorType(null);

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const response = await axios.post('/api/search-builder/extract-from-pdf', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      const data = response.data;
      setPdfResult(data);

      if (data.pmids && data.pmids.length > 0) {
        // 將提取的 PMIDs 加入輸入框
        const currentPmids = pmidInput.trim();
        const newPmids = data.pmids.join('\n');
        if (currentPmids) {
          setPmidInput(currentPmids + '\n' + newPmids);
        } else {
          setPmidInput(newPmids);
        }
      }
    } catch (err) {
      console.error('PDF upload error:', err);
      const errorInfo = getErrorMessage(err);
      setError(errorInfo.message);
      setErrorType(errorInfo.type);
    } finally {
      setPdfUploading(false);
    }
  };

  // 拖拽處理
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handlePdfUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handlePdfUpload(e.target.files[0]);
    }
  };

  // 模擬進度更新
  const simulateProgress = () => {
    let step = 0;
    const interval = setInterval(() => {
      if (step < LOADING_STEPS.length - 1) {
        step++;
        setLoadingStep(step);
        setLoadingProgress(LOADING_STEPS[step].progress);
      }
    }, 3000); // 每 3 秒進一步
    return interval;
  };

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

    // 開始模擬進度
    const progressInterval = simulateProgress();

    try {
      const requestBody = {
        pmids: uniquePmids,
        options: {
          maxTermsPerBlock: 10
        }
      };

      // 如果有進階設定，加入 llmConfig
      if (llmConfig.apiKey || llmConfig.provider !== 'groq') {
        requestBody.llmConfig = {
          provider: llmConfig.provider,
          apiKey: llmConfig.apiKey || undefined,
          baseURL: llmConfig.baseURL || undefined,
          model: llmConfig.model || undefined
        };
      }

      const response = await axios.post('/api/search-builder/from-pmids', requestBody);

      // 完成時設置 100%
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

  const handleCopy = async (text, queryId) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(queryId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  // 導出功能
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

  const handleExportCsv = () => {
    if (!result?.queries) return;

    const rows = [
      ['版本', '資料庫', '搜尋式', '命中數', '涵蓋率', 'NNT']
    ];

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
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-strategy-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredTerms = result?.terms?.filter(t =>
    roleFilter === 'all' || t.suggested_role === roleFilter
  ) || [];

  const currentProviderConfig = DEFAULT_PROVIDERS[llmConfig.provider];

  return (
    <div className="container">
      <header className="header">
        <h1>Reverse-Engineer Searcher</h1>
        <p className="subtitle">反向工程搜尋字串生成器 | 從重要文獻自動產生 PubMed 搜尋策略</p>
        <p className="author">
          製作者：<a href="https://blog.sportsmedicine.tw/" target="_blank" rel="noopener noreferrer">運動醫學科吳易澄醫師</a>
        </p>
      </header>

      {/* Input Section */}
      <section className="input-section">
        <h2>輸入重要文獻 PMIDs</h2>

        {/* PDF 上傳區域 */}
        <div
          className={`pdf-upload-zone ${dragActive ? 'drag-active' : ''} ${pdfUploading ? 'uploading' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            id="pdf-input"
            accept=".pdf,application/pdf"
            onChange={handleFileInput}
            disabled={loading || pdfUploading}
            style={{ display: 'none' }}
          />
          <label htmlFor="pdf-input" className="pdf-upload-label">
            {pdfUploading ? (
              <>
                <span className="upload-icon">⏳</span>
                <span className="upload-text">正在解析 PDF...</span>
              </>
            ) : (
              <>
                <span className="upload-icon">📄</span>
                <span className="upload-text">
                  拖拽 PDF 到這裡，或 <span className="upload-link">點擊選擇檔案</span>
                </span>
                <span className="upload-hint">從 PDF 中自動提取 PMID（支援系統性回顧、meta-analysis 等）</span>
              </>
            )}
          </label>
        </div>

        {/* PDF 提取結果 */}
        {pdfResult && (
          <div className={`pdf-result ${pdfResult.count > 0 ? 'success' : 'warning'}`}>
            <span className="pdf-result-icon">{pdfResult.count > 0 ? '✅' : '⚠️'}</span>
            <div className="pdf-result-content">
              <span className="pdf-result-message">{pdfResult.message}</span>
              {pdfResult.metadata?.title && (
                <span className="pdf-result-meta">檔案：{pdfResult.metadata.title}</span>
              )}
            </div>
            <button
              className="pdf-result-close"
              onClick={() => setPdfResult(null)}
            >×</button>
          </div>
        )}

        <div className="input-divider">
          <span>或直接輸入 PMID</span>
        </div>

        <textarea
          value={pmidInput}
          onChange={(e) => setPmidInput(e.target.value)}
          placeholder="輸入 PMID，可用逗號、空格或換行分隔&#10;例如：&#10;12345678&#10;23456789&#10;34567890"
          disabled={loading}
        />

        {/* 即時 PMID 統計 */}
        <div className="pmid-stats">
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

        {/* Advanced Settings Toggle */}
        <div className="advanced-toggle">
          <button
            className="btn-link"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼ 隱藏進階設定' : '▶ 進階設定（更換 LLM）'}
          </button>
        </div>

        {/* Advanced Settings Panel */}
        {showAdvanced && (
          <div className="advanced-settings">
            <h3>LLM Provider 設定</h3>
            <p className="hint">預設使用免費的 Groq API。您也可以使用自己的 API key 切換到其他 LLM。</p>

            <div className="settings-grid">
              <div className="setting-row">
                <label>Provider</label>
                <select
                  value={llmConfig.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  {Object.entries(DEFAULT_PROVIDERS).map(([key, config]) => (
                    <option key={key} value={key}>{config.name}</option>
                  ))}
                </select>
              </div>

              <div className="setting-row">
                <label>API Key {llmConfig.provider === 'groq' && '(可選)'}</label>
                <input
                  type="password"
                  value={llmConfig.apiKey}
                  onChange={(e) => setLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                  placeholder={llmConfig.provider === 'groq' ? '留空使用預設 key' : '輸入你的 API key'}
                />
              </div>

              {llmConfig.provider === 'custom' && (
                <div className="setting-row">
                  <label>Base URL</label>
                  <input
                    type="text"
                    value={llmConfig.baseURL}
                    onChange={(e) => setLlmConfig({ ...llmConfig, baseURL: e.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
              )}

              <div className="setting-row">
                <label>Model</label>
                {currentProviderConfig?.models?.length > 0 ? (
                  <select
                    value={llmConfig.model || currentProviderConfig.defaultModel}
                    onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
                  >
                    {currentProviderConfig.models.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={llmConfig.model}
                    onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
                    placeholder="輸入模型名稱"
                  />
                )}
              </div>
            </div>

            <div className="test-llm-row">
              <button
                className="btn btn-secondary"
                onClick={handleTestLlm}
                disabled={testingLlm}
              >
                {testingLlm ? '測試中...' : '測試連線'}
              </button>
              {llmTestResult && (
                <span className={`test-result ${llmTestResult.success ? 'success' : 'error'}`}>
                  {llmTestResult.message}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="button-row">
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !pmidInput.trim()}
          >
            {loading ? '處理中...' : '生成搜尋字串'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setPmidInput('');
              setResult(null);
              setError(null);
            }}
            disabled={loading}
          >
            清除
          </button>
        </div>
      </section>

      {/* Loading with Progress Bar */}
      {loading && (
        <div className="loading-section">
          <div className="progress-container">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <span className="progress-text">{loadingProgress}%</span>
          </div>
          <div className="loading-steps">
            {LOADING_STEPS.map((step, index) => (
              <div
                key={step.id}
                className={`loading-step ${index < loadingStep ? 'completed' : index === loadingStep ? 'active' : ''}`}
              >
                <span className="step-icon">
                  {index < loadingStep ? '✓' : index === loadingStep ? '⏳' : '○'}
                </span>
                <span className="step-label">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error with categorized display */}
      {error && (
        <div className={`error-message error-${errorType || 'unknown'}`}>
          <span className="error-icon">
            {errorType === 'network' ? '🔌' :
             errorType === 'timeout' ? '⏱️' :
             errorType === 'rate_limit' ? '⚠️' :
             errorType === 'validation' ? '📝' :
             errorType === 'not_found' ? '🔍' :
             errorType === 'server' ? '🖥️' : '❌'}
          </span>
          <div className="error-content">
            <span className="error-text">{error}</span>
            {errorType === 'network' && (
              <span className="error-hint">請檢查您的網路連線是否正常</span>
            )}
            {errorType === 'rate_limit' && (
              <span className="error-hint">請稍等 30 秒後再試</span>
            )}
            {errorType === 'server' && (
              <span className="error-hint">如果問題持續，請稍後再試或聯繫管理員</span>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Meta info */}
          {result.meta && (
            <div className="meta-info">
              使用 LLM: {result.meta.llm_provider} / {result.meta.llm_model}
            </div>
          )}

          {/* Warnings */}
          {result.warnings?.length > 0 && (
            <section className="warnings-section">
              <h3>注意事項</h3>
              <ul className="warnings-list">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Articles */}
          <section className="articles-section">
            <h2>重要文獻確認 ({result.articles?.length || 0} 篇)</h2>
            {result.articles?.map(article => (
              <div key={article.pmid} className="article-card">
                <div className="article-header">
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="article-pmid-link"
                  >
                    PMID: {article.pmid} ↗
                  </a>
                </div>
                <p className="article-title">{article.title}</p>
                <p className="article-meta">{article.journal}, {article.year}</p>
                {article.mesh_major?.length > 0 && (
                  <div className="article-mesh">
                    <span className="mesh-label">MeSH Major:</span>
                    {article.mesh_major.slice(0, 5).map((mesh, i) => (
                      <span key={i} className="mesh-tag">{mesh}</span>
                    ))}
                    {article.mesh_major.length > 5 && (
                      <span className="mesh-more">+{article.mesh_major.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>

          {/* Terms */}
          <section className="terms-section">
            <h2>Term 分析表 ({filteredTerms.length} 個詞彙)</h2>
            <div className="terms-filter">
              {['all', 'P', 'I', 'O', 'D', 'Other'].map(role => (
                <button
                  key={role}
                  className={`filter-btn ${roleFilter === role ? 'active' : ''}`}
                  onClick={() => setRoleFilter(role)}
                >
                  {role === 'all' ? '全部' :
                   role === 'P' ? 'Population' :
                   role === 'I' ? 'Intervention' :
                   role === 'O' ? 'Outcome' :
                   role === 'D' ? 'Design' : 'Other'}
                </button>
              ))}
            </div>
            <table className="terms-table">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>來源</th>
                  <th>出現次數</th>
                  <th>角色</th>
                </tr>
              </thead>
              <tbody>
                {filteredTerms.map((term, i) => (
                  <tr key={i}>
                    <td>{term.term}</td>
                    <td>
                      <span className={`source-badge ${term.source === 'MeSH-major' ? 'mesh-major' : ''}`}>
                        {term.source}
                      </span>
                    </td>
                    <td>{term.doc_freq}/{result.articles?.length}</td>
                    <td>
                      <span className={`role-badge role-${term.suggested_role}`}>
                        {term.suggested_role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Queries */}
          <section className="queries-section">
            <div className="section-header">
              <h2>搜尋式建議</h2>
              <div className="export-buttons">
                <button className="btn btn-export" onClick={handleExportTxt}>
                  📄 導出 TXT
                </button>
                <button className="btn btn-export" onClick={handleExportCsv}>
                  📊 導出 CSV
                </button>
              </div>
            </div>
            <div className="queries-explanation">
              <h3>搜尋式版本說明</h3>
              <div className="query-type-info">
                <span className="query-icon">🔍</span>
                <div>
                  <strong>Sensitive Version（敏感版）</strong>
                  <p>使用較多的同義詞、廣義詞和截斷符號，最大化召回率（Recall）。適合需要全面檢索、不想遺漏任何相關文獻的情況，但可能會撈到較多不相關的結果。</p>
                </div>
              </div>
              <div className="query-type-info">
                <span className="query-icon">⚖️</span>
                <div>
                  <strong>Balanced Version（平衡版）</strong>
                  <p>在召回率和精確率之間取得平衡，使用核心 MeSH 詞彙加上關鍵自由詞。適合一般系統性文獻回顧使用。</p>
                </div>
              </div>
              <div className="query-type-info">
                <span className="query-icon">🎯</span>
                <div>
                  <strong>Compact Version（精簡版）</strong>
                  <p>只使用最核心、最具特異性的詞彙，最大化精確率（Precision）。結果較少但相關性高，適合快速檢索或初步探索。</p>
                </div>
              </div>

              <h3 className="metrics-title">指標說明</h3>
              <div className="metrics-explanation">
                <div className="metric-info">
                  <strong>命中數（Hit Count）</strong>
                  <p>該搜尋式在 PubMed 中找到的文獻總數。數字越大代表撈到的文獻越多，需要篩選的工作量也越大。</p>
                </div>
                <div className="metric-info">
                  <strong>涵蓋率（Coverage）</strong>
                  <p>您輸入的重要文獻中，有多少被這個搜尋式成功找到。例如「3/3 ✓」表示 3 篇重要文獻全部被涵蓋，這是理想的結果。</p>
                </div>
                <div className="metric-info">
                  <strong>NNT（Number Needed to Screen）</strong>
                  <p>平均需要篩選多少篇文獻才能找到一篇重要文章。數字越小代表搜尋效率越高。例如 NNT=100 表示平均每篩 100 篇可找到 1 篇目標文獻。</p>
                </div>
              </div>
            </div>
            {result.queries?.map(query => (
              <div key={query.id} className="query-card">
                <div className="query-header">
                  <span className="query-title">
                    {query.id === 'sensitive' ? '🔍' : query.id === 'balanced' ? '⚖️' : '🎯'}
                    {query.label}
                  </span>
                  <div className="query-stats">
                    <span className="stat">
                      <span className="stat-label">命中數：</span>
                      <span className={`stat-value ${query.hit_count > 5000 ? 'warning' : ''}`}>
                        {query.hit_count?.toLocaleString() || 'N/A'}
                      </span>
                    </span>
                    <span className="stat">
                      <span className="stat-label">涵蓋率：</span>
                      <span className={`stat-value ${query.covers_all_gold ? 'success' : 'error'}`}>
                        {query.quality_metrics?.coverage_rate || 'N/A'}
                        {query.covers_all_gold ? ' ✓' : ' ✗'}
                      </span>
                    </span>
                    {query.quality_metrics?.nnt && (
                      <span className="stat">
                        <span className="stat-label">NNT：</span>
                        <span className="stat-value">{query.quality_metrics.nnt}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="query-body">
                  {query.description && (
                    <p className="query-description">{query.description}</p>
                  )}

                  {/* 資料庫選擇 Tabs */}
                  <div className="database-tabs">
                    {result.databases?.map(db => (
                      <button
                        key={db.id}
                        className={`db-tab ${selectedDatabase === db.id ? 'active' : ''}`}
                        onClick={() => setSelectedDatabase(db.id)}
                        title={db.note || db.description}
                      >
                        {db.name}
                        {db.canValidate && <span className="validate-badge">✓</span>}
                      </button>
                    ))}
                  </div>

                  {/* 搜尋式顯示 */}
                  <div className="query-string">
                    <button
                      className={`copy-btn ${copiedId === `${query.id}-${selectedDatabase}` ? 'copied' : ''}`}
                      onClick={() => handleCopy(
                        query.translations?.[selectedDatabase] || query.query_string,
                        `${query.id}-${selectedDatabase}`
                      )}
                    >
                      {copiedId === `${query.id}-${selectedDatabase}` ? '已複製!' : '複製'}
                    </button>
                    {query.translations?.[selectedDatabase] || query.query_string}
                  </div>

                  {/* 資料庫連結 */}
                  {result.databases?.find(db => db.id === selectedDatabase)?.searchUrl && selectedDatabase === 'pubmed' && (
                    <a
                      href={`${result.databases.find(db => db.id === selectedDatabase).searchUrl}${encodeURIComponent(query.query_string)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="search-link"
                    >
                      在 PubMed 中執行此搜尋 →
                    </a>
                  )}

                  {selectedDatabase !== 'pubmed' && (
                    <div className="database-note">
                      📋 請複製上方搜尋式，到 {result.databases?.find(db => db.id === selectedDatabase)?.name} 網站手動搜尋
                      {result.databases?.find(db => db.id === selectedDatabase)?.note && (
                        <span className="note-warning"> ({result.databases.find(db => db.id === selectedDatabase).note})</span>
                      )}
                    </div>
                  )}

                  {query.missing_pmids?.length > 0 && selectedDatabase === 'pubmed' && (
                    <div className="missing-pmids">
                      ⚠️ 此搜尋式未涵蓋以下 PMID：{query.missing_pmids.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>

          {/* Disclaimer */}
          <div className="disclaimer">
            本工具基於您選擇的重要文獻自動生成搜尋式，仍建議搭配資訊專家 / librarian 與人工調整後使用。
          </div>
        </>
      )}
    </div>
  );
}

export default App;
