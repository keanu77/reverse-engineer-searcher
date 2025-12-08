# Reverse-Engineer Searcher

反向工程搜尋字串生成器 - 從金標準文獻自動產生 PubMed 搜尋策略

## Demo

線上體驗：[Zeabur 部署連結（部署後更新）]

## 功能特色

- **自動生成搜尋策略**：輸入重要文獻的 PMIDs，自動分析 MeSH 詞彙並產生三種版本的搜尋式
  - Sensitive Version（敏感版）：最大化召回率
  - Balanced Version（平衡版）：精確率與召回率平衡
  - Compact Version（精簡版）：最大化精確率
- **多資料庫支援**：自動翻譯為 Embase, Cochrane, CINAHL 等資料庫語法
- **AI 科普文章生成**：以用戶提供的重要文獻為主軸（70-80%），搭配搜尋到的相關文獻為輔（20-30%），生成 2000-2500 字的科普衛教文章
- **多 LLM 支援**：預設使用免費的 Groq API，也支援 OpenAI、Gemini、Grok 等

## 技術棧

- **後端**: Node.js, Express, OpenAI SDK（相容多 LLM）, PubMed E-utilities
- **前端**: React 18, Vite, Axios
- **LLM**: Groq (Llama 3.3), OpenAI, Gemini, Grok

## 快速開始

### 本地開發

```bash
# 1. Clone 專案
git clone https://github.com/your-username/reverse-engineer-searcher.git
cd reverse-engineer-searcher

# 2. 設定環境變數
cp backend/.env.example backend/.env
# 編輯 backend/.env 填入 API keys

# 3. 安裝依賴
cd backend && npm install
cd ../frontend && npm install

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
   - `GROQ_API_KEY`: Groq API Key（免費申請：https://console.groq.com）
   - `LLM_PROVIDER`: groq（預設）
4. 部署完成！

## 環境變數

| 變數 | 說明 | 必填 |
|------|------|------|
| `GROQ_API_KEY` | Groq API Key | 是（使用 Groq 時） |
| `LLM_PROVIDER` | LLM 提供者（groq/openai/gemini/grok） | 否（預設 groq） |
| `OPENAI_API_KEY` | OpenAI API Key | 否 |
| `GEMINI_API_KEY` | Google Gemini API Key | 否 |
| `PUBMED_API_KEY` | PubMed API Key（提高 rate limit） | 否 |

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
