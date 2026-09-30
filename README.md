# Reverse-Engineer Searcher

反向工程搜尋字串生成器 - 從金標準文獻自動產生 PubMed 搜尋策略

## Demo

線上體驗：[反向工程搜尋字串生成器](https://reverse-searcher.zeabur.app)

## 功能特色

- **自動生成搜尋策略**：輸入種子文獻的 PMIDs，分析 MeSH 詞彙與關鍵字，由 LLM 產生三種版本的 PubMed 檢索式（Sensitive／Balanced／Compact 是策略意圖，不保證召回或精確度）
- **PubMed 驗證**：以「檢索式 AND 種子 PMID」的交集判斷涵蓋，不受 ESearch 只回傳前 10,000 筆的限制；PubMed 回報的找不到片語、實際執行的查詢（Search Details）都會顯示
- **驗證組（選填）**：另給未參與建構的 PMID，獨立檢查檢索式對「沒看過的文獻」的涵蓋，對應 Hausner et al. (2012) 客觀法的開發／驗證分組概念
- **多資料庫語法草稿**：先解析 PubMed 語法再轉為 Embase (Ovid)、Cochrane Library、Web of Science、Scopus；MeSH→Emtree、出版類型等無法等價轉換之處都附警告，須在各資料庫確認
- **AI 科普文章生成**：以使用者提供的主要文獻為核心、檢索結果為輔；送入完整摘要，逐句標註 PMID，程式固定附加免責聲明，並檢查未知引用、摘要中沒有的數字與絕對化療效用語
- **多 LLM 支援**：預設使用 Groq API（依帳號可用模型與額度），也支援 OpenAI、Gemini、Grok 等

## 技術棧

- **後端**: Node.js, Express, OpenAI SDK（相容多 LLM）, PubMed E-utilities
- **前端**: React 18, Vite, Axios
- **LLM**: Groq (GPT-OSS), OpenAI, Gemini, Grok

## 快速開始

### 本地開發

使用 Node.js 22.12 以上版本，建議 Node.js 24 LTS。開發後端僅綁定 `127.0.0.1`。

```bash
# 1. Clone 專案
git clone https://github.com/keanu77/reverse-engineer-searcher.git
cd reverse-engineer-searcher

# 2. 設定環境變數
cp backend/.env.example backend/.env
# 編輯 backend/.env 填入 API keys

# 3. 安裝依賴
cd backend && npm ci
cd ../frontend && npm ci
cd ..

# 4. 啟動服務
./start.sh
# 或分別啟動：
# cd backend && npm run dev
# cd frontend && npm run dev

# 5. 開啟瀏覽器
# http://localhost:3000
```

### Zeabur 部署

1. Fork 此 repo
2. 在 Zeabur 建立新專案，連結 GitHub repo
3. 設定環境變數：
   - `GROQ_API_KEY`: Groq API Key（帳號與額度：https://console.groq.com）
   - `LLM_PROVIDER`: groq（預設）
   - `AUTH_API_KEY`: 隨機服務存取碼（至少 32 隨機位元組），使用管理者 API 額度時必填；與 provider API Key 分開設定
4. 部署完成！

## 環境變數

| 變數 | 說明 | 必填 |
|------|------|------|
| `GROQ_API_KEY` | 管理者 Groq API Key | 使用管理者額度時 |
| `AUTH_API_KEY` | 服務存取碼，與 provider key 分開 | 使用管理者額度時 |
| `LLM_PROVIDER` | LLM 提供者（groq/openai/gemini/grok） | 否（預設 groq） |
| `OPENAI_API_KEY` | OpenAI API Key | 否 |
| `GEMINI_API_KEY` | Google Gemini API Key | 否 |
| `XAI_API_KEY` | xAI API Key | 否 |
| `PUBMED_API_KEY` | PubMed API Key（提高 rate limit） | 否 |
| `NODE_ENV` | 正式部署設定為 production | 正式環境 |
| `PORT` | 服務監聽 port | 否（預設 3001） |
| `ALLOWED_ORIGINS` | 逗號分隔的前端來源 | 僅跨來源部署 |

## 使用說明

1. 輸入 3–10 個種子文獻的 PMID（數字、`PMID: 123` 或 PubMed 網址；PMCID 與 DOI 會被退回）
2. （建議）在「驗證組」輸入幾篇同樣應被找到、但不拿來建構的 PMID
3. 點擊「生成搜尋字串」，檢查每條策略的 PubMed 驗證狀態、種子涵蓋、驗證組涵蓋與警告
4. 切換資料庫標籤複製語法草稿，並在該資料庫用種子文獻確認能被找到
5. （可選）生成科普文章，發布前處理「發布前請先處理」中的每一項

種子涵蓋率只代表這組種子文獻，不是對所有相關文獻的召回率。正式系統性回顧仍需資訊專家審閱（例如 PRESS）與完整的檢索紀錄。

## API 端點

- `POST /api/search-builder/from-pmids` - 生成搜尋策略
- `POST /api/search-builder/generate-blog` - 生成科普文章
- `GET /api/search-builder/fetch-article/:pmid` - 取得文章資訊
- `POST /api/search-builder/test-llm` - 測試 LLM 連線

## 授權

MIT License

## 作者

運動醫學科吳易澄醫師 - [Blog](https://blog.sportsmedicine.tw/)

## API Key 與服務存取

- 自備 API Key（BYOK）：在「進階設定」輸入所選 provider 的 key；可不輸入服務存取碼。這個 key 只用於該次請求，失敗不會轉用管理者的 key。
- 使用管理者額度：伺服器同時設定 provider key 與 `AUTH_API_KEY`；使用者在「進階設定」輸入服務存取碼。缺少或錯誤存取碼時，在呼叫 PubMed／LLM 前拒絕生成。程式介面以 `X-Service-Token` header 傳送存取碼。
- 未設定 `AUTH_API_KEY` 時，管理者 key 不會提供給匿名請求；網站仍可接受使用者自備 key。
- 瀏覽器中的 key 與存取碼只保留在目前分頁的記憶體，不寫入 localStorage／sessionStorage。重新整理後清除；切換 provider 會清除 key 與自訂端點。
- 請求會先經本站後端，再傳給所選供應商；公開部署需使用 HTTPS。CORS 白名單不是身份認證。若前後端同來源，不需另設 `ALLOWED_ORIGINS`；跨來源部署請明確列出前端網址。
- 自訂端點與 Ollama 僅供本機開發使用，公開正式環境停用；自訂端點永遠不繼承管理者的環境 key。
- 健康檢查 `/health` 不消耗 API 限額。API 仍有每 IP 每分鐘 10 次限制；多副本部署的限制以各程序計算。未設定可信任代理時，反向代理後使用者可能共用代理 IP 額度，正式部署前須依實際拓撲驗證。

## 驗證

```bash
cd backend && npm ci && npm test -- --runInBand
cd ../frontend && npm ci && npm run build
npm audit
cd ../backend && npm audit
```

本次本機回歸以模擬的 PubMed／LLM 上游驗證流程與認證隔離，不代表已驗證每個供應商目前的模型可用性、真實 API key、醫學內容或正式部署。模型清單可在進階設定中選擇；使用前仍需向供應商確認。

### 2026-09-28 模型清單核對

Groq 的 Llama 3.3 70B 與 Llama 3.1 8B 已於 2026-08-16 對免費／開發者方案停用；預設模型改為官方替代方案 `openai/gpt-oss-120b`，另提供 `openai/gpt-oss-20b` 選項，移除舊 Llama／Mixtral 選項。來源：[Groq 停用公告](https://console.groq.com/docs/deprecations)、[目前模型清單](https://console.groq.com/docs/models)。

Groq GPT-OSS 的連線測試使用低推理量與 128 token 上限，並確認有實際回覆；只有 HTTP 成功但內容為空時，不會顯示連線成功。來源：[Groq 推理參數](https://console.groq.com/docs/reasoning)。

Gemini 預設從已關閉的 `gemini-2.0-flash` 更新為官方建議的 `gemini-3.6-flash`，移除舊 1.5 選項；Grok 預設改為官方遷移文件列出的 `grok-4.3`。來源：[Gemini 停用時程](https://ai.google.dev/gemini-api/docs/deprecations)、[xAI 遷移文件](https://docs.x.ai/developers/migration/may-15-retirement)。

上述為文件核對，不是使用真實帳號的連線驗證。明確選擇模型後，分類、搜尋式與文章生成都使用該選擇；不再私下改用較大的預設模型。
