# Reverse-Engineer Searcher

反向工程搜尋字串生成器 - 從金標準文獻自動產生 PubMed 搜尋策略

## 專案結構

```
.
├── backend/                 # Node.js + Express 後端
│   ├── src/
│   │   ├── index.js         # 入口點
│   │   ├── routes/
│   │   │   └── searchBuilder.js  # API 路由
│   │   └── modules/
│   │       ├── PubMedClient.js   # PubMed API 封裝
│   │       ├── TermAnalyzer.js   # Term 統計分析
│   │       ├── LLMService.js     # 多 LLM 支援
│   │       └── QueryValidator.js # 搜尋式驗證
│   ├── .env                 # 環境變數 (已設定 Groq)
│   └── package.json
├── frontend/                # React + Vite 前端
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx          # 含進階 LLM 設定
│   │   └── index.css
│   └── package.json
└── start.sh                 # 一鍵啟動腳本
```

## 快速開始

### 1. 啟動服務

```bash
# 方法一：使用啟動腳本
./start.sh

# 方法二：分別啟動
cd backend && npm run dev    # Terminal 1
cd frontend && npm run dev   # Terminal 2
```

### 2. 開啟瀏覽器
http://localhost:3000

### 3. 使用方式
1. 輸入 3-5 個金標準文獻的 PMID
2. 點擊「生成搜尋字串」
3. 查看生成的三種搜尋式（Sensitive / Balanced / Compact）
4. 複製適合的搜尋式到 PubMed 使用

## 支援的 LLM Providers

| Provider | 說明 | 免費 |
|----------|------|------|
| **Groq** | 預設，使用 Llama 3.3 70B | ✅ |
| OpenAI | GPT-4o / GPT-4o-mini | ❌ |
| Gemini | Google Gemini 2.0 Flash | ✅ |
| Grok | xAI Grok | ❌ |
| Custom | 任何 OpenAI 相容 API | - |

### 進階設定

在前端點擊「進階設定（更換 LLM）」可以：
- 切換不同的 LLM provider
- 輸入自己的 API key
- 選擇不同的模型
- 測試 LLM 連線

## API 端點

### POST /api/search-builder/from-pmids
根據 PMIDs 生成搜尋策略

**Request:**
```json
{
  "pmids": ["12345678", "23456789"],
  "options": { "maxTermsPerBlock": 10 },
  "llmConfig": {
    "provider": "openai",
    "apiKey": "sk-xxx",
    "model": "gpt-4o"
  }
}
```

### POST /api/search-builder/validate-query
驗證單一搜尋式是否涵蓋金標準文章

### GET /api/search-builder/fetch-article/:pmid
取得單一文章資訊

### POST /api/search-builder/test-llm
測試 LLM API 連線

### GET /api/search-builder/providers
取得支援的 LLM providers 列表

## 環境變數

```bash
# LLM 設定（預設使用 Groq）
LLM_PROVIDER=groq
GROQ_API_KEY=xxx

# 其他 LLM（可選）
OPENAI_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=

# PubMed（可選，提高 rate limit）
PUBMED_API_KEY=

# Server
PORT=3001
```

## 技術棧
- 後端: Node.js, Express, OpenAI SDK（相容多 LLM）, PubMed E-utilities
- 前端: React 18, Vite, Axios
- LLM: Groq (Llama 3.3), OpenAI, Gemini, Grok
