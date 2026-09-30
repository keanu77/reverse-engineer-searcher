import React, { useState } from "react";
import QueryCard from "./QueryCard";

const STRATEGY_TEXT = {
  sensitive: "同義詞與截字最多，目標是少漏掉文獻；命中數通常最大。",
  balanced: "核心 MeSH 加上主要自由詞，兼顧涵蓋與篩選量。",
  compact: "只留最專一的詞，命中數最少，適合快速探索，較可能漏掉文獻。",
};

/**
 * 搜尋式區段：三種策略以分頁切換，一次顯示一條
 */
function QueriesSection({ queries, databases, onCopy, copiedId, onExportTxt, onExportCsv, onExportRis }) {
  const [activeId, setActiveId] = useState(queries?.[0]?.id);
  if (!queries || queries.length === 0) return null;
  const active = queries.find((q) => q.id === activeId) || queries[0];

  const onKeyDown = (event) => {
    const index = queries.findIndex((q) => q.id === active.id);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = queries[(next + queries.length) % queries.length];
    setActiveId(target.id);
    document.getElementById(`strategy-tab-${target.id}`)?.focus();
  };

  return (
    <section className="queries-section" id="section-queries" aria-labelledby="queries-heading">
      <div className="section-header">
        <h2 id="queries-heading">檢索式</h2>
        <div className="export-buttons" role="group" aria-label="匯出選項">
          <button className="btn btn-export" onClick={onExportTxt} aria-label="匯出為純文字檔案">匯出 TXT</button>
          <button className="btn btn-export" onClick={onExportCsv} aria-label="匯出為 CSV 試算表">匯出 CSV</button>
          <button className="btn btn-export" onClick={onExportRis} aria-label="匯出種子文獻為 RIS 文獻管理格式">種子文獻 RIS</button>
        </div>
      </div>

      <div className="strategy-tabs" role="tablist" aria-label="檢索策略" onKeyDown={onKeyDown}>
        {queries.map((q) => (
          <button
            key={q.id}
            id={`strategy-tab-${q.id}`}
            role="tab"
            aria-selected={q.id === active.id}
            aria-controls={`strategy-panel-${q.id}`}
            tabIndex={q.id === active.id ? 0 : -1}
            className={`strategy-tab ${q.id === active.id ? "active" : ""}`}
            onClick={() => setActiveId(q.id)}
          >
            <span className="strategy-name">{q.label.replace(" Version", "")}</span>
            <span className="strategy-meta">
              {q.hit_count != null ? `${q.hit_count.toLocaleString()} 筆` : "命中未知"}
              {" · 種子 "}
              {q.quality_metrics?.seed_coverage ?? "未知"}
            </span>
          </button>
        ))}
      </div>

      <div id={`strategy-panel-${active.id}`} role="tabpanel" aria-labelledby={`strategy-tab-${active.id}`}>
        {STRATEGY_TEXT[active.id] && <p className="strategy-intent">策略意圖：{STRATEGY_TEXT[active.id]}</p>}
        <QueryCard key={active.id} query={active} databases={databases} onCopy={onCopy} copiedId={copiedId} />
      </div>

      <details className="metrics-help">
        <summary>指標怎麼看</summary>
        <dl>
          <dt>PubMed 命中數</dt>
          <dd>檢索式在 PubMed 找到的總筆數，代表篩選工作量。</dd>
          <dt>種子涵蓋</dt>
          <dd>種子文獻中有幾篇被找到。檢索式就是從這些文獻建構的，所以接近 100% 是預期結果，不代表對其他相關文獻的召回率。</dd>
          <dt>驗證組涵蓋</dt>
          <dd>未參與建構的驗證組文獻中有幾篇被找到，較能反映檢索式對沒看過文獻的表現（參考 Hausner et al. 2012 的開發／驗證分組）。</dd>
          <dt>每篇種子命中</dt>
          <dd>命中數除以已找到的種子篇數，僅供估計篩選量；不是精確度，也不是臨床的 NNT。</dd>
          <dt>其他資料庫</dt>
          <dd>Embase、Cochrane、WoS、Scopus 只提供語法草稿，數字都是 PubMed 的結果；請在各資料庫用種子文獻確認能被找到。</dd>
        </dl>
      </details>
    </section>
  );
}

export default QueriesSection;
