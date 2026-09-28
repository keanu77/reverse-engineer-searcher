# 資安與憑證管理

## 本專案的資料邊界

搜尋服務會由後端呼叫 PubMed 與選定的 AI 供應商。使用者輸入的供應商 Key 與服務存取碼只保留在目前頁面記憶體，不應寫入瀏覽器儲存或分享網址。供應商 Key 會經本站後端送至選定供應商；請使用受信任的 HTTPS 部署。伺服器環境 Key 的使用需要驗證服務存取碼，不以 CORS 或限流代替授權。

## Key 與部署

- 真實 Key、服務存取碼、worker credential 不進 Git、前端 bundle、URL、範例資料或錯誤日誌。範例設定只放變數名稱與明確占位文字。
- 記錄錯誤類別、受控狀態碼與可追蹤資訊即可；不要列印完整 SDK／HTTP 錯誤、headers、request body 或含查詢參數的上游 URL。
- 憑證由後端部署環境或 repo 外的私人環境檔提供。公開 repo 不代表要公開執行中的服務權限。
- 發現真實憑證外洩時，先在供應商撤銷／輪替並檢查使用紀錄，再處理 Git 歷史。單純刪除目前檔案無法清除歷史中的憑證。請勿在公開 Issue 貼入秘密原值。

## 自動檢查

`.github/workflows/security-secrets.yml` 在 push／PR 或手動觸發時掃描完整取得的 Git 歷史。Gitleaks 固定 v8.30.1，下載檔案比對固定 SHA-256；checkout action 釘定提交，只有 contents:read 權限。掃描輸出遮蔽命中內容，不上傳含秘密的完整報告。

本機安裝同版 Gitleaks 後，在 repo 根目錄執行：

```sh
gitleaks git --log-opts="--all --full-history" --ignore-gitleaks-allow --redact=100 --no-banner --no-color .
```

掃描通過只代表該次規則沒有發現尚未排除的秘密，不保證沒有未辨識的憑證或部署設定問題。例外需逐筆驗證；不得整批排除所有測試、環境設定或歷史提交。

## 驗證範圍

2026-09-28 的程式驗證涵蓋 Git 歷史、目前原始碼與 build 產物掃描，以及模擬上游的認證隔離、錯誤處理和瀏覽器操作。本機通過不代表正式環境已更新；部署需核對 /version.json 或實際 bundle，並驗證 HTTPS、未授權請求和平台環境設定。正式 LLM 供應商的有效 Key、模型可用性、帳務限制與結果品質，需要在部署環境另外驗收。
