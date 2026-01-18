import React from 'react';
import QueryCard from './QueryCard';

/**
 * 搜尋式區段組件
 */
function QueriesSection({ queries, databases, onCopy, copiedId, onExportTxt, onExportCsv }) {
  if (!queries || queries.length === 0) {
    return null;
  }

  return (
    <section className="queries-section" aria-labelledby="queries-heading">
      <div className="section-header">
        <h2 id="queries-heading">搜尋式建議</h2>
        <div className="export-buttons" role="group" aria-label="匯出選項">
          <button
            className="btn btn-export"
            onClick={onExportTxt}
            aria-label="匯出為純文字檔案"
          >
            📄 導出 TXT
          </button>
          <button
            className="btn btn-export"
            onClick={onExportCsv}
            aria-label="匯出為 CSV 試算表"
          >
            📊 導出 CSV
          </button>
        </div>
      </div>

      <div className="queries-explanation">
        <h3>搜尋式版本說明</h3>
        <div className="query-type-info">
          <span className="query-icon" aria-hidden="true">🔍</span>
          <div>
            <strong>Sensitive Version（敏感版）</strong>
            <p>使用較多的同義詞、廣義詞和截斷符號，最大化召回率（Recall）。適合需要全面檢索、不想遺漏任何相關文獻的情況，但可能會撈到較多不相關的結果。</p>
          </div>
        </div>
        <div className="query-type-info">
          <span className="query-icon" aria-hidden="true">⚖️</span>
          <div>
            <strong>Balanced Version（平衡版）</strong>
            <p>在召回率和精確率之間取得平衡，使用核心 MeSH 詞彙加上關鍵自由詞。適合一般系統性文獻回顧使用。</p>
          </div>
        </div>
        <div className="query-type-info">
          <span className="query-icon" aria-hidden="true">🎯</span>
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

      <div role="list" aria-label="搜尋式列表">
        {queries.map(query => (
          <QueryCard
            key={query.id}
            query={query}
            databases={databases}
            onCopy={onCopy}
            copiedId={copiedId}
          />
        ))}
      </div>
    </section>
  );
}

export default QueriesSection;
