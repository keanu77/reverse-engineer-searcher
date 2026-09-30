import React, { useState } from 'react';

const STATUS_TEXT = {
  verified: { label: '已驗證', tone: 'success' },
  unreliable: { label: '結果僅供參考', tone: 'warning' },
  skipped: { label: '檢索式有錯誤，未驗證', tone: 'error' },
  failed: { label: '驗證失敗，涵蓋未知', tone: 'warning' },
};

const coverageTone = (ratio) => (ratio == null ? '' : ratio === 1 ? 'success' : 'error');

/**
 * 單一搜尋式卡片組件
 * 上方指標一律是 PubMed 驗證結果；其他資料庫只提供語法翻譯與警告。
 */
function QueryCard({ query, databases, onCopy, copiedId }) {
  const [selectedDatabase, setSelectedDatabase] = useState('pubmed');
  const metrics = query.quality_metrics || {};
  const status = STATUS_TEXT[query.validation_status] || STATUS_TEXT.failed;
  const selectedDb = databases?.find(db => db.id === selectedDatabase);
  const queryText = query.translations?.[selectedDatabase];
  const dbWarnings = query.translation_warnings?.[selectedDatabase] || [];
  const copyKey = `${query.id}-${selectedDatabase}`;
  const queryIcon = query.id === 'sensitive' ? '🔍' : query.id === 'balanced' ? '⚖️' : '🎯';

  return (
    <div className="query-card" role="article" aria-labelledby={`query-title-${query.id}`}>
      <div className="query-header">
        <span id={`query-title-${query.id}`} className="query-title">
          {queryIcon} {query.label}
        </span>
        <div className="query-stats" aria-label="PubMed 驗證結果">
          <span className={`stat status-${status.tone}`}>PubMed：{status.label}</span>
          <span className="stat">
            <span className="stat-label">命中數：</span>
            <span className="stat-value">{query.hit_count != null ? query.hit_count.toLocaleString() : '未知'}</span>
          </span>
          <span className="stat" title="只代表這組種子文獻，不是對所有相關文獻的召回率">
            <span className="stat-label">種子涵蓋：</span>
            <span className={`stat-value ${coverageTone(metrics.seed_coverage_ratio)}`}>{metrics.seed_coverage ?? '未知'}</span>
          </span>
          {'validation_coverage' in metrics && (
            <span className="stat" title="驗證組未參與建構檢索式">
              <span className="stat-label">驗證組涵蓋：</span>
              <span className={`stat-value ${coverageTone(metrics.validation_coverage_ratio)}`}>{metrics.validation_coverage ?? '未知'}</span>
            </span>
          )}
          {metrics.hits_per_seed != null && (
            <span className="stat" title="命中數除以已涵蓋的種子文獻數：篩選工作量參考，不是精確度">
              <span className="stat-label">每篇種子命中：</span>
              <span className="stat-value">{metrics.hits_per_seed.toLocaleString()}</span>
            </span>
          )}
        </div>
      </div>

      <div className="query-body">
        {query.description && <p className="query-description">{query.description}</p>}

        {query.lint_errors?.length > 0 && (
          <div className="query-issues error" role="alert">
            {query.lint_errors.map((e, i) => <p key={i}>⛔ {e}</p>)}
          </div>
        )}
        {(query.lint_warnings?.length > 0 || query.pubmed_errors?.length > 0 || query.pubmed_warnings?.length > 0) && (
          <div className="query-issues warning" role="note">
            {[...(query.pubmed_errors || []), ...(query.pubmed_warnings || []), ...(query.lint_warnings || [])]
              .map((w, i) => <p key={i}>⚠️ {w}</p>)}
          </div>
        )}

        <div className="database-tabs" role="tablist" aria-label="選擇資料庫">
          {databases?.map(db => (
            <button
              key={db.id}
              role="tab"
              className={`db-tab ${selectedDatabase === db.id ? 'active' : ''}`}
              onClick={() => setSelectedDatabase(db.id)}
              title={db.note || db.description}
              aria-selected={selectedDatabase === db.id}
              aria-controls={`query-panel-${query.id}-${db.id}`}
            >
              {db.name}
              {db.canValidate && <span className="validate-badge" aria-label="可驗證">✓</span>}
              {query.translation_warnings?.[db.id]?.length > 0 && (
                <span className="warn-badge" aria-label="有翻譯警告">!</span>
              )}
            </button>
          ))}
        </div>

        <div id={`query-panel-${query.id}-${selectedDatabase}`} className="query-string" role="tabpanel">
          {queryText ? (
            <>
              <button
                className={`copy-btn ${copiedId === copyKey ? 'copied' : ''}`}
                onClick={() => onCopy?.(queryText, copyKey)}
                aria-label={copiedId === copyKey ? '已複製' : '複製搜尋式'}
              >
                {copiedId === copyKey ? '已複製!' : '複製'}
              </button>
              <code>{queryText}</code>
            </>
          ) : (
            <p className="query-unavailable">{query.translation_error || '此檢索式有錯誤，未產生翻譯'}</p>
          )}
        </div>

        {selectedDatabase === 'pubmed' && queryText && selectedDb?.searchUrl && (
          <a
            href={`${selectedDb.searchUrl}${encodeURIComponent(query.query_string)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="search-link"
            aria-label="在 PubMed 中執行此搜尋（開新分頁）"
          >
            在 PubMed 中執行此搜尋 →
          </a>
        )}

        {selectedDatabase === 'pubmed' && query.query_translation && (
          <details className="query-translation">
            <summary>PubMed 實際執行的查詢（Search Details）</summary>
            <code>{query.query_translation}</code>
          </details>
        )}

        {selectedDatabase !== 'pubmed' && (
          <div className="database-note" role="note">
            <p>
              📋 語法草稿：請複製到 {selectedDb?.name} 手動檢索，並用種子文獻確認能被找到。上方數字是 PubMed 的結果，此資料庫未驗證。
              {selectedDb?.note && <span className="note-warning">（{selectedDb.note}）</span>}
            </p>
            {dbWarnings.length > 0 && (
              <ul className="translation-warnings">
                {dbWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        {query.missing_pmids?.length > 0 && selectedDatabase === 'pubmed' && (
          <div className="missing-pmids" role="alert">
            ⚠️ 未涵蓋的種子文獻：{query.missing_pmids.join(', ')}
          </div>
        )}
        {query.validation_set?.missing?.length > 0 && selectedDatabase === 'pubmed' && (
          <div className="missing-pmids" role="alert">
            ⚠️ 未涵蓋的驗證組文獻：{query.validation_set.missing.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

export default QueryCard;
