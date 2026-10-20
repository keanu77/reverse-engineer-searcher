/**
 * PubMedClient retry / throttle / api_key handling.
 */
import { jest } from '@jest/globals';
import PubMedClient, { PubMedUnavailableError, parseRetryAfter } from '../../src/modules/PubMedClient.js';
import { errorStatus, publicError } from '../../src/modules/RequestSecurity.js';

const FAKE_KEY = 'fake-pubmed-key-0123456789abcdef';
const ok = { esearchresult: { count: '3', idlist: ['1', '2', '3'], querytranslation: '' } };

function httpError(status, headers = {}) {
  const error = new Error(`Request failed with status code ${status}`);
  error.name = 'AxiosError';
  error.response = { status, headers, data: { error: 'API rate limit exceeded' } };
  return error;
}

// Scripted axios stand-in; records every body and every delay the client asks for.
function scriptedClient(replies, apiKey) {
  const client = new PubMedClient(apiKey);
  const bodies = [];
  const delays = [];
  client.axiosInstance = {
    post: async (url, body) => {
      bodies.push({ url, params: new URLSearchParams(body) });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { data: reply };
    },
  };
  client._delay = async (ms) => { delays.push(ms); };
  return { client, bodies, delays };
}

describe('PubMedClient retry', () => {
  let warnSpy;
  let errorSpy;
  let savedKey;

  beforeEach(() => {
    savedKey = process.env.PUBMED_API_KEY;
    delete process.env.PUBMED_API_KEY;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.PUBMED_API_KEY;
    else process.env.PUBMED_API_KEY = savedKey;
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('backs off exponentially with jitter on 429, then succeeds', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const { client, bodies, delays } = scriptedClient([httpError(429), httpError(429), ok]);
    const result = await client.searchPubMed('knee', { maxResults: 3 });
    expect(result.count).toBe(3);
    expect(bodies).toHaveLength(3);
    // equal jitter: base/2 + random*base/2 → 1000ms*0.75, 2000ms*0.75 (throttle waits are below 350ms)
    const backoffs = delays.filter((ms) => ms >= 500);
    expect(backoffs).toEqual([750, 1500]);
  });

  test('jitter stays within [base/2, base]', () => {
    const client = new PubMedClient();
    for (const r of [0, 0.999]) {
      jest.spyOn(Math, 'random').mockReturnValue(r);
      const ms = client._retryDelayMs(httpError(500), 3);
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThanOrEqual(4000);
    }
  });

  test('honours Retry-After on 429 and 503, capped at 10s', async () => {
    const { client, delays } = scriptedClient([
      httpError(429, { 'retry-after': '2' }),
      httpError(503, { 'Retry-After': '3' }),
      ok,
    ]);
    await client.searchPubMed('knee');
    expect(delays.filter((ms) => ms >= 500)).toEqual([2000, 3000]);
    expect(client._retryDelayMs(httpError(429, { 'retry-after': '120' }), 1)).toBe(10000);
  });

  test('parses Retry-After as seconds or HTTP-date', () => {
    const now = Date.parse('2026-10-20T00:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5000);
    expect(parseRetryAfter('Tue, 20 Oct 2026 00:00:04 GMT', now)).toBe(4000);
    expect(parseRetryAfter('garbage', now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
  });

  test('does not retry 400 or 404', async () => {
    for (const status of [400, 404]) {
      const { client, bodies } = scriptedClient([httpError(status), ok]);
      await expect(client.searchPubMed('knee')).rejects.toMatchObject({ response: { status } });
      expect(bodies).toHaveLength(1);
    }
  });

  test('retries network errors and 5xx', async () => {
    const network = new Error('fetch failed');
    const { client, bodies } = scriptedClient([network, httpError(502), ok]);
    await client.searchPubMed('knee');
    expect(bodies).toHaveLength(3);
  });

  test('gives up after 4 attempts with a 503-mapped rate-limit error', async () => {
    const { client, bodies } = scriptedClient([httpError(429), httpError(429), httpError(429), httpError(429), ok]);
    const error = await client.searchPubMed('knee').catch((e) => e);
    expect(error).toBeInstanceOf(PubMedUnavailableError);
    expect(error.rateLimited).toBe(true);
    expect(bodies).toHaveLength(4);
    expect(errorStatus(error)).toBe(503);
    expect(publicError(error)).toMatch(/rate limit/);
  });

  test('total retry wait stays within the per-request budget', async () => {
    const replies = Array.from({ length: 20 }, () => httpError(429, { 'retry-after': '10' }));
    const { client, delays } = scriptedClient(replies);
    await expect(client.searchPubMed('a')).rejects.toBeInstanceOf(PubMedUnavailableError);
    await expect(client.searchPubMed('b')).rejects.toBeInstanceOf(PubMedUnavailableError);
    const waited = delays.filter((ms) => ms >= 500).reduce((a, b) => a + b, 0);
    expect(waited).toBeLessThanOrEqual(15000);
  });

  test('a 200 reply carrying a rate-limit error is retried', async () => {
    const { client, bodies } = scriptedClient([{ error: 'API rate limit exceeded' }, ok]);
    await client.searchPubMed('knee');
    expect(bodies).toHaveLength(2);
  });

  test('serialises calls at least 350ms apart without a key', async () => {
    const { client, delays } = scriptedClient([ok, ok]);
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    client._delay = async (ms) => { delays.push(ms); now += ms; };
    await Promise.all([client.searchPubMed('a'), client.searchPubMed('b')]);
    expect(delays).toEqual([350]);
  });
});

describe('PubMedClient api_key', () => {
  let savedKey;
  beforeEach(() => { savedKey = process.env.PUBMED_API_KEY; });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.PUBMED_API_KEY;
    else process.env.PUBMED_API_KEY = savedKey;
  });

  test('appends api_key to esearch and efetch when PUBMED_API_KEY is set', async () => {
    process.env.PUBMED_API_KEY = FAKE_KEY;
    PubMedClient.clearCache();
    const { client, bodies } = scriptedClient([ok, '<PubmedArticleSet></PubmedArticleSet>']);
    await client.searchPubMed('knee');
    await client.fetchArticlesByPmids(['123']);
    expect(bodies.map((b) => b.params.get('api_key'))).toEqual([FAKE_KEY, FAKE_KEY]);
  });

  test('sends no api_key when PUBMED_API_KEY is unset or blank', async () => {
    for (const value of [undefined, '   ']) {
      if (value === undefined) delete process.env.PUBMED_API_KEY;
      else process.env.PUBMED_API_KEY = value;
      const { client, bodies } = scriptedClient([ok]);
      await client.searchPubMed('knee');
      expect(bodies[0].params.has('api_key')).toBe(false);
    }
  });

  test('the key never appears in logged errors or warnings', async () => {
    process.env.PUBMED_API_KEY = FAKE_KEY;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const leaky = () => {
      const e = httpError(429);
      e.message = `Request to https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&api_key=${FAKE_KEY} failed`;
      e.config = { data: `db=pubmed&api_key=${FAKE_KEY}`, params: { api_key: FAKE_KEY } };
      e.cause = new Error(`socket closed for api_key=${FAKE_KEY}`);
      return e;
    };
    const { client } = scriptedClient([leaky(), leaky(), leaky(), leaky()]);
    const error = await client.searchPubMed('knee').catch((e) => e);
    expect(error).toBeInstanceOf(PubMedUnavailableError);
    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).toContain('[REDACTED]');
    expect(publicError(error)).not.toContain(FAKE_KEY);
    expect(error.message).not.toContain(FAKE_KEY);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('scrubs api_key passed to the constructor (not via env) from log messages', async () => {
    delete process.env.PUBMED_API_KEY;
    const { logFailure } = await import('../../src/modules/SafeLogging.js');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logFailure('ctx', new Error(`GET /efetch.fcgi?id=1&api_key=${FAKE_KEY}&retmode=xml`));
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(FAKE_KEY);
    errorSpy.mockRestore();
  });
});
