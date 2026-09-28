import { jest } from '@jest/globals';
import { once } from 'node:events';
import OpenAI from 'openai';
import { createApp } from '../../src/index.js';
import PubMedClient from '../../src/modules/PubMedClient.js';
import LLMClient from '../../src/modules/LLMClient.js';
import { sanitizeLLMConfig } from '../../src/modules/RequestSecurity.js';

const originalEnv = { ...process.env };
const callerKey = 'audit-placeholder-caller';
const serviceKey = 'audit-placeholder-operator';
const accessCode = 'audit-placeholder-access';
let server;
let origin;
let createCompletion;

beforeEach(async () => {
  process.env.NODE_ENV = 'production';
  process.env.GROQ_API_KEY = serviceKey;
  process.env.AUTH_API_KEY = accessCode;
  process.env.ALLOWED_ORIGINS = 'https://class.example';
  createCompletion = jest.spyOn(OpenAI.Chat.Completions.prototype, 'create').mockImplementation(async function () {
    return { choices: [{ message: { content: this._client.apiKey === serviceKey ? 'operator' : 'caller' } }] };
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
});

const post = (body, headers = {}, path = 'test-llm') => fetch(`${origin}/api/search-builder/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('production navigation, health and metadata work without Origin', async () => {
  expect((await fetch(`${origin}/health`)).status).toBe(200);
  expect((await fetch(origin)).status).toBe(200);
  const response = await fetch(`${origin}/api/search-builder/providers`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('spoofable allowed Origin cannot authorize spending operator key', async () => {
  const response = await post({ provider: 'groq' }, { Origin: 'https://class.example' });
  expect(response.status).toBe(401);
  expect(createCompletion).not.toHaveBeenCalled();
});

test('missing configured access code fails closed even with submitted code', async () => {
  delete process.env.AUTH_API_KEY;
  expect((await post({ provider: 'groq' }, { 'X-Service-Token': accessCode })).status).toBe(401);
  expect(createCompletion).not.toHaveBeenCalled();
});

test('wrong access code fails closed', async () => {
  expect((await post({ provider: 'groq' }, { 'X-Service-Token': 'wrong' })).status).toBe(401);
  expect(createCompletion).not.toHaveBeenCalled();
});

test('authorized operator can use configured service key', async () => {
  const response = await post({ provider: 'groq' }, { 'X-Service-Token': accessCode });
  expect(response.status).toBe(200);
  expect((await response.json()).response).toBe('operator');
});

test('BYOK never falls back to operator key', async () => {
  const response = await post({ provider: 'groq', apiKey: callerKey });
  expect(response.status).toBe(200);
  expect((await response.json()).response).toBe('caller');
});

test('explicit untrusted cross-origin writes are rejected before upstream', async () => {
  expect((await post({ apiKey: callerKey }, { Origin: 'https://untrusted.example' })).status).toBe(403);
  expect(createCompletion).not.toHaveBeenCalled();
});

test('same-origin writes do not depend on a duplicate origin setting', async () => {
  expect((await post({ apiKey: callerKey }, { Origin: origin })).status).toBe(200);
});

test.each([{ provider: 'ollama' }, { provider: 'custom', baseURL: 'http://127.0.0.1:11434/v1' }, { provider: 'groq', baseURL: 'https://untrusted.example/v1' }])('production rejects local/custom endpoints: %j', async config => {
  expect((await post({ ...config, apiKey: callerKey })).status).toBe(400);
  expect(createCompletion).not.toHaveBeenCalled();
});

test('custom local endpoint cannot inherit an operator credential', () => {
  process.env.NODE_ENV = 'development';
  process.env.CUSTOM_API_KEY = serviceKey;
  const config = sanitizeLLMConfig({ provider: 'custom', baseURL: 'http://127.0.0.1:11434/v1', model: 'local' }, { socket: { remoteAddress: '127.0.0.1' } });
  expect(config.apiKey).toBe('local-no-key');
  expect(() => sanitizeLLMConfig({ provider: 'groq', baseURL: 'https://untrusted.example' }, { socket: { remoteAddress: '127.0.0.1' } })).toThrow();
  expect(() => sanitizeLLMConfig({ provider: 'ollama' }, { socket: { remoteAddress: '192.0.2.1' } })).toThrow();
});

test('LLM client cannot silently read environment keys', () => {
  expect(() => new LLMClient({ provider: 'groq' })).toThrow('Explicit LLM credentials required');
});

test('explicit model choice applies to both classification and generation', () => {
  const client = new LLMClient({ provider: 'openai', apiKey: callerKey, model: 'gpt-4o-mini' });
  expect(client.model).toBe('gpt-4o-mini');
  expect(client.strongModel).toBe('gpt-4o-mini');
});

test('upstream errors expose neither credential-bearing config nor messages', async () => {
  const error = Object.assign(new Error(`Rejected credential ${callerKey}`), { config: { params: { api_key: callerKey } } });
  jest.spyOn(PubMedClient.prototype, 'fetchArticlesByPmids').mockRejectedValue(error);
  const response = await fetch(`${origin}/api/search-builder/fetch-article/123`);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain(callerKey);
  expect(JSON.stringify(console.error.mock.calls)).not.toContain(callerKey);
});

test('blog rejects missing credentials before any PubMed request', async () => {
  const search = jest.spyOn(PubMedClient.prototype, 'searchPubMed').mockRejectedValue(new Error('must not run'));
  const response = await post({ query_string: 'example', gold_pmids: ['123'] }, {}, 'generate-blog');
  expect(response.status).toBe(401);
  expect(search).not.toHaveBeenCalled();
});

test('API request budget returns 429 and health remains available', async () => {
  for (let i = 0; i < 10; i++) expect((await fetch(`${origin}/api/search-builder/providers`)).status).toBe(200);
  expect((await fetch(`${origin}/api/search-builder/providers`)).status).toBe(429);
  expect((await fetch(`${origin}/health`)).status).toBe(200);
});

test('search pipeline returns three translated strategies with mocked upstream only', async () => {
  const article = { pmid: '123', title: 'Example teaching study', journal: 'Fixture', year: '2024', mesh_major: ['Exercise'], mesh_all: ['Exercise'], keywords: ['Education'] };
  jest.spyOn(PubMedClient.prototype, 'fetchArticlesByPmids').mockResolvedValue({ articles: [article], missingPmids: [] });
  jest.spyOn(PubMedClient.prototype, 'validateQueryCoversGoldPmids').mockResolvedValue({ hit_count: 12, covers_all_gold: true, missing_pmids: [], query_translation: 'fixture' });
  createCompletion.mockImplementation(async ({ messages }) => {
    const classification = messages[0].content.includes('classify terms');
    const result = classification
      ? { classifications: [{ term: 'Exercise', role: 'I' }, { term: 'Education', role: 'P' }] }
      : { queries: ['sensitive', 'balanced', 'compact'].map(id => ({ id, label: id, query_string: '(education[tiab]) AND (exercise[tiab])', blocks_used: ['P', 'I'] })) };
    return { choices: [{ message: { content: JSON.stringify(result) } }] };
  });
  const response = await post({ pmids: ['123'], llmConfig: { provider: 'groq', apiKey: callerKey } }, {}, 'from-pmids');
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.queries).toHaveLength(3);
  expect(data.queries[0].translations).toHaveProperty('embase');
  expect(data.queries[0].covers_all_gold).toBe(true);
  expect(data.terms.find(t => t.term === 'Exercise').suggested_role).toBe('I');
  expect(JSON.stringify(data)).not.toContain(callerKey);
});

test('blog pipeline returns generated text and references with mocked upstream', async () => {
  const article = { pmid: '123', title: 'Example teaching study', journal: 'Fixture', year: '2024', abstract: 'Test abstract.' };
  jest.spyOn(PubMedClient.prototype, 'searchPubMed').mockResolvedValue({ pmids: ['123'], count: 1 });
  jest.spyOn(PubMedClient.prototype, 'fetchArticlesByPmids').mockResolvedValue({ articles: [article], missingPmids: [] });
  createCompletion.mockResolvedValue({ choices: [{ message: { content: '# Mock teaching text\n\nGenerated for regression testing.' } }] });
  const response = await post({ query_string: 'education', gold_pmids: ['123'], llmConfig: { apiKey: callerKey } }, {}, 'generate-blog');
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.success).toBe(true);
  expect(data.article).toContain('Mock teaching text');
  expect(data.references[0].pmid).toBe('123');
});

test('provider requests reject redirects and have a bounded timeout', async () => {
  createCompletion.mockRestore();
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const client = new LLMClient({ provider: 'groq', apiKey: callerKey });
  await client.client.chat.completions.create({ model: 'test-model', messages: [] });
  expect(fetch.mock.calls[0][1].redirect).toBe('error');
  expect(client.client.timeout).toBe(45000);
});
