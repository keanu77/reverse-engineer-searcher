import PubMedClient from '../../src/modules/PubMedClient.js';

// Fake ESearch: every call records its term and returns the scripted reply.
function clientWith(replies) {
  const client = new PubMedClient('test-key');
  const calls = [];
  client.axiosInstance = {
    post: async (url, body) => {
      const params = new URLSearchParams(body);
      calls.push({ url, term: params.get('term'), retmax: params.get('retmax') });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { data: reply };
    },
  };
  client._delay = async () => {};
  return { client, calls };
}

const esearch = (fields) => ({ esearchresult: { count: '0', idlist: [], querytranslation: '', ...fields } });

describe('PubMedClient.validateQueryCoversGoldPmids', () => {
  test('checks coverage by intersecting with the gold PMIDs, not by the first 10,000 hits', async () => {
    const { client, calls } = clientWith([
      esearch({ count: '25000', querytranslation: 'knee[All Fields]' }),
      esearch({ count: '2', idlist: ['222', '111'] }),
    ]);
    const result = await client.validateQueryCoversGoldPmids('knee[tiab]', ['111', '222', '333']);
    expect(calls[0]).toMatchObject({ term: 'knee[tiab]', retmax: '0' });
    expect(calls[1].term).toBe('(knee[tiab]) AND (111[uid] OR 222[uid] OR 333[uid])');
    expect(result).toMatchObject({
      hit_count: 25000,
      captured_pmids: ['111', '222'],
      missing_pmids: ['333'],
      covers_all_gold: false,
      query_translation: 'knee[All Fields]',
    });
  });

  test('reports PubMed errors and warnings instead of hiding them', async () => {
    const { client } = clientWith([
      esearch({
        count: '10',
        errorlist: { phrasesnotfound: ['foobarbaz'], fieldsnotfound: [] },
        warninglist: { quotedphrasesnotfound: ['"no such phrase"'], phrasesignored: ['of'], outputmessages: [] },
      }),
      esearch({ count: '1', idlist: ['111'] }),
    ]);
    const result = await client.validateQueryCoversGoldPmids('foobarbaz[tiab]', ['111']);
    expect(result.pubmed_errors).toEqual(['PubMed 找不到片語：foobarbaz']);
    expect(result.pubmed_warnings).toEqual(['PubMed 找不到引號片語："no such phrase"', 'PubMed 忽略的字：of']);
  });

  test('a PubMed syntax ERROR fails validation without retrying', async () => {
    const { client, calls } = clientWith([{ esearchresult: { ERROR: 'Invalid query' } }]);
    await expect(client.validateQueryCoversGoldPmids('((knee', ['111'])).rejects.toThrow('Invalid query');
    expect(calls).toHaveLength(1);
  });

  test('a reply without a numeric count is an error, not zero hits', async () => {
    const { client } = clientWith([{ esearchresult: { idlist: [] } }]);
    await expect(client.searchPubMed('knee', { maxResults: 0 })).rejects.toThrow();
  });

  test('normalises PMIDs before comparing', async () => {
    const { client } = clientWith([esearch({ count: '5' }), esearch({ count: '1', idlist: ['111'] })]);
    const result = await client.validateQueryCoversGoldPmids('knee', [111, ' 111 ']);
    expect(result).toMatchObject({ covers_all_gold: true, missing_pmids: [], captured_pmids: ['111'] });
  });
});

describe('PubMedClient.fetchArticlesByPmids', () => {
  test('returns articles in the requested order and lists missing PMIDs', async () => {
    const client = new PubMedClient('test-key');
    PubMedClient.clearCache();
    const record = (pmid) => `<PubmedArticle><MedlineCitation Status="MEDLINE"><PMID>${pmid}</PMID><Article><ArticleTitle>T${pmid}</ArticleTitle></Article></MedlineCitation></PubmedArticle>`;
    client.axiosInstance = { post: async () => ({ data: `<PubmedArticleSet>${record('222')}${record('111')}</PubmedArticleSet>` }) };
    const { articles, missingPmids } = await client.fetchArticlesByPmids(['111', '222', '999']);
    expect(articles.map((a) => a.pmid)).toEqual(['111', '222']);
    expect(missingPmids).toEqual(['999']);
  });
});
