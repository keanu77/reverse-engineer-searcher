import QueryValidator from '../../src/modules/QueryValidator.js';

describe('QueryValidator', () => {
  describe('generateWarnings', () => {
    let validator;

    beforeEach(() => {
      validator = new QueryValidator();
    });

    test('should warn when query has errors', () => {
      const queries = [
        { label: 'Sensitive', error: 'timeout', covers_all_gold: false, missing_pmids: ['123'] }
      ];
      const warnings = validator.generateWarnings(queries);
      expect(warnings.some(w => w.includes('error'))).toBe(true);
    });

    test('should warn when query does not cover all gold PMIDs', () => {
      const queries = [
        { label: 'Balanced', covers_all_gold: false, missing_pmids: ['123', '456'], hit_count: 100 }
      ];
      const warnings = validator.generateWarnings(queries);
      expect(warnings.some(w => w.includes('123'))).toBe(true);
      expect(warnings.some(w => w.includes('456'))).toBe(true);
    });

    test('should warn when hit count is too high', () => {
      const queries = [
        { label: 'Sensitive', covers_all_gold: true, missing_pmids: [], hit_count: 50000 }
      ];
      const warnings = validator.generateWarnings(queries);
      expect(warnings.some(w => w.includes('50000') || w.includes('50,000'))).toBe(true);
    });

    test('should return empty array for perfect queries', () => {
      const queries = [
        { label: 'Compact', covers_all_gold: true, missing_pmids: [], hit_count: 500 }
      ];
      const warnings = validator.generateWarnings(queries);
      expect(warnings).toHaveLength(0);
    });
  });

  describe('calculateQualityMetrics', () => {
    let validator;

    beforeEach(() => {
      validator = new QueryValidator();
    });

    test('should calculate recall correctly', () => {
      const query = { missing_pmids: ['1'], hit_count: 100 };
      const metrics = validator.calculateQualityMetrics(query, 5);
      expect(metrics.recall).toBe(4 / 5);
      expect(metrics.coverage_rate).toBe('4/5');
    });

    test('should calculate NNT correctly', () => {
      const query = { missing_pmids: [], hit_count: 500 };
      const metrics = validator.calculateQualityMetrics(query, 5);
      expect(metrics.nnt).toBe(100); // 500 / 5
    });

    test('should handle zero gold articles', () => {
      const query = { missing_pmids: [], hit_count: 100 };
      const metrics = validator.calculateQualityMetrics(query, 0);
      expect(metrics.recall).toBe(0);
      expect(metrics.nnt).toBe(null);
    });

    test('should handle null hit_count', () => {
      const query = { missing_pmids: [], hit_count: null };
      const metrics = validator.calculateQualityMetrics(query, 3);
      expect(metrics.nnt).toBe(null);
    });
  });
});
