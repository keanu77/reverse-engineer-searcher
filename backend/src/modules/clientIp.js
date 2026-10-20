import { ipKeyGenerator } from 'express-rate-limit';

const IN_WORKERS = globalThis.navigator?.userAgent === 'Cloudflare-Workers';

/**
 * Rate-limit key for the caller. Under Cloudflare Workers the Node socket has no remote address,
 * so the client IP comes from the cf-connecting-ip header, which only Cloudflare can set there.
 */
export function clientIpKey(req) {
  const ip = (IN_WORKERS && req.headers['cf-connecting-ip']) || req.ip || 'unknown';
  return ipKeyGenerator(ip);
}

export const rateLimitClientOptions = {
  keyGenerator: clientIpKey,
  // req.ip is undefined in Workers; the key above does not depend on it.
  validate: { ip: false },
};
