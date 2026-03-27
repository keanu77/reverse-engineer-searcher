# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

反向工程搜尋字串生成器：從金標準文獻（PMIDs）自動產生 PubMed 搜尋策略（Sensitive / Balanced / Compact 三種版本），支援多資料庫語法翻譯，並可生成科普衛教文章。

## 開發指令

```bash
# 啟動開發環境（需要兩個 terminal）
cd backend && npm run dev     # 後端 :3001（node --watch）
cd frontend && npm run dev    # 前端 :3000（Vite）

# 或一鍵啟動
./start.sh

# 前端 build
cd frontend && npm run build

# 後端測試（ESM，需要 --experimental-vm-modules）
cd backend && node --experimental-vm-modules node_modules/jest/bin/jest.js

# 測試在 backend/tests/unit/ 下
```

## 架構

Monorepo，前後端分離，無根層級 package.json。

### 後端 (backend/) — Node.js + Express, ESM modules

核心處理流程在 `routes/searchBuilder.js` 的 `/from-pmids` 端點：
1. **PubMedClient** — 透過 E-utilities API 抓取文章（XML → JSON）
2. **TermAnalyzer** — 從 MeSH terms 和 keywords 統計詞頻
3. **LLMService** — 用 LLM 將 terms 分類為 PICO 角色，再生成三種搜尋式
4. **QueryValidator** — 回 PubMed 驗證搜尋式是否涵蓋所有金標準文章
5. **QueryTranslator** — 將 PubMed 語法翻譯為 Embase/Cochrane/CINAHL

LLMService 用 OpenAI SDK 統一介面，透過不同 baseURL 支援 Groq/OpenAI/Gemini/Grok/Ollama。前端可動態傳入 provider 和 API key，後端在 `sanitizeLLMConfig()` 做安全驗證（生產環境禁止 custom baseURL）。

### 前端 (frontend/) — React 18 + Vite

`App.jsx` 是主元件，已拆分為多個子元件（`components/` 下）。兩個 custom hooks：
- `useLLMConfig` — 管理 LLM provider 切換狀態
- `useBlogGeneration` — 管理科普文章生成流程

## 部署 (Zeabur)

生產環境將前端 build 產物放到 `backend/public/`，由 Express 提供靜態檔案服務。`zeabur.yaml` 定義 build/start 指令、健康檢查（`/health`）和資源限制。

## 環境變數

後端 `.env` 檔（參考 `.env.example`）：
- `LLM_PROVIDER` / `GROQ_API_KEY` — 預設 LLM（Groq）
- `PUBMED_API_KEY` — 可選，提高 PubMed rate limit
- `PORT` — 預設 3001
- `ALLOWED_ORIGINS` — 生產環境 CORS 白名單
