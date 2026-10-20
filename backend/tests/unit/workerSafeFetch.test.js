import { jest } from '@jest/globals';
import { workerSafeFetch } from '../../src/modules/workerSafeFetch.js';

describe('workerSafeFetch', () => {
  let fetchSpy;
  afterEach(() => fetchSpy?.mockRestore());

  test('uses redirect "manual", keeps init, and calls fetch with globalThis receiver', async () => {
    let receiver;
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(function () {
      receiver = this;
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    const res = await workerSafeFetch('https://example.test/v1', { method: 'POST', redirect: 'follow' });
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls[0][1]).toEqual({ method: 'POST', redirect: 'manual' });
    expect(receiver).toBe(globalThis);
  });

  test('handles missing init', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    await workerSafeFetch('https://example.test/v1');
    expect(fetchSpy.mock.calls[0][1]).toEqual({ redirect: 'manual' });
  });

  test.each([301, 302, 307, 308, 399])('throws on %i redirect instead of following', async (status) => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status, headers: { Location: 'https://evil.test/' } })
    );
    await expect(workerSafeFetch('https://example.test/v1')).rejects.toThrow(`Unexpected redirect (status ${status})`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('returns non-3xx error responses unchanged', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));
    const res = await workerSafeFetch('https://example.test/v1');
    expect(res.status).toBe(401);
  });
});
