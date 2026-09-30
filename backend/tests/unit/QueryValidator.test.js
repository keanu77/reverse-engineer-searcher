import QueryValidator from '../../src/modules/QueryValidator.js';

// Fake PubMedClient: answers validateQueryCoversGoldPmids from a function.
const fakeClient = (fn) => ({ validateQueryCoversGoldPmids: async (q, pmids) => fn(q, pmids) });
const good = { id: 'balanced', label: 'Balanced', query_string: 'knee[tiab]', lint_errors: [], lint_warnings: [] };

describe('QueryValidator.validateQueries', () => {
  test('separates seed coverage from independent validation coverage', async () => {
    const client = fakeClient((q, pmids) => ({
      hit_count: 400, captured_pmids: pmids.filter((p) => p !== '3'), missing_pmids: ['3'],
      covers_all_gold: false, query_translation: 'knee', pubmed_errors: [], pubmed_warnings: [],
    }));
    const [q] = await new QueryValidator(client).validateQueries([good], ['1', '2'], { validationPmids: ['3', '4'] });
    expect(q).toMatchObject({
      validation_status: 'verified',
      missing_pmids: [],
      covers_all_gold: true,
      validation_set: { captured: ['4'], missing: ['3'] },
    });
    expect(q.quality_metrics).toEqual({ seed_coverage: '2/2', seed_coverage_ratio: 1, hits_per_seed: 200, validation_coverage: '1/2', validation_coverage_ratio: 0.5 });
  });

  test('a failed validation is unknown, not zero coverage', async () => {
    const client = fakeClient(() => { throw new Error('network'); });
    const [q] = await new QueryValidator(client).validateQueries([good], ['1']);
    expect(q.validation_status).toBe('failed');
    expect(q.missing_pmids).toEqual([]);
    expect(q.quality_metrics).toEqual({ seed_coverage: null, seed_coverage_ratio: null, hits_per_seed: null });
  });

  test('queries with lint errors are not sent to PubMed', async () => {
    let called = false;
    const client = fakeClient(() => { called = true; });
    const [q] = await new QueryValidator(client).validateQueries([{ ...good, lint_errors: ['語法錯誤'] }], ['1']);
    expect(called).toBe(false);
    expect(q.validation_status).toBe('skipped');
  });

  test('PubMed errors mark the result as unreliable', async () => {
    const client = fakeClient((q, pmids) => ({
      hit_count: 10, captured_pmids: pmids, missing_pmids: [], covers_all_gold: true,
      query_translation: '', pubmed_errors: ['PubMed 找不到片語：foo'], pubmed_warnings: [],
    }));
    const [q] = await new QueryValidator(client).validateQueries([good], ['1']);
    expect(q.validation_status).toBe('unreliable');
  });
});

describe('QueryValidator.generateWarnings', () => {
  const validator = new QueryValidator(fakeClient(() => {}));

  test('names missing seeds, zero hits, failures and PubMed messages', () => {
    const warnings = validator.generateWarnings([
      { label: 'A', validation_status: 'verified', missing_pmids: ['9'], hit_count: 0, pubmed_errors: [], pubmed_warnings: [] },
      { label: 'B', validation_status: 'failed', missing_pmids: [], hit_count: null, error: 'PubMed 暫時失敗' },
      { label: 'C', validation_status: 'unreliable', missing_pmids: [], hit_count: 5, pubmed_errors: ['PubMed 找不到片語：foo'], pubmed_warnings: [] },
    ]);
    const text = warnings.join('\n');
    expect(text).toMatch(/A.*9/);
    expect(text).toMatch(/A.*0 筆/);
    expect(text).toMatch(/B.*無法驗證/);
    expect(text).toMatch(/C.*foo/);
  });

  test('a large hit count is workload information, not advice to narrow', () => {
    const [warning] = validator.generateWarnings([{ label: 'S', validation_status: 'verified', missing_pmids: [], hit_count: 50000, pubmed_errors: [], pubmed_warnings: [] }]);
    expect(warning).toMatch(/50,000/);
    expect(warning).not.toMatch(/specific/);
  });
});
