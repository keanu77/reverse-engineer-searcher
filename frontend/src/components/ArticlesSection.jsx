import React from 'react';

/**
 * 文章列表組件 - 顯示重要文獻
 */
function ArticlesSection({ articles }) {
  if (!articles || articles.length === 0) {
    return null;
  }

  return (
    <section className="articles-section" aria-labelledby="articles-heading">
      <h2 id="articles-heading">重要文獻確認 ({articles.length} 篇)</h2>
      <div role="list">
        {articles.map(article => (
          <div
            key={article.pmid}
            className="article-card"
            role="listitem"
          >
            <div className="article-header">
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="article-pmid-link"
                aria-label={`在 PubMed 查看 PMID ${article.pmid}`}
              >
                PMID: {article.pmid} ↗
              </a>
            </div>
            <p className="article-title">{article.title}</p>
            <p className="article-meta">{article.journal}, {article.year}</p>
            {article.mesh_major?.length > 0 && (
              <div className="article-mesh">
                <span className="mesh-label">MeSH Major:</span>
                {article.mesh_major.slice(0, 5).map((mesh, i) => (
                  <span key={i} className="mesh-tag">{mesh}</span>
                ))}
                {article.mesh_major.length > 5 && (
                  <span className="mesh-more">+{article.mesh_major.length - 5} more</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default ArticlesSection;
