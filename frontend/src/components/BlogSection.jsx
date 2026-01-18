import React from 'react';
import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';

/**
 * 部落格生成區段組件
 */
function BlogSection({
  queries,
  blogTopic,
  setBlogTopic,
  blogLoading,
  blogResult,
  blogError,
  onGenerateBlog,
  onCopyBlog,
  onExportBlogMd,
  copiedId
}) {
  if (!queries || queries.length === 0) {
    return null;
  }

  return (
    <section className="blog-section" aria-labelledby="blog-heading">
      <h2 id="blog-heading">AI 科普文章生成</h2>
      <p className="section-description">
        以您提供的重要文獻為主軸（佔 70-80%），搭配搜尋到的相關文獻為輔（佔 20-30%），自動生成一篇約 2000-2500 字的科普衛教文章。
      </p>

      <div className="blog-input-row">
        <div className="blog-topic-input">
          <label htmlFor="blog-topic">文章主題（可選，留空自動判斷）</label>
          <input
            id="blog-topic"
            type="text"
            value={blogTopic}
            onChange={(e) => setBlogTopic(e.target.value)}
            placeholder="例如：運動對於膝關節炎的治療效果"
            disabled={blogLoading}
            aria-describedby="topic-hint"
          />
          <span id="topic-hint" className="visually-hidden">
            輸入文章主題，或留空讓系統自動判斷
          </span>
        </div>
        <div className="blog-query-select">
          <label id="query-select-label">選擇搜尋式版本</label>
          <div className="blog-buttons" role="group" aria-labelledby="query-select-label">
            {queries.map(query => (
              <button
                key={query.id}
                className="btn btn-blog"
                onClick={() => onGenerateBlog(query.query_string)}
                disabled={blogLoading}
                aria-busy={blogLoading}
              >
                {blogLoading ? '生成中...' : `使用 ${query.label.replace(' Version', '')}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {blogLoading && (
        <div className="blog-loading" role="status" aria-live="polite">
          <div className="loading-spinner" aria-hidden="true"></div>
          <p>正在搜尋相關文獻並生成科普文章，請稍候（約需 30-60 秒）...</p>
        </div>
      )}

      {blogError && (
        <div className="error-message" role="alert">
          <span className="error-icon" aria-hidden="true">❌</span>
          <span className="error-text">{blogError}</span>
        </div>
      )}

      {blogResult && (
        <div className="blog-result">
          <div className="blog-header">
            <h3>生成的文章</h3>
            <div className="blog-meta" aria-label="文章資訊">
              <span>主題：{blogResult.metadata?.topic}</span>
              <span>字數：約 {blogResult.metadata?.charCount} 字</span>
              <span>主要文獻：{blogResult.metadata?.primarySourceCount || 0} 篇</span>
              <span>輔助文獻：{blogResult.metadata?.supportingSourceCount || 0} 篇</span>
            </div>
            <div className="blog-actions">
              <button
                className={`btn btn-secondary ${copiedId === 'blog' ? 'copied' : ''}`}
                onClick={onCopyBlog}
                aria-label={copiedId === 'blog' ? '已複製文章' : '複製文章到剪貼簿'}
              >
                {copiedId === 'blog' ? '已複製!' : '複製文章'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={onExportBlogMd}
                aria-label="下載 Markdown 檔案"
              >
                導出 Markdown
              </button>
            </div>
          </div>

          <div className="blog-content">
            <article className="blog-article">
              <ReactMarkdown>
                {DOMPurify.sanitize(blogResult.article)}
              </ReactMarkdown>
            </article>
          </div>

          {blogResult.references?.length > 0 && (
            <div className="blog-references">
              <h4>參考文獻</h4>
              {/* 主要文獻 */}
              {blogResult.references.filter(ref => ref.isPrimary).length > 0 && (
                <>
                  <h5 className="ref-category primary">主要文獻（文章核心）</h5>
                  <ul>
                    {blogResult.references.filter(ref => ref.isPrimary).map((ref, i) => (
                      <li key={i} className="primary-ref">
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`在 PubMed 查看 PMID ${ref.pmid}`}
                        >
                          PMID: {ref.pmid}
                        </a>
                        {' '}- {ref.title} ({ref.journal}, {ref.year})
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {/* 輔助文獻 */}
              {blogResult.references.filter(ref => !ref.isPrimary).length > 0 && (
                <>
                  <h5 className="ref-category supporting">輔助文獻（補充佐證）</h5>
                  <ul>
                    {blogResult.references.filter(ref => !ref.isPrimary).map((ref, i) => (
                      <li key={i} className="supporting-ref">
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`在 PubMed 查看 PMID ${ref.pmid}`}
                        >
                          PMID: {ref.pmid}
                        </a>
                        {' '}- {ref.title} ({ref.journal}, {ref.year})
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default BlogSection;
