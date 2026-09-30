import { completionText, extractJsonObject, normaliseRole, normaliseTermKey } from '../../src/modules/llmOutput.js';
import { TermClassifier } from '../../src/modules/TermClassifier.js';
import { QueryGenerator } from '../../src/modules/QueryGenerator.js';

const reply = (content, finish_reason = 'stop') => ({ choices: [{ message: { content }, finish_reason }] });

// Fake OpenAI-compatible client that answers from a script.
function fakeLLM(...contents) {
  const prompts = [];
  return {
    prompts,
    model: 'm', strongModel: 'm', supportsJsonMode: true,
    client: { chat: { completions: { create: async (req) => {
      prompts.push(req);
      const next = contents.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'string' ? reply(next) : next;
    } } } },
  };
}

describe('llmOutput helpers', () => {
  test('empty or truncated completions are errors', () => {
    expect(() => completionText(reply(null))).toThrow();
    expect(() => completionText(reply('{"a":1', 'length'))).toThrow(/截斷/);
    expect(completionText(reply(' ok '))).toBe('ok');
  });

  test('extracts the first complete JSON object, ignoring trailing prose', () => {
    expect(extractJsonObject('Here: {"a": {"b": "}"}} and {"c": 2}')).toEqual({ a: { b: '}' } });
    expect(() => extractJsonObject('no json')).toThrow();
  });

  test('roles are normalised; Other is never Outcome', () => {
    expect(normaliseRole('Other')).toBe('Other');
    expect(normaliseRole('outcome')).toBe('O');
    expect(normaliseRole('Population')).toBe('P');
    expect(normaliseRole('Study Design')).toBe('D');
    expect(normaliseRole('???')).toBeNull();
  });

  test('term keys ignore case, quotes and spacing', () => {
    expect(normaliseTermKey(' "Knee  Injuries" ')).toBe(normaliseTermKey('knee injuries'));
  });
});

describe('TermClassifier', () => {
  const terms = [{ term: 'Knee Injuries', source: 'MeSH', doc_freq: 3 }, { term: 'Humans', source: 'MeSH', doc_freq: 3 }];
  const articles = [{ pmid: '1', title: 'T' }];

  test('matches terms despite case/quote differences and full role names', async () => {
    const llm = fakeLLM(JSON.stringify({ classifications: [
      { term: '"knee injuries"', role: 'Population', confidence: 'high' },
      { term: 'humans', role: 'Other', confidence: 'high' },
    ] }));
    const out = await new TermClassifier(llm).classifyTerms(terms, articles);
    expect(out.map((t) => t.suggested_role)).toEqual(['P', 'Other']);
    expect(out[0].classification_status).toBe('classified');
  });

  test('fallback table parsing keeps Other as Other and handles markdown pipes', async () => {
    const llm = fakeLLM('not json', '| Knee Injuries | Population |\n| Humans | Other |');
    const out = await new TermClassifier(llm).classifyTerms(terms, articles);
    expect(out.map((t) => t.suggested_role)).toEqual(['P', 'Other']);
  });

  test('terms the model skipped are marked unclassified', async () => {
    const llm = fakeLLM(JSON.stringify({ classifications: [{ term: 'Knee Injuries', role: 'P' }] }));
    const out = await new TermClassifier(llm).classifyTerms(terms, articles);
    expect(out[1]).toMatchObject({ suggested_role: 'Other', classification_status: 'unclassified' });
  });
});

describe('QueryGenerator', () => {
  const grouped = { P: [{ term: 'Knee Injuries', source: 'MeSH', doc_freq: 3 }], I: [{ term: 'Exercise', source: 'MeSH', doc_freq: 2 }], O: [], D: [], Other: [] };
  const articles = [{ pmid: '1', title: 'T', journal: 'J', year: '2020', publication_types: ['Randomized Controlled Trial'] }];
  const good = {
    queries: [
      { id: 'sensitive', label: 'Sensitive Version', query_string: '("Knee Injuries"[Mesh] OR knee*[tiab]) AND ("Exercise"[Mesh] OR exercis*[tiab])' },
      { id: 'balanced', label: 'Balanced Version', query_string: '"Knee Injuries"[Mesh] AND "Exercise"[Mesh]' },
      { id: 'compact', label: 'Compact Version', query_string: '"Knee Injuries"[Majr] AND exercise[tiab]' },
    ],
  };

  test('returns exactly the three strategies with lint results', async () => {
    const out = await new QueryGenerator(fakeLLM(JSON.stringify(good))).generateSearchQueries(grouped, articles);
    expect(out.map((q) => q.id)).toEqual(['sensitive', 'balanced', 'compact']);
    expect(out.every((q) => Array.isArray(q.lint_errors) && q.lint_errors.length === 0)).toBe(true);
  });

  test('a strategy that uses PMIDs is flagged as unusable', async () => {
    const bad = { queries: [...good.queries.slice(0, 2), { id: 'compact', query_string: 'knee[tiab] OR 1[pmid]' }] };
    const out = await new QueryGenerator(fakeLLM(JSON.stringify(bad))).generateSearchQueries(grouped, articles);
    expect(out[2].lint_errors[0]).toMatch(/PMID/);
  });

  test('incomplete JSON falls back and the fallback ignores prose and code fences', async () => {
    const llm = fakeLLM(JSON.stringify({ queries: [] }),
      '**SENSITIVE:**\n```\nknee*[tiab] AND exercis*[tiab]\n```\nThis is sensitive.\n\nBALANCED:\n"Knee Injuries"[Mesh] AND exercise[tiab]\n\nCOMPACT: "Knee Injuries"[Majr] AND exercise[tiab]');
    const out = await new QueryGenerator(llm).generateSearchQueries(grouped, articles);
    expect(out.map((q) => [q.id, q.query_string])).toEqual([
      ['sensitive', 'knee*[tiab] AND exercis*[tiab]'],
      ['balanced', '"Knee Injuries"[Mesh] AND exercise[tiab]'],
      ['compact', '"Knee Injuries"[Majr] AND exercise[tiab]'],
    ]);
  });

  test('prompt carries publication types and a low temperature', async () => {
    const llm = fakeLLM(JSON.stringify(good));
    await new QueryGenerator(llm).generateSearchQueries(grouped, articles);
    expect(llm.prompts[0].temperature).toBeLessThanOrEqual(0.2);
    expect(llm.prompts[0].messages[1].content).toContain('Randomized Controlled Trial');
  });
});
