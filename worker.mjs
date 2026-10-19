// Cloudflare Workers entry.
// The Express app is created on the first request (not at module scope) because Workers forbid
// timers and I/O in global scope, and express-rate-limit starts a cleanup timer when instantiated.
// The "port" is only a routing key inside the Worker, not a real socket.
import { handleAsNodeRequest } from "cloudflare:node";
import { createApp } from "./backend/src/index.js";

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
    await ensureListening();
    return handleAsNodeRequest(PORT, request);
  },
};
