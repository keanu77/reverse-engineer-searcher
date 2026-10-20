/**
 * workerSafeFetch - fetch wrapper that never follows redirects.
 *
 * Cloudflare Workers fetch only accepts redirect: "follow" | "manual"
 * ("error" throws TypeError, which the OpenAI SDK surfaces as "Connection error.").
 * We use "manual" and reject any 3xx response ourselves. globalThis.fetch is always
 * invoked with globalThis as receiver to avoid "Illegal invocation" on Workers.
 */
export async function workerSafeFetch(url, init) {
  const response = await globalThis.fetch(url, { ...(init || {}), redirect: 'manual' });
  const status = response?.status;
  if ((status >= 300 && status <= 399) || response?.type === 'opaqueredirect') {
    throw new TypeError(`Unexpected redirect (status ${status})`);
  }
  return response;
}

export default workerSafeFetch;
