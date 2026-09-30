import TermAnalyzer from '../../src/modules/TermAnalyzer.js';

describe('TermAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new TermAnalyzer();
  });

  const makeArticle = (pmid, meshMajor = [], meshAll = [], keywords = []) => ({
    pmid: String(pmid),
    title: `Article ${pmid}`,
    mesh_major: meshMajor,
    mesh_all: meshAll,
    keywords
  });

  describe('analyzeArticles', () => {
    test('should count document frequency across articles', () => {
      const articles = [
        makeArticle(1, ['Knee'], ['Knee', 'Surgery'], ['rehab']),
        makeArticle(2, ['Knee'], ['Knee', 'Exercise'], ['rehab']),
      ];

      const terms = analyzer.analyzeArticles(articles);
      const kneeTerm = terms.find(t => t.normalized === 'knee');
      expect(kneeTerm.doc_freq).toBe(2);
      expect(kneeTerm.source).toBe('MeSH-major');
    });

    test('should sort by doc_freq descending', () => {
      const articles = [
        makeArticle(1, [], ['A', 'B'], []),
        makeArticle(2, [], ['A'], []),
      ];

      const terms = analyzer.analyzeArticles(articles);
      expect(terms[0].normalized).toBe('a');
      expect(terms[0].doc_freq).toBe(2);
    });

    test('should deduplicate terms across sources', () => {
      const articles = [
        makeArticle(1, ['Pain'], ['Pain'], ['Pain']),
      ];

      const terms = analyzer.analyzeArticles(articles);
      const painTerms = terms.filter(t => t.normalized === 'pain');
      expect(painTerms).toHaveLength(1);
      expect(painTerms[0].source).toBe('MeSH-major');
    });
  });

  describe('filterTerms', () => {
    test('should exclude generic terms', () => {
      const terms = [
        { term: 'Humans', normalized: 'humans', doc_freq: 3, is_generic: true },
        { term: 'PRP', normalized: 'prp', doc_freq: 2, is_generic: false },
      ];

      const filtered = analyzer.filterTerms(terms, { excludeGeneric: true });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].term).toBe('PRP');
    });

    test('should respect maxTerms', () => {
      const terms = Array.from({ length: 20 }, (_, i) => ({
        term: `Term${i}`, normalized: `term${i}`, doc_freq: 1, is_generic: false
      }));

      const filtered = analyzer.filterTerms(terms, { maxTerms: 5 });
      expect(filtered).toHaveLength(5);
    });

    test('should filter by minDocFreq', () => {
      const terms = [
        { term: 'A', normalized: 'a', doc_freq: 3, is_generic: false },
        { term: 'B', normalized: 'b', doc_freq: 1, is_generic: false },
      ];

      const filtered = analyzer.filterTerms(terms, { minDocFreq: 2 });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].term).toBe('A');
    });
  });

  describe('groupTermsByRole', () => {
    test('should group terms by PICO role', () => {
      const terms = [
        { term: 'Knee', suggested_role: 'P' },
        { term: 'PRP', suggested_role: 'I' },
        { term: 'Pain', suggested_role: 'O' },
        { term: 'RCT', suggested_role: 'D' },
        { term: 'Misc', suggested_role: 'Other' },
      ];

      const groups = analyzer.groupTermsByRole(terms);
      expect(groups.P).toHaveLength(1);
      expect(groups.I).toHaveLength(1);
      expect(groups.O).toHaveLength(1);
      expect(groups.D).toHaveLength(1);
      expect(groups.Other).toHaveLength(1);
    });

    test('should default to Other for unknown roles', () => {
      const terms = [{ term: 'X', suggested_role: 'Z' }];
      const groups = analyzer.groupTermsByRole(terms);
      expect(groups.Other).toHaveLength(1);
    });
  });

  describe('ranking and spelling', () => {
    test('MeSH-major ranks before MeSH and keyword at equal frequency', () => {
      const terms = analyzer.analyzeArticles([
        { pmid: '1', mesh_major: ['Zeta Major'], mesh_all: ['Zeta Major', 'Alpha Minor'], keywords: ['beta kw'] },
      ]);
      expect(terms.map((t) => t.source)).toEqual(['MeSH-major', 'MeSH', 'keyword']);
    });

    test('keeps the MeSH spelling when a keyword appears first', () => {
      const terms = analyzer.analyzeArticles([
        { pmid: '1', mesh_major: [], mesh_all: [], keywords: ['knee injuries'] },
        { pmid: '2', mesh_major: [], mesh_all: ['Knee Injuries'], keywords: [] },
      ]);
      expect(terms[0].term).toBe('Knee Injuries');
    });

    test('age groups are not discarded as generic', () => {
      const terms = analyzer.analyzeArticles([{ pmid: '1', mesh_major: [], mesh_all: ['Child', 'Humans'], keywords: [] }]);
      expect(analyzer.filterTerms(terms).map((t) => t.term)).toEqual(['Child']);
    });
  });
});
