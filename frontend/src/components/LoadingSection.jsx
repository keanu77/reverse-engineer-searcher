import React from 'react';

// 載入步驟定義
const LOADING_STEPS = [
  { id: 'fetch', label: '正在從 PubMed 取得文章資料...', progress: 20 },
  { id: 'analyze', label: '正在分析 MeSH 詞彙與關鍵字...', progress: 40 },
  { id: 'classify', label: '正在使用 AI 進行 PICO 分類...', progress: 60 },
  { id: 'generate', label: '正在生成搜尋策略...', progress: 80 },
  { id: 'validate', label: '正在驗證搜尋式涵蓋率...', progress: 95 }
];

/**
 * 載入進度組件
 */
function LoadingSection({ loadingStep, loadingProgress }) {
  return (
    <div className="loading-section" role="status" aria-live="polite" aria-busy="true">
      <div className="progress-container">
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuenow={loadingProgress}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            className="progress-fill"
            style={{ width: `${loadingProgress}%` }}
          />
        </div>
        <span className="progress-text" aria-hidden="true">{loadingProgress}%</span>
      </div>
      <div className="loading-steps">
        {LOADING_STEPS.map((step, index) => (
          <div
            key={step.id}
            className={`loading-step ${index < loadingStep ? 'completed' : index === loadingStep ? 'active' : ''}`}
          >
            <span className="step-icon" aria-hidden="true">
              {index < loadingStep ? '✓' : index === loadingStep ? '⏳' : '○'}
            </span>
            <span className="step-label">{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { LOADING_STEPS };
export default LoadingSection;
