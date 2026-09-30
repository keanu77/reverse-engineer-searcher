import { parseStringPromise } from "xml2js";

// Inline formatting inside titles/abstracts (e.g. <i>not</i>) splits text into
// child nodes that xml2js drops; removing the tags first keeps every word.
const INLINE_MARKUP = /<\/?(?:i|b|u|em|strong|sup|sub|sc)(?:\s[^>]*)?>/gi;

const asArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

/** Text content of an xml2js node parsed with mergeAttrs. */
function toText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node._ === "string") return node._.trim();
  return "";
}

function parseAbstract(article) {
  const sections = asArray(article.Abstract?.AbstractText)
    .map((node) => ({ label: typeof node === "object" ? node.Label || "" : "", text: toText(node) }))
    .filter((section) => section.text);
  const abstract = sections
    .map((section) => (section.label ? `${section.label}: ${section.text}` : section.text))
    .join("\n");
  return { abstract, abstract_sections: sections };
}

function parseMesh(citation) {
  const mesh_all = [];
  const mesh_major = [];
  const mesh_qualifiers = [];
  for (const heading of asArray(citation.MeshHeadingList?.MeshHeading)) {
    const descriptor = toText(heading.DescriptorName);
    if (!descriptor) continue;
    mesh_all.push(descriptor);
    if (heading.DescriptorName?.MajorTopicYN === "Y") mesh_major.push(descriptor);
    for (const qualifier of asArray(heading.QualifierName)) {
      const name = toText(qualifier);
      if (!name) continue;
      mesh_qualifiers.push(`${descriptor}/${name}`);
      if (qualifier.MajorTopicYN === "Y") mesh_major.push(descriptor);
    }
  }
  const unique = (list) => [...new Set(list)];
  return { mesh_all: unique(mesh_all), mesh_major: unique(mesh_major), mesh_qualifiers: unique(mesh_qualifiers) };
}

function parseYear(journal) {
  const pubDate = journal?.JournalIssue?.PubDate || {};
  const match = String(toText(pubDate.Year) || toText(pubDate.MedlineDate)).match(/\b(\d{4})\b/);
  return match ? match[1] : "";
}

function parseArticle(record) {
  const citation = record.MedlineCitation;
  const article = citation?.Article;
  if (!article) return null;
  const pmid = toText(citation.PMID);
  if (!/^\d+$/.test(pmid)) return null;

  const publicationTypes = asArray(article.PublicationTypeList?.PublicationType).map(toText).filter(Boolean);
  const keywords = asArray(citation.KeywordList)
    .flatMap((list) => asArray(list.Keyword))
    .map(toText)
    .filter(Boolean);

  return {
    pmid,
    title: toText(article.ArticleTitle),
    ...parseAbstract(article),
    journal: toText(article.Journal?.Title) || toText(article.Journal?.ISOAbbreviation),
    year: parseYear(article.Journal),
    ...parseMesh(citation),
    keywords: [...new Set(keywords)],
    publication_types: publicationTypes,
    is_retracted: publicationTypes.includes("Retracted Publication"),
    // MeSH is only assigned once a record is indexed for MEDLINE.
    indexed_for_medline: citation.Status === "MEDLINE",
  };
}

/** Parse an EFetch PubmedArticleSet XML string into article records. */
export async function parsePubmedXml(xml) {
  const parsed = await parseStringPromise(String(xml).replace(INLINE_MARKUP, ""), {
    explicitArray: false,
    mergeAttrs: true,
  });
  return asArray(parsed?.PubmedArticleSet?.PubmedArticle).map(parseArticle).filter(Boolean);
}
