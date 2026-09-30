import { parsePubmedQuery, lintPubmedQuery } from '../../src/modules/pubmedQuery.js';

describe('parsePubmedQuery', () => {
  test('left-to-right boolean tree with normalised fields', () => {
    const ast = parsePubmedQuery('(cancer[tiab] OR "breast neoplasms"[MeSH Terms]) AND randomized controlled trial[pt]');
    expect(ast).toEqual({
      type: 'op', op: 'AND',
      left: {
        type: 'op', op: 'OR',
        left: { type: 'term', text: 'cancer', quoted: false, field: 'tiab' },
        right: { type: 'term', text: 'breast neoplasms', quoted: true, field: 'mesh' },
      },
      right: { type: 'term', text: 'randomized controlled trial', quoted: false, field: 'pt' },
    });
  });

  test('PubMed evaluates operators left to right', () => {
    const ast = parsePubmedQuery('a[tiab] OR b[tiab] AND c[tiab]');
    expect(ast.op).toBe('AND');
    expect(ast.left.op).toBe('OR');
  });

  test('aliases, NoExp, major topic, qualifiers and proximity', () => {
    const terms = [
      parsePubmedQuery('"Heart Failure"[Mesh:NoExp]'),
      parsePubmedQuery('"Heart Failure"[Majr]'),
      parsePubmedQuery('"Heart Failure/therapy"[mh]'),
      parsePubmedQuery('"knee pain"[Title/Abstract]'),
      parsePubmedQuery('"exercise therapy"[tiab:~3]'),
      parsePubmedQuery('"Heart Failure" [Mesh]'),
    ];
    expect(terms[0]).toMatchObject({ field: 'mesh', noexp: true });
    expect(terms[1]).toMatchObject({ field: 'mesh', major: true });
    expect(terms[2]).toMatchObject({ field: 'mesh', text: 'Heart Failure', qualifier: 'therapy' });
    expect(terms[3]).toMatchObject({ field: 'tiab', text: 'knee pain' });
    expect(terms[4]).toMatchObject({ field: 'proximity', proximityField: 'tiab', distance: 3 });
    expect(terms[5]).toMatchObject({ field: 'mesh', text: 'Heart Failure' });
  });

  test('unknown tags are kept as unsupported, not dropped', () => {
    expect(parsePubmedQuery('english[la]')).toMatchObject({ field: 'unsupported', rawField: 'la', text: 'english' });
  });

  test('unquoted words before a tag form one phrase', () => {
    expect(parsePubmedQuery('heart failure[tiab]')).toMatchObject({ text: 'heart failure', field: 'tiab' });
  });

  test('syntax errors are reported', () => {
    expect(() => parsePubmedQuery('(a[tiab] OR b[tiab]')).toThrow(/括號/);
    expect(() => parsePubmedQuery('"open phrase[tiab]')).toThrow(/引號/);
    expect(() => parsePubmedQuery('a[tiab] AND')).toThrow();
    expect(() => parsePubmedQuery('')).toThrow();
  });
});

describe('lintPubmedQuery', () => {
  test('valid query has no errors', () => {
    expect(lintPubmedQuery('("Knee"[Mesh] OR knee[tiab]) AND pain[tiab]').errors).toEqual([]);
  });

  test('rejects queries that retrieve gold records by identifier', () => {
    expect(lintPubmedQuery('knee[tiab] OR 12345678[pmid]').errors[0]).toMatch(/PMID/);
    expect(lintPubmedQuery('knee[tiab] OR 12345678[uid]').errors[0]).toMatch(/PMID/);
  });

  test('flags lowercase operators and quoted truncation', () => {
    const { warnings } = lintPubmedQuery('knee[tiab] and "therap*"[tiab]');
    expect(warnings.join()).toMatch(/大寫/);
    expect(warnings.join()).toMatch(/截字/);
  });

  test('syntax errors surface as lint errors', () => {
    expect(lintPubmedQuery('(knee[tiab]').errors[0]).toMatch(/括號/);
  });
});
