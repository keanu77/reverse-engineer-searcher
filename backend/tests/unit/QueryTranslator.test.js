import QueryTranslator from '../../src/modules/QueryTranslator.js';

const translator = new QueryTranslator();
const all = (query) => translator.translateAll(query);

describe('QueryTranslator regressions from the 2026-09-30 audit', () => {
  test('unquoted [pt] no longer swallows preceding conditions', () => {
    const { translations } = all('(cancer[tiab]) AND randomized controlled trial[pt]');
    expect(translations.embase).toBe('(cancer.ti,ab,kw. AND randomized controlled trial/)');
    expect(translations.cochrane).toBe('(cancer:ti,ab,kw AND "randomized controlled trial":pt)');
    expect(translations.wos).toBe('((TI=(cancer) OR AB=(cancer) OR AK=(cancer)) AND TS=(random* OR placebo*))');
    expect(translations.scopus).toBe('((TITLE-ABS(cancer) OR AUTHKEY(cancer)) AND TITLE-ABS-KEY(random* OR placebo*))');
  });

  test('every binary operation is parenthesised (PubMed is left to right)', () => {
    const { translations } = all('a[tiab] OR b[tiab] AND c[tiab]');
    expect(translations.cochrane).toBe('((a:ti,ab,kw OR b:ti,ab,kw) AND c:ti,ab,kw)');
  });

  test('field aliases and [tw] are translated, never silently stripped', () => {
    const { translations, warnings } = all('"Diabetes Mellitus, Type 2"[MeSH Terms] AND "heart failure"[tw] AND insulin[Title/Abstract]');
    expect(translations.cochrane).toBe('(([mh "Diabetes Mellitus, Type 2"] AND "heart failure":ti,ab,kw) AND insulin:ti,ab,kw)');
    expect(translations.embase).toContain('"heart failure".mp.');
    expect(warnings.embase.join()).toMatch(/Emtree/);
    expect(warnings.wos.join()).toMatch(/\[tw\]/);
  });

  test('unsupported fields are marked, not dropped', () => {
    const { translations, warnings } = all('knee[tiab] AND english[la]');
    expect(translations.scopus).toContain('<<未轉換：english[la]>>');
    expect(warnings.scopus.join()).toMatch(/\[la\]/);
  });

  test('Scopus NOT becomes AND NOT exactly once', () => {
    expect(all('knee[tiab] NOT animals[mh]').translations.scopus).toBe('((TITLE-ABS(knee) OR AUTHKEY(knee)) AND NOT INDEXTERMS("animals"))');
  });

  test('truncation is never placed inside quotes', () => {
    const { translations } = all('therap*[tiab] OR joint replace*[tiab]');
    expect(translations.cochrane).toBe('(therap*:ti,ab,kw OR (joint NEXT replace*):ti,ab,kw)');
    expect(translations.scopus).toBe('((TITLE-ABS(therap*) OR AUTHKEY(therap*)) OR (TITLE-ABS(joint PRE/0 replace*) OR AUTHKEY(joint PRE/0 replace*)))');
    expect(translations.embase).toBe('(therap*.ti,ab,kw. OR (joint adj replace*).ti,ab,kw.)');
  });

  test('phrases keep their words together and quotes protect operator words', () => {
    const { translations } = all('"signs and symptoms"[tiab]');
    expect(translations.embase).toBe('"signs and symptoms".ti,ab,kw.');
    expect(translations.wos).toBe('(TI=("signs and symptoms") OR AB=("signs and symptoms") OR AK=("signs and symptoms"))');
  });

  test('MeSH modifiers: NoExp, major topic and qualifiers', () => {
    expect(all('"Heart Failure"[Mesh:NoExp]').translations.cochrane).toBe('[mh ^"Heart Failure"]');
    expect(all('"Heart Failure"[Mesh:NoExp]').translations.embase).toBe('Heart Failure/');
    expect(all('"Heart Failure"[Majr]').translations.embase).toBe('exp *Heart Failure/');
    const qualified = all('"Heart Failure/therapy"[Mesh]');
    expect(qualified.translations.cochrane).toBe('[mh "Heart Failure"]');
    expect(qualified.warnings.cochrane.join()).toMatch(/副標題/);
  });

  test('WoS has no MeSH: natural word order topic search with a warning', () => {
    const { translations, warnings } = all('"Osteoarthritis, Knee"[Mesh]');
    expect(translations.wos).toBe('TS=("Knee Osteoarthritis")');
    expect(warnings.wos.join()).toMatch(/MeSH/);
  });

  test('publication types map to real document types or a flagged text filter', () => {
    expect(all('review[pt]').translations.scopus).toBe('DOCTYPE(re)');
    expect(all('review[pt]').translations.wos).toBe('DT=(Review)');
    const rct = all('"randomized controlled trial"[pt]');
    expect(rct.warnings.scopus.join()).toMatch(/RCT/);
  });

  test('syntax errors return an error instead of a broken translation', () => {
    const result = all('(knee[tiab] OR pain[tiab]');
    expect(result.error).toMatch(/括號/);
    expect(result.translations.pubmed).toBe('(knee[tiab] OR pain[tiab]');
    expect(result.translations.embase).toBeNull();
  });

  test('proximity keeps spacing and distance', () => {
    expect(all('"exercise therapy"[tiab:~3]').translations.embase).toBe('(exercise adj3 therapy).ti,ab,kw.');
    expect(all('"exercise therapy"[tiab:~3]').translations.cochrane).toBe('(exercise NEAR/3 therapy):ti,ab,kw');
  });

  test('non-string input does not throw', () => {
    expect(all(undefined).error).toBeTruthy();
  });
});
