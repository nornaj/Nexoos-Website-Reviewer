// Shared cookie cache for proxied domains
// When Puppeteer solves a security challenge (e.g. SiteGround), it gets cookies
// that bypass future challenges. We store these cookies so the asset proxy can use them.
//
// IMPORTANT: Use globalThis so the cache is shared across all API routes.
// In Next.js, each route has its own module scope, so a regular `const Map`
// would NOT be shared between /api/proxy and /api/asset.

if (!globalThis.__nexoosCookieCache) {
  globalThis.__nexoosCookieCache = new Map();
}
const cookieCache = globalThis.__nexoosCookieCache;

export function setCookiesForDomain(domain, cookieString) {
  cookieCache.set(domain, {
    cookies: cookieString,
    timestamp: Date.now(),
  });
  console.log(`[cookie-cache] Stored cookies for ${domain} (${cookieString.length} chars)`);
}

export function getCookiesForDomain(domain) {
  const entry = cookieCache.get(domain);
  if (!entry) return null;
  // Expire after 30 minutes
  if (Date.now() - entry.timestamp > 30 * 60 * 1000) {
    cookieCache.delete(domain);
    return null;
  }
  return entry.cookies;
}
