import React, { useState } from 'react';

/**
 * 單一搜尋式卡片組件
 */
function QueryCard({ query, databases, onCopy, copiedId }) {
  const [selectedDatabase, setSelectedDatabase] = useState('pubmed');

  const handleCopy = async (text, queryId) => {
    if (onCopy) {
      onCopy(text, queryId);
    }
  };

  const queryIcon = query.id === 'sensitive' ? '🔍' : query.id === 'balanced' ? '⚖️' : '🎯';

  return (
    <div className="query-card" role="article" aria-labelledby={`query-title-${query.id}`}>
      <div className="query-header">
        <span id={`query-title-${query.id}`} className="query-title">
          {queryIcon} {query.label}
        </span>
        <div className="query-stats">
          <span className="stat">
            <span className="stat-label">命中數：</span>
            <span className={`stat-value ${query.hit_count > 5000 ? 'warning' : ''}`}>
              {query.hit_count?.toLocaleString() || 'N/A'}
            </span>
          </span>
          <span className="stat">
            <span className="stat-label">涵蓋率：</span>
            <span className={`stat-value ${query.covers_all_gold ? 'success' : 'error'}`}>
              {query.quality_metrics?.coverage_rate || 'N/A'}
              {query.covers_all_gold ? ' ✓' : ' ✗'}
            </span>
          </span>
          {query.quality_metrics?.nnt && (
            <span className="stat">
              <span className="stat-label">NNT：</span>
              <span className="stat-value">{query.quality_metrics.nnt}</span>
            </span>
          )}
        </div>
      </div>

      <div className="query-body">
        {query.description && (
          <p className="query-description">{query.description}</p>
        )}

        {/* 資料庫選擇 Tabs */}
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
            </button>
          ))}
        </div>

        {/* 搜尋式顯示 */}
        <div
          id={`query-panel-${query.id}-${selectedDatabase}`}
          className="query-string"
          role="tabpanel"
        >
          <button
            className={`copy-btn ${copiedId === `${query.id}-${selectedDatabase}` ? 'copied' : ''}`}
            onClick={() => handleCopy(
              query.translations?.[selectedDatabase] || query.query_string,
              `${query.id}-${selectedDatabase}`
            )}
            aria-label={copiedId === `${query.id}-${selectedDatabase}` ? '已複製' : '複製搜尋式'}
          >
            {copiedId === `${query.id}-${selectedDatabase}` ? '已複製!' : '複製'}
          </button>
          <code>{query.translations?.[selectedDatabase] || query.query_string}</code>
        </div>

        {/* 資料庫連結 */}
        {databases?.find(db => db.id === selectedDatabase)?.searchUrl && selectedDatabase === 'pubmed' && (
          <a
            href={`${databases.find(db => db.id === selectedDatabase).searchUrl}${encodeURIComponent(query.query_string)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="search-link"
            aria-label="在 PubMed 中執行此搜尋（開新分頁）"
          >
            在 PubMed 中執行此搜尋 →
          </a>
        )}

        {selectedDatabase !== 'pubmed' && (
          <div className="database-note" role="note">
            📋 請複製上方搜尋式，到 {databases?.find(db => db.id === selectedDatabase)?.name} 網站手動搜尋
            {databases?.find(db => db.id === selectedDatabase)?.note && (
              <span className="note-warning"> ({databases.find(db => db.id === selectedDatabase).note})</span>
            )}
          </div>
        )}

        {query.missing_pmids?.length > 0 && selectedDatabase === 'pubmed' && (
          <div className="missing-pmids" role="alert">
            ⚠️ 此搜尋式未涵蓋以下 PMID：{query.missing_pmids.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

export default QueryCard;
