import { jest } from '@jest/globals';
import { once } from 'node:events';
import { createApp } from '../../src/index.js';
import {
  DurableObjectRateLimitStore,
  decrementWindow,
  expireWindow,
  hitWindow,
  readWindow,
  setRateLimitNamespace,
} from '../../src/modules/rateLimitStore.js';

function memoryStorage() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async deleteAll() { data.clear(); },
  };
}

// Mimics a Durable Object namespace: one object (with its own storage) per name, shared by every
// "isolate" that holds the namespace, with the same RPC surface as RateLimiter in worker.mjs.
function fakeNamespace({ failing = false } = {}) {
  const objects = new Map();
  const names = [];
  return {
    names,
    objects,
    idFromName(name) { names.push(name); return name; },
    get(id) {
      if (!objects.has(id)) objects.set(id, memoryStorage());
      const storage = objects.get(id);
      const guard = () => { if (failing) throw new Error('object unavailable'); };
      return {
        async hit(windowMs) { guard(); const r = await hitWindow(storage, windowMs); return { totalHits: r.totalHits, resetTime: r.resetTime }; },
        async read() { guard(); return readWindow(storage); },
        async decrement() { guard(); return decrementWindow(storage); },
        async reset() { guard(); return storage.deleteAll(); },
      };
    },
  };
}

describe('fixed-window counter', () => {
  test('counts hits within a window and restarts after it expires', async () => {
    const storage = memoryStorage();
    expect(await hitWindow(storage, 1000, 0)).toEqual({ totalHits: 1, resetTime: 1000, isNewWindow: true });
    expect(await hitWindow(storage, 1000, 500)).toEqual({ totalHits: 2, resetTime: 1000, isNewWindow: false });
    expect(await readWindow(storage, 999)).toEqual({ totalHits: 2, resetTime: 1000 });
    expect(await readWindow(storage, 1000)).toBeNull();
    expect(await hitWindow(storage, 1000, 1000)).toEqual({ totalHits: 1, resetTime: 2000, isNewWindow: true });
  });

  test('decrement never goes below zero and ignores expired windows', async () => {
    const storage = memoryStorage();
    await hitWindow(storage, 1000, 0);
    await decrementWindow(storage, 10);
    await decrementWindow(storage, 10);
    expect(await readWindow(storage, 10)).toEqual({ totalHits: 0, resetTime: 1000 });
  });

  test('alarm clears expired windows and re-arms live ones', async () => {
    const storage = memoryStorage();
    await hitWindow(storage, 1000, 0);
    expect(await expireWindow(storage, 500)).toBe(1000);
    expect(storage.data.size).toBe(1);
    expect(await expireWindow(storage, 1000)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  test('rejects invalid windows', async () => {
    await expect(hitWindow(memoryStorage(), 0)).rejects.toThrow(RangeError);
    await expect(hitWindow(memoryStorage(), 'x')).rejects.toThrow(RangeError);
  });

  test('store requires a prefix and a binding', async () => {
    expect(() => new DurableObjectRateLimitStore({})).toThrow();
    const store = new DurableObjectRateLimitStore({ prefix: 'p:', getNamespace: () => null });
    store.init({ windowMs: 1000 });
    await expect(store.increment('k')).rejects.toThrow('binding is unavailable');
  });
});

describe('API limiter with shared Durable Object counters', () => {
  const originalEnv = { ...process.env };
  let servers = [];

  async function start() {
    const server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    servers = [];
    setRateLimitNamespace(null);
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  test('two app instances (isolates) share one 10/min budget per client', async () => {
    const namespace = fakeNamespace();
    setRateLimitNamespace(namespace);
    const origins = [await start(), await start()];

    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${origins[i % 2]}/api/search-builder/not-a-route`);
      statuses.push(res.status);
      if (i === 0) expect(res.headers.get('ratelimit-limit') ?? res.headers.get('ratelimit')).toBeTruthy();
    }
    expect(statuses.slice(0, 10).every(s => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(namespace.names.some(n => n.startsWith('api:'))).toBe(true);
    expect(namespace.names.some(n => n.startsWith('general:'))).toBe(true);
  });

  test('without the binding each instance keeps its own memory counter (local Node)', async () => {
    const origins = [await start(), await start()];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${origins[i % 2]}/api/search-builder/not-a-route`);
      expect(res.status).not.toBe(429);
    }
  });

  test('fails closed when the shared counter is unavailable', async () => {
    setRateLimitNamespace(fakeNamespace({ failing: true }));
    const origin = await start();
    const res = await fetch(`${origin}/api/search-builder/not-a-route`);
    expect(res.status).toBe(500);
    expect((await fetch(`${origin}/health`)).status).toBe(200);
  });
});
