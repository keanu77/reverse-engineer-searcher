import { useState, useEffect } from "react";
import axios from "axios";

// 預設的 LLM Provider 設定
export const DEFAULT_PROVIDERS = {
  groq: {
    name: "Groq (免費)",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "mixtral-8x7b-32768",
    ],
  },
  openai: {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  gemini: {
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  },
  grok: {
    name: "Grok (xAI)",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-beta",
    models: ["grok-beta"],
  },
  ollama: {
    name: "Ollama (本機)",
    baseURL: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    models: ["llama3.2", "llama3.1", "mistral", "codellama"],
  },
  custom: {
    name: "自訂 API",
    baseURL: "",
    defaultModel: "",
    models: [],
  },
};

/**
 * 自訂 Hook 管理 LLM 配置
 */
export function useLLMConfig() {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [llmConfig, setLlmConfig] = useState({
    provider: "groq",
    apiKey: "",
    baseURL: "",
    model: "",
  });
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState(null);
  const [isProduction, setIsProduction] = useState(false);

  // 啟動時從後端取得 isProduction 狀態
  useEffect(() => {
    axios
      .get("/api/search-builder/providers")
      .then((res) => {
        if (res.data?.isProduction != null) {
          setIsProduction(res.data.isProduction);
        }
      })
      .catch(() => {
        // 取不到就用預設值，不影響使用
      });
  }, []);

  const handleProviderChange = (provider) => {
    const config = DEFAULT_PROVIDERS[provider];
    setLlmConfig({
      ...llmConfig,
      provider,
      baseURL: provider === "custom" ? llmConfig.baseURL : "",
      model: config?.defaultModel || "",
    });
    setLlmTestResult(null);
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    setLlmTestResult(null);

    try {
      const response = await axios.post("/api/search-builder/test-llm", {
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey || undefined,
        baseURL: llmConfig.baseURL || undefined,
        model: llmConfig.model || undefined,
      });

      setLlmTestResult({
        success: true,
        message: `連線成功! Provider: ${response.data.provider}, Model: ${response.data.model}`,
      });
    } catch (err) {
      setLlmTestResult({
        success: false,
        message: err.response?.data?.error || err.message || "連線失敗",
      });
    } finally {
      setTestingLlm(false);
    }
  };

  const currentProviderConfig = DEFAULT_PROVIDERS[llmConfig.provider];

  // 獲取用於 API 請求的 LLM 配置
  const getLlmConfigForRequest = () => {
    if (llmConfig.apiKey || llmConfig.provider !== "groq") {
      return {
        provider: llmConfig.provider,
        apiKey: llmConfig.apiKey || undefined,
        baseURL: llmConfig.baseURL || undefined,
        model: llmConfig.model || undefined,
      };
    }
    return null;
  };

  return {
    showAdvanced,
    setShowAdvanced,
    llmConfig,
    setLlmConfig,
    testingLlm,
    llmTestResult,
    isProduction,
    setIsProduction,
    handleProviderChange,
    handleTestLlm,
    currentProviderConfig,
    getLlmConfigForRequest,
  };
}

export default useLLMConfig;
