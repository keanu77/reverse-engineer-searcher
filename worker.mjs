// Cloudflare Workers entry.
// The Express app is created on the first request (not at module scope) because Workers forbid
// timers and I/O in global scope, and express-rate-limit starts a cleanup timer when instantiated.
// The "port" is only a routing key inside the Worker, not a real socket.
import { handleAsNodeRequest } from "cloudflare:node";
import { DurableObject } from "cloudflare:workers";
import { createApp } from "./backend/src/index.js";
import {
  decrementWindow,
  expireWindow,
  hitWindow,
  readWindow,
  setRateLimitNamespace,
} from "./backend/src/modules/rateLimitStore.js";

// One instance per (limiter prefix, client key): a fixed-window counter shared by every isolate,
// so express-rate-limit keeps its Node limits under Workers. The alarm clears expired windows.
export class RateLimiter extends DurableObject {
  async hit(windowMs) {
    const record = await hitWindow(this.ctx.storage, windowMs);
    if (record.isNewWindow) await this.ctx.storage.setAlarm(record.resetTime);
    return { totalHits: record.totalHits, resetTime: record.resetTime };
  }

  async read() {
    return readWindow(this.ctx.storage);
  }

  async decrement() {
    await decrementWindow(this.ctx.storage);
  }

  async reset() {
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const next = await expireWindow(this.ctx.storage);
    if (next) await this.ctx.storage.setAlarm(next);
  }
}

const PORT = 3001;
let listening = null;

function ensureListening() {
  if (!listening) {
    listening = new Promise((resolve, reject) => {
      createApp().listen(PORT, resolve).on("error", reject);
    });
  }
  return listening;
}

export default {
  async fetch(request, env, ctx) {
    // nodejs_compat does not auto-inject Worker vars/secrets into process.env; copy string
    // bindings before ensureListening so the long-lived Express app sees GROQ_API_KEY etc.
    if (env && typeof env === "object") {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          process.env[key] = value;
        }
      }
    }
    // Shared rate-limit counters must be visible before createApp picks its store.
    setRateLimitNamespace(env?.RATE_LIMITER);
    await ensureListening();
    return handleAsNodeRequest(PORT, request);
  },
};
