import React, { useState, useMemo } from 'react';

/**
 * Term 分析表組件
 */
function TermsAnalysisTable({ terms, totalArticles }) {
  const [roleFilter, setRoleFilter] = useState('all');

  const filteredTerms = useMemo(() => {
    return terms?.filter(t =>
      roleFilter === 'all' || t.suggested_role === roleFilter
    ) || [];
  }, [terms, roleFilter]);

  if (!terms || terms.length === 0) {
    return null;
  }

  const filterOptions = [
    { value: 'all', label: '全部' },
    { value: 'P', label: 'Population' },
    { value: 'I', label: 'Intervention' },
    { value: 'O', label: 'Outcome' },
    { value: 'D', label: 'Design' },
    { value: 'Other', label: 'Other' }
  ];

  return (
    <section className="terms-section" aria-labelledby="terms-heading">
      <h2 id="terms-heading">Term 分析表 ({filteredTerms.length} 個詞彙)</h2>

      <div className="terms-filter" role="group" aria-label="角色篩選">
        {filterOptions.map(({ value, label }) => (
          <button
            key={value}
            className={`filter-btn ${roleFilter === value ? 'active' : ''}`}
            onClick={() => setRoleFilter(value)}
            aria-pressed={roleFilter === value}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="table-container" role="region" aria-label="Term 分析結果">
        <table className="terms-table" aria-describedby="terms-heading">
          <thead>
            <tr>
              <th scope="col">Term</th>
              <th scope="col">來源</th>
              <th scope="col">出現次數</th>
              <th scope="col">角色</th>
            </tr>
          </thead>
          <tbody>
            {filteredTerms.map((term, i) => (
              <tr key={i}>
                <td>{term.term}</td>
                <td>
                  <span className={`source-badge ${term.source === 'MeSH-major' ? 'mesh-major' : ''}`}>
                    {term.source}
                  </span>
                </td>
                <td>{term.doc_freq}/{totalArticles}</td>
                <td>
                  <span className={`role-badge role-${term.suggested_role}`}>
                    {term.suggested_role}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default TermsAnalysisTable;
