# Reverse-Engineer Searcher

反向工程搜尋字串生成器 - 從金標準文獻自動產生 PubMed 搜尋策略

## Demo

線上體驗：[反向工程搜尋字串生成器](https://reverse-searcher.zeabur.app)

## 功能特色

- **自動生成搜尋策略**：輸入重要文獻的 PMIDs，自動分析 MeSH 詞彙並產生三種版本的搜尋式
  - Sensitive Version（敏感版）：最大化召回率
  - Balanced Version（平衡版）：精確率與召回率平衡
  - Compact Version（精簡版）：最大化精確率
- **多資料庫支援**：自動翻譯為 Embase, Cochrane, CINAHL 等資料庫語法
- **AI 科普文章生成**：以用戶提供的重要文獻為主軸（70-80%），搭配搜尋到的相關文獻為輔（20-30%），生成 2000-2500 字的科普衛教文章
- **多 LLM 支援**：預設使用 Groq API（依帳號可用模型與額度），也支援 OpenAI、Gemini、Grok 等

## 技術棧

- **後端**: Node.js, Express, OpenAI SDK（相容多 LLM）, PubMed E-utilities
- **前端**: React 18, Vite, Axios
- **LLM**: Groq (Llama 3.3), OpenAI, Gemini, Grok

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

1. 輸入 3-5 個金標準文獻的 PMID（以逗號、空格或換行分隔）
2. 點擊「生成搜尋字串」
3. 查看生成的三種搜尋式，選擇適合的版本
4. 切換不同資料庫標籤，複製對應語法
5. （可選）點擊「AI 科普文章生成」生成衛教文章

## API 端點

- `POST /api/search-builder/from-pmids` - 生成搜尋策略
- `POST /api/search-builder/generate-blog` - 生成科普文章
- `POST /api/search-builder/validate-query` - 驗證搜尋式
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

移除已停用的 Groq Mixtral／Llama 3.1 70B 選項，保留官方仍列出的 Llama 3.3 70B 與 Llama 3.1 8B（可用性取決於帳號授權）。來源：[Groq 停用公告](https://console.groq.com/docs/deprecations)、[目前模型清單](https://console.groq.com/docs/models)。

Gemini 預設從已關閉的 `gemini-2.0-flash` 更新為官方建議的 `gemini-3.6-flash`，移除舊 1.5 選項；Grok 預設改為官方遷移文件列出的 `grok-4.3`。來源：[Gemini 停用時程](https://ai.google.dev/gemini-api/docs/deprecations)、[xAI 遷移文件](https://docs.x.ai/developers/migration/may-15-retirement)。

上述為文件核對，不是使用真實帳號的連線驗證。明確選擇模型後，分類、搜尋式與文章生成都使用該選擇；不再私下改用較大的預設模型。
