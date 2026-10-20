/**
 * Shared rate-limit counters for Cloudflare Workers.
 *
 * express-rate-limit's default MemoryStore lives inside one isolate, and Workers spread requests
 * across many short-lived isolates, so per-isolate counters would admit roughly max × isolates.
 * Under Workers each (limiter, client) pair gets its own Durable Object holding one fixed-window
 * counter, which keeps the exact limits used in Node (100 / 15 min, 10 / min) and is consistent
 * globally. Local Node keeps the default MemoryStore (a single process).
 */

const WINDOW_KEY = 'window';
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

let durableNamespace = null;

/** Called by worker.mjs on every request with env.RATE_LIMITER (a Durable Object namespace). */
export function setRateLimitNamespace(namespace) {
  durableNamespace = namespace && typeof namespace.idFromName === 'function' ? namespace : null;
}

export function getRateLimitNamespace() {
  return durableNamespace;
}

function assertWindowMs(windowMs) {
  if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > MAX_WINDOW_MS) {
    throw new RangeError('Invalid rate-limit window');
  }
}

function isLive(record, now) {
  return Boolean(record) && Number.isFinite(record.resetTime) && record.resetTime > now;
}

/** Counts one hit in the current fixed window, opening a new window when the old one expired. */
export async function hitWindow(storage, windowMs, now = Date.now()) {
  assertWindowMs(windowMs);
  const current = await storage.get(WINDOW_KEY);
  const record = isLive(current, now)
    ? { totalHits: current.totalHits + 1, resetTime: current.resetTime }
    : { totalHits: 1, resetTime: now + windowMs };
  await storage.put(WINDOW_KEY, record);
  return { ...record, isNewWindow: !isLive(current, now) };
}

export async function readWindow(storage, now = Date.now()) {
  const current = await storage.get(WINDOW_KEY);
  return isLive(current, now) ? { totalHits: current.totalHits, resetTime: current.resetTime } : null;
}

export async function decrementWindow(storage, now = Date.now()) {
  const current = await storage.get(WINDOW_KEY);
  if (isLive(current, now) && current.totalHits > 0) {
    await storage.put(WINDOW_KEY, { totalHits: current.totalHits - 1, resetTime: current.resetTime });
  }
}

/**
 * Alarm handler body: drop an expired window so idle objects hold no storage.
 * Returns the time to re-arm the alarm when the window is still live, else null.
 */
export async function expireWindow(storage, now = Date.now()) {
  const current = await storage.get(WINDOW_KEY);
  if (isLive(current, now)) return current.resetTime;
  await storage.deleteAll();
  return null;
}

/** express-rate-limit Store backed by one Durable Object per prefixed client key. */
export class DurableObjectRateLimitStore {
  constructor({ prefix, getNamespace = getRateLimitNamespace }) {
    if (!prefix) throw new Error('A unique prefix is required per limiter');
    this.prefix = prefix;
    this.getNamespace = getNamespace;
    this.localKeys = false;
    this.windowMs = undefined;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  stub(key) {
    const namespace = this.getNamespace();
    if (!namespace) throw new Error('Rate-limit Durable Object binding is unavailable');
    return namespace.get(namespace.idFromName(`${this.prefix}${key}`));
  }

  async get(key) {
    const record = await this.stub(key).read();
    return record ? { totalHits: record.totalHits, resetTime: new Date(record.resetTime) } : undefined;
  }

  async increment(key) {
    const record = await this.stub(key).hit(this.windowMs);
    return { totalHits: record.totalHits, resetTime: new Date(record.resetTime) };
  }

  async decrement(key) {
    await this.stub(key).decrement();
  }

  async resetKey(key) {
    await this.stub(key).reset();
  }
}
