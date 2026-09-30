import { parsePmidList } from '../../src/modules/pmidInput.js';
import { checkBlogArticle, DISCLAIMER } from '../../src/modules/blogChecks.js';
import { BlogGenerator } from '../../src/modules/BlogGenerator.js';

describe('parsePmidList', () => {
  test('accepts plain numbers, PMID: prefixes and PubMed URLs', () => {
    const { pmids, rejected } = parsePmidList(['31498328', 'PMID: 12345', 'https://pubmed.ncbi.nlm.nih.gov/7654321/', '00123']);
    expect(pmids).toEqual(['31498328', '12345', '7654321', '123']);
    expect(rejected).toEqual([]);
  });

  test('rejects PMCIDs and DOIs instead of stripping them to another PMID', () => {
    const { pmids, rejected } = parsePmidList(['PMC7654321', '10.1136/bmj.n71', '123,456']);
    expect(pmids).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/PMCID/),
      expect.stringMatching(/DOI/),
      expect.stringMatching(/不是有效/),
    ]);
  });

  test('counts duplicates after normalisation', () => {
    expect(parsePmidList(['123', '0123', 'PMID 123']).duplicates).toBe(2);
  });
});

describe('checkBlogArticle', () => {
  const sources = [{ pmid: '111', title: 'Trial', abstract: 'RESULTS: Pain fell by 23.5% (p=0.01).' }];

  test('flags unknown citations, invented numbers and absolute claims', () => {
    const { warnings, citedPmids } = checkBlogArticle(
      '研究發現疼痛下降 23.5%（PMID: 111），另一研究下降 40%（PMID: 999），保證根治。', sources);
    expect(citedPmids).toEqual(['111', '999']);
    expect(warnings.join('\n')).toMatch(/999/);
    expect(warnings.join('\n')).toMatch(/40%/);
    expect(warnings.join('\n')).not.toMatch(/23\.5%/);
    expect(warnings.join('\n')).toMatch(/保證/);
  });

  test('a clean article has no warnings', () => {
    expect(checkBlogArticle('疼痛下降 23.5%（PMID: 111）。', sources).warnings).toEqual([]);
  });
});

describe('BlogGenerator', () => {
  const primary = [{
    pmid: '111', title: 'Trial', journal: 'J', year: '2021', publication_types: ['Randomized Controlled Trial'],
    abstract: `BACKGROUND: ${'x'.repeat(700)}\nRESULTS: Pain fell by 23.5%.`,
  }];

  function llmReplying(content, finish_reason = 'stop') {
    const requests = [];
    return {
      requests, strongModel: 'm', provider: 'test',
      client: { chat: { completions: { create: async (req) => { requests.push(req); return { choices: [{ message: { content }, finish_reason }] }; } } } },
    };
  }

  test('sends the full abstract (results are not cut off) and appends the fixed disclaimer', async () => {
    const llm = llmReplying('# 標題\n\n疼痛下降 23.5%（PMID: 111）。');
    const result = await new BlogGenerator(llm).generateBlogArticle(primary, [], '膝痛');
    expect(llm.requests[0].messages[1].content).toContain('RESULTS: Pain fell by 23.5%.');
    expect(result.article.endsWith(DISCLAIMER)).toBe(true);
    expect(result.quality_warnings).toEqual([]);
    expect(result.references[0]).toMatchObject({ pmid: '111', isPrimary: true, isCited: true });
  });

  test('a truncated article is a failure, not a success', async () => {
    const llm = llmReplying('# 標題\n\n未完', 'length');
    await expect(new BlogGenerator(llm).generateBlogArticle(primary, [], '膝痛')).rejects.toThrow(/截斷/);
  });

  test('refuses to write without any source abstracts', async () => {
    const llm = llmReplying('x');
    await expect(new BlogGenerator(llm).generateBlogArticle([{ pmid: '1', title: 'T', abstract: '' }], [], 't')).rejects.toThrow(/摘要/);
  });
});
