import React from 'react';
import { DEFAULT_PROVIDERS } from '../hooks/useLLMConfig';

/**
 * 進階設定組件 - LLM Provider 設定
 */
function AdvancedSettings({
  showAdvanced,
  setShowAdvanced,
  llmConfig,
  setLlmConfig,
  testingLlm,
  llmTestResult,
  isProduction,
  handleProviderChange,
  handleTestLlm,
  currentProviderConfig
}) {
  // 在生產環境中過濾掉 custom provider
  const availableProviders = Object.entries(DEFAULT_PROVIDERS).filter(
    ([key]) => !isProduction || key !== 'custom'
  );

  return (
    <>
      <div className="advanced-toggle">
        <button
          className="btn-link"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
          aria-controls="advanced-settings-panel"
        >
          {showAdvanced ? '▼ 隱藏進階設定' : '▶ 進階設定（更換 LLM）'}
        </button>
      </div>

      {showAdvanced && (
        <div
          id="advanced-settings-panel"
          className="advanced-settings"
          role="region"
          aria-label="LLM 進階設定"
        >
          <h3>LLM Provider 設定</h3>
          <p className="hint">
            預設使用免費的 Groq API。您也可以使用自己的 API key 切換到其他 LLM。
            {isProduction && (
              <span className="production-note">
                （生產環境：自訂 API 端點已停用）
              </span>
            )}
          </p>

          <div className="settings-grid">
            <div className="setting-row">
              <label htmlFor="llm-provider">Provider</label>
              <select
                id="llm-provider"
                value={llmConfig.provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                aria-describedby="provider-description"
              >
                {availableProviders.map(([key, config]) => (
                  <option key={key} value={key}>{config.name}</option>
                ))}
              </select>
            </div>

            <div className="setting-row">
              <label htmlFor="llm-api-key">
                API Key {llmConfig.provider === 'groq' && '(可選)'}
              </label>
              <input
                id="llm-api-key"
                type="password"
                value={llmConfig.apiKey}
                onChange={(e) => setLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                placeholder={llmConfig.provider === 'groq' ? '留空使用預設 key' : '輸入你的 API key'}
                aria-describedby="api-key-description"
                autoComplete="off"
              />
            </div>

            {llmConfig.provider === 'custom' && !isProduction && (
              <div className="setting-row">
                <label htmlFor="llm-base-url">Base URL</label>
                <input
                  id="llm-base-url"
                  type="text"
                  value={llmConfig.baseURL}
                  onChange={(e) => setLlmConfig({ ...llmConfig, baseURL: e.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </div>
            )}

            <div className="setting-row">
              <label htmlFor="llm-model">Model</label>
              {currentProviderConfig?.models?.length > 0 ? (
                <select
                  id="llm-model"
                  value={llmConfig.model || currentProviderConfig.defaultModel}
                  onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
                >
                  {currentProviderConfig.models.map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="llm-model"
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
              aria-busy={testingLlm}
            >
              {testingLlm ? '測試中...' : '測試連線'}
            </button>
            {llmTestResult && (
              <span
                className={`test-result ${llmTestResult.success ? 'success' : 'error'}`}
                role="status"
                aria-live="polite"
              >
                {llmTestResult.message}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default AdvancedSettings;
