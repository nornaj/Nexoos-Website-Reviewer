// Shared cookie cache for proxied domains
// When Puppeteer solves a security challenge (e.g. SiteGround), it gets cookies
// that bypass future challenges. We store these cookies so the asset proxy can use them.

const cookieCache = new Map();

export function setCookiesForDomain(domain, cookieString) {
  cookieCache.set(domain, {
    cookies: cookieString,
    timestamp: Date.now(),
  });
  console.log(`[cookie-cache] Stored cookies for ${domain}`);
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
