import { parsePubmedXml } from '../../src/modules/pubmedXml.js';

const wrap = (inner) => `<?xml version="1.0"?><PubmedArticleSet>${inner}</PubmedArticleSet>`;

const article = ({ pmid = '111', status = 'MEDLINE', title = 'Title', abstract = '', extra = '' } = {}) => `
<PubmedArticle>
  <MedlineCitation Status="${status}" Owner="NLM">
    <PMID Version="1">${pmid}</PMID>
    <Article>
      <Journal><Title>J Test</Title><JournalIssue><PubDate><MedlineDate>2019 Fall</MedlineDate></PubDate></JournalIssue></Journal>
      <ArticleTitle>${title}</ArticleTitle>
      ${abstract ? `<Abstract>${abstract}</Abstract>` : ''}
      <PublicationTypeList>
        <PublicationType UI="D016449">Randomized Controlled Trial</PublicationType>
        <PublicationType UI="D016454">Review</PublicationType>
      </PublicationTypeList>
    </Article>
    <MeshHeadingList>
      <MeshHeading>
        <DescriptorName UI="D006333" MajorTopicYN="Y">Heart Failure</DescriptorName>
        <QualifierName UI="Q000628" MajorTopicYN="N">therapy</QualifierName>
      </MeshHeading>
      <MeshHeading><DescriptorName UI="D006801" MajorTopicYN="N">Humans</DescriptorName></MeshHeading>
    </MeshHeadingList>
    ${extra}
  </MedlineCitation>
</PubmedArticle>`;

describe('parsePubmedXml', () => {
  test('keeps text inside inline markup (negation is not lost)', async () => {
    const xml = wrap(article({
      title: 'Effect of <i>Drug X</i> on pain',
      abstract: '<AbstractText Label="RESULTS">Improvement <i>not</i> observed (p<sub>1</sub>).</AbstractText>',
    }));
    const [a] = await parsePubmedXml(xml);
    expect(a.title).toBe('Effect of Drug X on pain');
    expect(a.abstract).toBe('RESULTS: Improvement not observed (p1).');
  });

  test('keeps structured abstract labels in order', async () => {
    const xml = wrap(article({
      abstract: '<AbstractText Label="BACKGROUND">Bg.</AbstractText><AbstractText Label="RESULTS">Res.</AbstractText>',
    }));
    const [a] = await parsePubmedXml(xml);
    expect(a.abstract).toBe('BACKGROUND: Bg.\nRESULTS: Res.');
    expect(a.abstract_sections).toEqual([{ label: 'BACKGROUND', text: 'Bg.' }, { label: 'RESULTS', text: 'Res.' }]);
  });

  test('collects keywords from multiple KeywordList elements', async () => {
    const xml = wrap(article({
      extra: '<KeywordList Owner="NOTNLM"><Keyword>platelet-rich plasma</Keyword><Keyword><i>PRP</i></Keyword></KeywordList>'
        + '<KeywordList Owner="NLM"><Keyword>knee</Keyword></KeywordList>',
    }));
    const [a] = await parsePubmedXml(xml);
    expect(a.keywords).toEqual(['platelet-rich plasma', 'PRP', 'knee']);
  });

  test('extracts publication types, qualifiers, indexing status and a 4-digit year only', async () => {
    const [a] = await parsePubmedXml(wrap(article()));
    expect(a.publication_types).toEqual(['Randomized Controlled Trial', 'Review']);
    expect(a.mesh_all).toEqual(['Heart Failure', 'Humans']);
    expect(a.mesh_major).toEqual(['Heart Failure']);
    expect(a.mesh_qualifiers).toEqual(['Heart Failure/therapy']);
    expect(a.indexed_for_medline).toBe(true);
    expect(a.year).toBe('2019');
    expect(a.is_retracted).toBe(false);
  });

  test('flags retracted and not-yet-indexed records', async () => {
    const xml = wrap(article({ status: 'In-Process' }).replace('Review</PublicationType>', 'Retracted Publication</PublicationType>'));
    const [a] = await parsePubmedXml(xml);
    expect(a.is_retracted).toBe(true);
    expect(a.indexed_for_medline).toBe(false);
  });

  test('returns an empty list for an empty set', async () => {
    expect(await parsePubmedXml(wrap(''))).toEqual([]);
  });
});
