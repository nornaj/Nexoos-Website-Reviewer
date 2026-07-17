import puppeteer from "puppeteer-core";
import { NextResponse } from "next/server";
import fs from "fs";
import { execFile } from "child_process";
import path from "path";
import os from "os";
import { setCookiesForDomain, getCookiesForDomain } from "../../../lib/cookie-cache";

export const dynamic = 'force-dynamic';

// Find a locally installed Chrome for development
function getLocalChromePath() {
  const paths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

// Phase 1: Use Puppeteer ONLY to solve WAF challenges and extract cookies
async function solveWafChallenge(url, executablePath) {
  console.log(`[proxy] Phase 1: Solving WAF challenge with Puppeteer...`);
  const browser = await puppeteer.launch({
    headless: "shell",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--window-size=1280,900",
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    
    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));

    // Detect security challenge
    let challengeType = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        challengeType = await page.evaluate(() => {
          const title = (document.title || "").toLowerCase();
          if (title.includes("robot challenge") || document.querySelector("#powCaptcha")) return "siteground";
          if (title.includes("just a moment") || document.querySelector("#challenge-running")) return "cloudflare";
          const text = document.body?.textContent || "";
          if (text.length < 500 && (text.includes("Checking") || text.includes("Verifying"))) return "generic";
          return null;
        });
        break;
      } catch (e) {
        console.log(`[proxy] Challenge detect attempt ${attempt + 1} failed: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
        if (attempt === 2) {
          const currentUrl = page.url();
          if (currentUrl.includes('.well-known') || currentUrl.includes('captcha')) {
            challengeType = 'siteground';
          }
        }
      }
    }

    if (challengeType) {
      console.log(`[proxy] Security challenge detected (${challengeType}), waiting for redirect...`);
      for (let hop = 0; hop < 5; hop++) {
        try {
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 });
        } catch { break; }
        const currentUrl = page.url();
        const currentTitle = await page.title();
        const isStillChallenge = currentUrl.includes(".well-known") || 
                                  currentUrl.includes("captcha") ||
                                  currentTitle.toLowerCase().includes("robot challenge") ||
                                  currentTitle.includes("Just a moment");
        if (!isStillChallenge) break;
        console.log(`[proxy] Still on challenge page (hop ${hop + 1}): ${currentUrl}`);
      }

      const waitStart = Date.now();
      while (Date.now() - waitStart < 30000) {
        const currentUrl = page.url();
        if (!currentUrl.includes('.well-known') && !currentUrl.includes('captcha')) break;
        try {
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 });
        } catch {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      console.log(`[proxy] Challenge solved, now at: ${page.url()}`);
    }

    // Extract cookies
    const cookies = await page.cookies();
    const domain = new URL(url).hostname;
    if (cookies.length > 0) {
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      setCookiesForDomain(domain, cookieStr);
    }

    await browser.close();
    console.log(`[proxy] Phase 1 complete: ${cookies.length} cookies extracted, browser closed`);
    return { cookies, challengeType };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

// Phase 2: Use SingleFile CLI to capture the complete page with all resources embedded
function captureWithSingleFile(url, cookies, executablePath) {
  console.log(`[proxy] Phase 2: Capturing page with SingleFile CLI...`);
  
  // Write cookies to a temp file for SingleFile
  const cookieFilePath = path.join(os.tmpdir(), `nexoos-cookies-${Date.now()}.json`);
  const cookieData = cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expires || -1,
    httpOnly: c.httpOnly || false,
    secure: c.secure || false,
    sameSite: c.sameSite || 'Lax',
    url: url,
  }));
  fs.writeFileSync(cookieFilePath, JSON.stringify(cookieData));
  
  // Find SingleFile CLI binary
  const singleFileBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'single-file.cmd' : 'single-file');
  
  const args = [
    url,
    '--dump-content',
    '--browser-executable-path', executablePath,
    '--browser-headless',
    '--browser-cookies-file', cookieFilePath,
    '--browser-width', '1280',
    '--browser-height', '900',
    '--browser-load-max-time', '45000',
    '--browser-capture-max-time', '45000',
    '--browser-wait-until', 'networkIdle',
    '--browser-wait-delay', '1500',
    '--load-deferred-images',
    '--load-deferred-images-dispatch-scroll-event',
    '--load-deferred-images-max-idle-time', '3000',
    '--remove-hidden-elements', 'false',
    '--remove-unused-styles', 'false',
    '--remove-unused-fonts', 'false',
    '--remove-alternative-fonts', 'false',
    '--remove-alternative-medias', 'false',
    '--remove-alternative-images', 'false',
    '--block-scripts', 'true',
    '--block-audios', 'true',
    '--block-videos', 'true',
    '--compress-HTML', 'false',
    '--insert-meta-CSP', 'false',
    '--insert-single-file-comment', 'false',
    '--remove-saved-date',
    '--max-resource-size', '20',
    '--browser-arg', '--no-sandbox',
    '--browser-arg', '--disable-setuid-sandbox',
    '--browser-arg', '--disable-dev-shm-usage',
    '--browser-arg', '--disable-blink-features=AutomationControlled',
  ];
  
  return new Promise((resolve, reject) => {
    execFile(singleFileBin, args, {
      maxBuffer: 100 * 1024 * 1024, // 100MB for large pages with embedded images
      timeout: 90000,
    }, (error, stdout, stderr) => {
      // Clean up temp cookie file
      try { fs.unlinkSync(cookieFilePath); } catch {}
      
      if (error) {
        console.log(`[proxy] SingleFile error: ${error.message}`);
        console.log(`[proxy] SingleFile stderr: ${(stderr || '').substring(0, 500)}`);
        reject(error);
        return;
      }
      
      console.log(`[proxy] SingleFile captured ${Math.round(stdout.length / 1024)}KB of HTML`);
      if (stderr) console.log(`[proxy] SingleFile info: ${stderr.substring(0, 200)}`);
      resolve(stdout);
    });
  });
}

// Main entry: solve WAF + capture with SingleFile
async function fetchWithBrowser(url) {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || getLocalChromePath();
  if (!executablePath) {
    throw new Error("No Chrome browser found. Set PUPPETEER_EXECUTABLE_PATH or install Chrome.");
  }
  console.log(`[proxy] Using Chrome: ${executablePath}`);

  // Phase 1: Solve WAF challenge with Puppeteer, extract cookies
  const { cookies } = await solveWafChallenge(url, executablePath);
  
  // Phase 2: Capture complete page with SingleFile CLI (all resources embedded)
  const html = await captureWithSingleFile(url, cookies, executablePath);
  
  return html;
}


// Detect if HTML is a WAF/CDN block page (Cloudflare, SiteGround, Sucuri, etc.)
function isCloudflareBlock(html) {
  if (!html) return false;
  // Cloudflare 403 page markers (require both 403 AND Cloudflare identifiers)
  if (/403 Forbidden|403 - Forbidden/i.test(html) && /cloudflare|cf-ray|cf-error/i.test(html)) return true;
  // Cloudflare "Attention Required" challenge
  if (/Attention Required|Access denied/i.test(html) && /cloudflare/i.test(html)) return true;
  // Cloudflare "Just a moment" interstitial
  if (/Just a moment|Checking your browser/i.test(html) && /challenge-platform|cf-challenge/i.test(html)) return true;
  // Specific Cloudflare error pages (require cf-error-details or cf-wrapper)
  if (/cf-error-details|cf-wrapper|cf-alert/i.test(html) && /cloudflare/i.test(html)) return true;
  // SiteGround WAF block page (403 - Forbidden + Access to this page is forbidden)
  if (/403 - Forbidden/i.test(html) && /Access to this page is forbidden/i.test(html)) return true;
  // Sucuri WAF block (very specific — requires Sucuri branding)
  if (/sucuri\.net|cloudproxy/i.test(html) && /blocked|access denied/i.test(html) && html.length < 5000) return true;
  // Generic: any short page (< 10KB) that's just a 403 error page
  if (/403 Forbidden|403 - Forbidden/i.test(html) && html.length < 10000 && !/<!DOCTYPE html>/i.test(html.substring(500))) return true;
  return false;
}

// Build a styled error page for blocked sites
function buildBlockedErrorPage(url, reason) {
  const domain = new URL(url).hostname;
  return `<!DOCTYPE html><html><head><title>Unable to load ${domain}</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f13;color:#e0e0e0">
<div style="text-align:center;max-width:520px;padding:40px">
  <div style="font-size:48px;margin-bottom:16px">🔒</div>
  <h2 style="margin:0 0 12px;font-size:22px;color:#fff">Unable to load this website</h2>
  <p style="margin:0 0 20px;color:#999;font-size:15px;line-height:1.5">${reason}</p>
  <div style="background:#1a1a24;border-radius:8px;padding:16px;margin:20px 0;text-align:left">
    <p style="margin:0 0 8px;color:#888;font-size:13px">Website URL:</p>
    <p style="margin:0;color:#6c9bff;font-size:14px;word-break:break-all">${url}</p>
  </div>
  <p style="margin:0;color:#666;font-size:13px;line-height:1.5">
    Some websites use aggressive bot protection (Cloudflare, Sucuri, etc.) that blocks automated access.
    Try loading the website directly in a new tab to verify it's accessible.
  </p>
</div>
</body></html>`;
}

// Detect if HTML is a security challenge/redirect page (not the real site content)
function isChallengePage(html, status) {
  if (!html) return false;
  
  // SiteGround-specific checks — these are always checked regardless of page size
  // because SiteGround challenge pages can be >5KB (embedded SVG robot, inline CSS)
  if (html.includes('sgcaptcha') || html.includes('SG-Captcha') || html.includes('powCaptcha')) return true;
  if (/Checking the site connection security/i.test(html)) return true;
  if (/sg-captcha-container|sg-challenge/i.test(html)) return true;
  if (/Robot Challenge|robot.?challenge/i.test(html)) return true;
  
  // Meta refresh to a challenge/captcha URL
  if (/meta\s+http-equiv=["']refresh["'][^>]*(?:captcha|challenge|\.well-known)/i.test(html)) return true;
  
  // Cloudflare checks — these can be large pages too
  if (isCloudflareBlock(html)) return true;
  
  // For remaining generic checks, only apply to small pages (<5KB)
  // Real content pages are large; generic redirect/challenge pages are tiny
  if (html.length > 5000) return false;
  
  // Very small HTML with just a redirect (likely a challenge)
  if (html.length < 500 && /meta\s+http-equiv=["']refresh["']/i.test(html)) return true;
  
  return false;
}

// Quick fetch with a tight timeout
async function quickFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    // Build headers with cached cookies from Puppeteer sessions
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    
    // Include cached cookies to bypass SiteGround/WAF challenges
    try {
      const hostname = new URL(url).hostname;
      const cachedCookies = getCookiesForDomain(hostname);
      if (cachedCookies) {
        headers["Cookie"] = cachedCookies;
      }
    } catch {}

    const res = await fetch(url, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const html = await res.text();
    return { ok: res.ok, status: res.status, html };
  } catch {
    clearTimeout(timeout);
    return { ok: false, status: 0, html: "" };
  }
}

// Fetch a single CSS file and return its content
async function fetchCSS(cssUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    // Build headers with cached cookies from Puppeteer sessions
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/css,*/*;q=0.1",
      "Referer": new URL(cssUrl).origin + "/",
    };
    
    // Include cached cookies to bypass SiteGround/WAF challenges
    try {
      const hostname = new URL(cssUrl).hostname;
      const cachedCookies = getCookiesForDomain(hostname);
      if (cachedCookies) {
        headers["Cookie"] = cachedCookies;
      }
    } catch {}
    
    const res = await fetch(cssUrl, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      // Reject HTML responses (SiteGround challenge pages masquerading as CSS)
      if (contentType.includes('text/html') || text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html')) {
        console.log(`[proxy] CSS fetch returned HTML (challenge page) for: ${cssUrl}`);
        return null;
      }
      return text;
    }
  } catch {}
  return null;
}

// Inline external CSS into the HTML to avoid cross-origin referer issues
async function inlineExternalCSS(html, targetOrigin) {
  // Find all <link rel="stylesheet" href="..."> tags
  const linkRegex = /<link([^>]*rel=["']stylesheet["'][^>]*)>/gi;
  const matches = [];
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (hrefMatch) {
      let cssUrl = hrefMatch[1];
      // Resolve relative URLs
      if (cssUrl.startsWith("/") && !cssUrl.startsWith("//")) {
        cssUrl = targetOrigin + cssUrl;
      } else if (cssUrl.startsWith("//")) {
        cssUrl = "https:" + cssUrl;
      }
      // Inline ALL CSS to bypass cross-origin issues
      // Skip only Google Fonts CSS API (serves different CSS per user-agent, works cross-origin)
      if (!cssUrl.includes("fonts.googleapis.com/css")) {
        matches.push({ tag, url: cssUrl });
      }
    }
  }

  // Fetch ALL CSS files in parallel
  const cssPromises = matches.map(async (m) => {
    const css = await fetchCSS(m.url);
    return { ...m, css };
  });
  
  const results = await Promise.all(cssPromises);
  
  let failedCount = 0;
  let inlinedCount = 0;
  
  // Replace <link> tags with inline <style> tags, or proxy if fetch failed
  for (const r of results) {
    if (r.css) {
      // Fix relative url() references in CSS to be absolute
      let fixedCSS = r.css.replace(
        /url\(\s*['"]?(?!data:|http|\/\/)(\/[^'")\s]+)['"]?\s*\)/gi,
        `url(${targetOrigin}$1)`
      );
      fixedCSS = fixedCSS.replace(
        /url\(\s*['"]?(?!data:|http|\/\/|\/)([^'")\s]+)['"]?\s*\)/gi,
        (match, path) => {
          const cssDir = r.url.substring(0, r.url.lastIndexOf("/") + 1);
          return `url(${cssDir}${path})`;
        }
      );
      html = html.replace(r.tag, `<style data-nexoos-inlined="${r.url}">${fixedCSS}</style>`);
      inlinedCount++;
    } else {
      // CSS fetch failed (WAF, timeout, etc.) — rewrite the link href 
      // to go through our asset proxy so the browser can still load it
      const proxiedHref = `/api/asset?url=${encodeURIComponent(r.url)}`;
      const newTag = r.tag.replace(/href=['"][^'"]+['"]/, `href="${proxiedHref}"`);
      html = html.replace(r.tag, newTag);
      failedCount++;
      console.log(`[proxy] CSS inline failed for ${r.url}, proxying link instead`);
    }
  }

  console.log(`[proxy] CSS inlining: ${inlinedCount} inlined, ${failedCount} failed out of ${matches.length} total`);
  return { html, failedCount, totalCount: matches.length };
}

// Strip ALL non-Nexoos scripts from the HTML
// For JS framework sites (Next.js, Nuxt, Remix, React SPA), the SSR HTML
// already contains the fully rendered content. Keeping scripts would cause
// hydration failures in the iframe ("This page couldn't load" errors).
function stripFrameworkScripts(html) {
  // 1. Extract CSS content embedded in script tags before removing them
  //    Many Next.js sites embed CSS-in-JS styles as data inside scripts
  const extractedStyles = [];
  
  // Extract __next_f.push data that contains CSS (Next.js RSC payloads)
  const rscChunks = [];
  html.replace(/<script[^>]*>self\.__next_f\.push\(\[[\d,]*"([^"]*(?:--[a-zA-Z][\w-]*|\.[\w-]+\s*\{|background|color|font)[^"]*)"\]\)<\/script>/gi,
    (match, content) => {
      // Unescape the JSON string content and look for CSS
      try {
        const unescaped = content.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        // Extract CSS-like blocks
        const cssBlocks = unescaped.match(/[\w\-.#\[\]:>~+*,\s]+\{[^}]+\}/g);
        if (cssBlocks && cssBlocks.length > 3) {
          extractedStyles.push(cssBlocks.join('\n'));
        }
      } catch {}
      return match;
    }
  );

  // 2. Remove all <script> tags EXCEPT our own Nexoos-injected ones
  html = html.replace(/<script(?![^>]*data-nexoos)[^>]*>[\s\S]*?<\/script>/gi, '');
  // Also remove <script> self-closing or empty tags
  html = html.replace(/<script(?![^>]*data-nexoos)[^>]*\/>/gi, '');
  
  // 3. Add dark mode support: if the page uses prefers-color-scheme dark
  //    or has dark mode CSS variables, inject a helper that applies dark class
  //    based on the user's system preference (since the JS that normally does this is stripped)
  const darkModeHelper = `<script data-nexoos="dark-mode">
(function(){
  try {
    var h = document.documentElement;
    if (!h.classList.contains('dark') && !h.classList.contains('light')) {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        h.classList.add('dark');
        h.style.colorScheme = 'dark';
      }
    }
  } catch(e){}
})();
</script>`;

  // 4. Inject extracted styles and dark mode helper
  if (extractedStyles.length > 0 || true) {
    const styleTag = extractedStyles.length > 0 
      ? `<style data-nexoos="extracted-css">${extractedStyles.join('\n')}</style>` 
      : '';
    
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, `$&${darkModeHelper}${styleTag}`);
    }
  }
  
  return html;
}

// Known CDN domains used by e-commerce platforms and CMS systems
const CDN_DOMAINS = [
  'cdn.shopify.com',
  'cdn.shopifycdn.net',
  'images.unsplash.com',
  'img.clerk.io',
  'cdn.jsdelivr.net',
  'cdn.builder.io',
  'images.contentful.com',
  'res.cloudinary.com',
  'cdn.sanity.io',
  'images.prismic.io',
  'cdn.bigcommerce.com',
  'akamaized.net',
  'cloudfront.net',
  'imgix.net',
  'fastly.net',
];

// Rewrite image/media/font URLs: resolve relative URLs to absolute (original domain)
// The page is served from our Railway domain, so relative URLs like /path/to/img.png
// would resolve to railway.app/path/to/img.png (404). We fix them to point to the
// original site. The browser can load <img> cross-origin without CORS issues.
function resolveAssetUrls(html, targetOrigin, proxyOrigin) {
  const hostname = new URL(targetOrigin).hostname;
  
  // Resolve relative URL to absolute on the ORIGINAL domain
  function resolveUrl(url) {
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/') && !url.startsWith('//')) return targetOrigin + url;
    if (url.startsWith('http')) return url;
    return null;
  }
  
  // Check if URL needs resolution (relative URL or needs to be made absolute)
  function shouldResolve(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/asset')) return false;
    // Only resolve relative URLs — absolute URLs are already fine
    if (url.startsWith('/') && !url.startsWith('//')) return true;
    if (url.startsWith('//')) return true;
    return false;
  }
  
  function getResolved(url) {
    return resolveUrl(url);
  }
  
  // 1. Resolve relative src and poster attributes to absolute URLs
  html = html.replace(
    /(\s(?:src|poster)\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, url, suffix) => {
      if (!shouldResolve(url)) return match;
      const resolved = getResolved(url);
      return resolved ? prefix + resolved + suffix : match;
    }
  );
  
  // 2. Resolve data-src, data-lazy-src, data-bg (WordPress/lazy-loading plugins)
  html = html.replace(
    /((?:data-src|data-lazy-src|data-bg|data-background-image|data-srcset)\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, url, suffix) => {
      if (match.toLowerCase().startsWith('data-srcset')) {
        const entries = url.split(',');
        const rewritten = entries.map(entry => {
          const trimmed = entry.trim();
          const parts = trimmed.split(/\s+/);
          if (parts[0] && shouldResolve(parts[0])) {
            parts[0] = getResolved(parts[0]) || parts[0];
          }
          return parts.join(' ');
        }).join(',');
        return prefix + rewritten + suffix;
      }
      if (!shouldResolve(url)) return match;
      const resolved = getResolved(url);
      return resolved ? prefix + resolved + suffix : match;
    }
  );
  
  // 3. Resolve srcset values
  html = html.replace(
    /((?:srcset|imageSrcSet)\s*=\s*["'])([^"']*)(["'])/gi,
    (match, prefix, srcset, suffix) => {
      const entries = srcset.split(',');
      const rewritten = entries.map(entry => {
        const trimmed = entry.trim();
        const parts = trimmed.split(/\s+/);
        if (parts[0] && shouldResolve(parts[0])) {
          parts[0] = getResolved(parts[0]) || parts[0];
        }
        return parts.join(' ');
      }).join(',');
      return prefix + rewritten + suffix;
    }
  );
  
  // 4. Resolve url() in CSS — relative URLs need to point to original domain
  html = html.replace(
    /url\(\s*['"]?(\/(?!\/|api\/)[^'")\s]+)['"]?\s*\)/gi,
    (match, url) => {
      const resolved = getResolved(url);
      return resolved ? `url(${resolved})` : match;
    }
  );
  
  return html;
}

// Inject Nexoos scripts into the HTML
function injectScripts(html, targetUrl, shouldStripScripts = false, proxyOrigin = '', usedBrowser = false) {
  if (shouldStripScripts) {
    html = stripFrameworkScripts(html);
  }
  
  // Resolve relative URLs to absolute (pointing to original domain)
  // Browser loads images directly — no proxying needed for most sites
  html = resolveAssetUrls(html, targetUrl.origin, proxyOrigin);
  
  const baseHref = `${targetUrl.origin}${targetUrl.pathname.replace(/\/[^/]*$/, "/")}`;

  // CSS to hide common popups, overlays, cookie banners, and chat widgets
  const popupCSS = `<style data-nexoos="popup-hide">
    /* Cookie consent banners */
    .cookie-banner, .cookie-notice, .cookie-consent, #cookie-notice, #cookie-banner,
    .cookies-popup, #CybotCookiebotDialog, .cc-window, .cc-banner,
    #gdpr-consent, .gdpr-banner, #onetrust-banner-sdk, #onetrust-consent-sdk,
    .qc-cmp-showing, #qcCmpButtons,
    /* Popup plugins */
    .pum-overlay, .pum-container, .sgpb-popup-overlay, .sgpb-popup-dialog-main-div,
    .hustle-popup-overlay, .hustle-popup, .optinmonster-overlay, #om-holder,
    .elementor-popup-modal, #elementor-popup-modal, .elementor-location-popup,
    /* Generic popups/modals/overlays */
    .modal-overlay, .modal-backdrop, .popup-overlay, .lightbox-overlay,
    .newsletter-popup, .email-popup,
    /* Chat widgets */
    .crisp-client, #hubspot-messages-iframe-container, #tidio-chat,
    .intercom-lightweight-app, .fb_dialog, #fb-root .fb_dialog {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Prevent body scroll lock from popup scripts and horizontal overflow */
    html, body {
      overflow-x: hidden !important;
      overflow-y: auto !important;
      position: static !important;
      height: auto !important;
      max-width: 100vw !important;
    }
    /* Hide scrollbars in mobile mode (still scrollable) */
    html, body, * {
      scrollbar-width: none !important;
    }
    ::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }
    /* JS-dependent carousels/sliders: make items visible without JavaScript */
    /* Raw JetElements carousel (BEFORE Slick.js initializes — Slick classes don't exist) */
    .jet-carousel .jet-carousel__items { display: flex !important; flex-wrap: wrap !important; overflow: visible !important; }
    .jet-carousel .jet-carousel__item { display: block !important; flex: 0 0 33.33% !important; max-width: 33.33% !important; visibility: visible !important; opacity: 1 !important; }
    .jet-carousel .jet-carousel__item-inner { display: block !important; visibility: visible !important; }
    .jet-carousel .jet-carousel__content { display: block !important; visibility: visible !important; }
    /* Slick slider (if somehow initialized) */
    .slick-track { display: flex !important; }
    .slick-slide { display: block !important; flex-shrink: 0; }
    .slick-list { overflow: hidden !important; }
    /* Swiper carousel (Elementor) */
    .swiper-wrapper { display: flex !important; }
    .swiper-slide { display: block !important; flex-shrink: 0 !important; visibility: visible !important; }
    /* Elementor carousel/slider */
    .elementor-slides .swiper-slide { display: block !important; }
    .elementor-image-carousel .swiper-slide { display: block !important; }
  </style>`;

  // Everything goes INSIDE <head> to preserve <!DOCTYPE> (prevents quirks mode)
  const headInjection = `<base href="${baseHref}">` +
    popupCSS +
    `<script data-nexoos="url-fix">try{Object.defineProperty(document,'referrer',{get:function(){return '${targetUrl.origin}'}});}catch(e){}</script>`;

  if (/<head([^>]*)>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  } else if (/<html([^>]*)>/i.test(html)) {
    html = html.replace(/<html([^>]*)>/i, `<html$1><head>${headInjection}</head>`);
  } else {
    html = `<head>${headInjection}</head>` + html;
  }

  const targetOrigin = targetUrl.origin;
  
  const injectedScript = `
<script data-nexoos="true">
(function() {
  var TARGET_ORIGIN = '${targetOrigin}';
  var PROXY_ORIGIN = window.location.origin;
  var ASSET_PROXY = PROXY_ORIGIN + '/api/asset?url=';
  var USED_BROWSER = ${usedBrowser ? 'true' : 'false'};

  // ===== IMAGE HANDLING: Direct loading with proxy fallback =====
  // Images use direct URLs to the original site (browser handles cross-origin <img> fine).
  // Only fall back to /api/asset proxy if an image fails to load (hotlink/WAF).
  {

  // Resolve any URL to absolute on the target origin
  function resolveUrl(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/asset')) return null;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return TARGET_ORIGIN + url;
    if (url.startsWith('http')) return url;
    return TARGET_ORIGIN + '/' + url;
  }

  // Proxy an image URL through our asset endpoint (fallback only)
  function proxyUrl(url) {
    var resolved = resolveUrl(url);
    if (!resolved) return null;
    return ASSET_PROXY + encodeURIComponent(resolved);
  }

  // Resolve relative URLs in an image element to absolute (original domain)
  function resolveImageUrls(img) {
    if (img.dataset.nexoosResolved) return;
    var src = img.getAttribute('src');
    if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('//') && !src.includes('/api/asset')) {
      var resolved = resolveUrl(src);
      if (resolved) {
        img.dataset.nexoosResolved = '1';
        img.setAttribute('src', resolved);
      }
    }
  }

  // 1. ERROR HANDLER: If any image fails to load directly, retry through proxy
  document.addEventListener('error', function(e) {
    var el = e.target;
    if (el.tagName === 'IMG' && !el.dataset.nexoosRetried) {
      el.dataset.nexoosRetried = '1';
      var src = el.getAttribute('src');
      if (src && !src.includes('/api/asset') && !src.startsWith('data:')) {
        var proxied = proxyUrl(src);
        if (proxied) el.setAttribute('src', proxied);
      }
    }
    // Also handle <source> errors inside <picture>
    if (el.tagName === 'SOURCE' && !el.dataset.nexoosRetried) {
      el.dataset.nexoosRetried = '1';
      var srcset = el.getAttribute('srcset');
      if (srcset && !srcset.includes('/api/asset')) {
        var entries = srcset.split(',');
        el.setAttribute('srcset', entries.map(function(entry) {
          var trimmed = entry.trim();
          var parts = trimmed.split(/\\s+/);
          var url = parts[0];
          if (!url || url.includes('/api/asset')) return entry;
          var p = proxyUrl(url);
          if (p) { parts[0] = p; return parts.join(' '); }
          return entry;
        }).join(','));
      }
    }
  }, true);

  // 2. Resolve relative URLs on existing images (page may have relative src that 
  //    the server-side resolver missed, e.g. dynamically generated)
  function resolveAllImages() {
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) resolveImageUrls(imgs[i]);
  }
  resolveAllImages();
  if (document.readyState !== 'complete') {
    window.addEventListener('load', resolveAllImages);
  }

  // 3. MUTATION OBSERVER: Resolve URLs on dynamically added images
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var nodes = mutations[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') resolveImageUrls(node);
        var imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
        for (var k = 0; k < imgs.length; k++) resolveImageUrls(imgs[k]);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  }

  // ===== SCROLL & NAVIGATION =====
  
  function sendScroll() {
    window.parent.postMessage({
      type: 'nexoos-scroll',
      scrollY: window.scrollY || 0,
      scrollX: window.scrollX || 0,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: window.innerHeight
    }, '*');
  }

  window.addEventListener('scroll', sendScroll, { passive: true });
  window.addEventListener('resize', sendScroll);
  
  if (document.readyState === 'complete') {
    sendScroll();
  } else {
    window.addEventListener('load', function() {
      setTimeout(sendScroll, 100);
      setTimeout(sendScroll, 500);
      setTimeout(sendScroll, 1500);
    });
  }
  sendScroll();

  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      var href = link.getAttribute('href');
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        window.parent.postMessage({ type: 'nexoos-link', href: link.href }, '*');
      }
    }
  }, true);

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'nexoos-scrollTo') {
      window.scrollTo({ top: e.data.top, behavior: 'smooth' });
    }
  });
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, injectedScript + "</body>");
  } else {
    html += injectedScript;
  }

  return html;
}

// Detect if the HTML is from a known JS framework (for script stripping)
function isJSFrameworkSite(html) {
  const isNextJS = /self\.__next_f\.push|__NEXT_DATA__|__next/i.test(html);
  const isReactSPA = /<div\s+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html);
  const isNuxt = /__NUXT__|window\.__nuxt/i.test(html);
  const isRemix = /window\.__remixContext/i.test(html);
  return isNextJS || isReactSPA || isNuxt || isRemix;
}

// Detect if the HTML is a JS-rendered shell that needs Puppeteer
// (i.e., has no meaningful CSS — the page is fully client-rendered)
function needsBrowserRendering(html) {
  const stylesheetCount = (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || []).length;
  const styleTagCount = (html.match(/<style[^>]*>[^<]{50,}<\/style>/gi) || []).length;

  if (isJSFrameworkSite(html) && stylesheetCount <= 2 && styleTagCount <= 1) return true;
  if (stylesheetCount === 0 && styleTagCount === 0) return true;

  return false;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const targetUrl = new URL(url);
    const result = await quickFetch(url);

    let html;
    let usedBrowser = false;
    let isJSFramework = false;

    if (result.ok && result.html && result.html.trim().length > 0 
        && !isCloudflareBlock(result.html) && !isChallengePage(result.html, result.status)) {
      html = result.html;
      isJSFramework = isJSFrameworkSite(html);

      if (needsBrowserRendering(html)) {
        console.log(`[proxy] JS-rendered site detected for ${url}, using Puppeteer`);
        try {
          html = await fetchWithBrowser(url);
          usedBrowser = true;
        } catch (browserError) {
          console.log(`[proxy] Puppeteer failed: ${browserError.message}, using fetch HTML (will strip scripts)`);
        }
      }
    } else {
      // Quick fetch failed (403, 5xx, timeout, etc.) — try Puppeteer
      const statusCode = result.status;
      console.log(`[proxy] Quick fetch failed for ${url} (HTTP ${statusCode}), using Puppeteer`);
      try {
        html = await fetchWithBrowser(url);
        usedBrowser = true;
        
        // SingleFile captures the full page with WAF cookies - output is trusted
      } catch (browserError) {
        console.log(`[proxy] Puppeteer also failed: ${browserError.message}`);
        // Check if quick fetch got any usable HTML (not a block/challenge page)
        if (result.html && result.html.trim().length > 0 
            && !isCloudflareBlock(result.html) && !isChallengePage(result.html, result.status)) {
          html = result.html;
          isJSFramework = isJSFrameworkSite(html);
        } else {
          // Return a friendly error page instead of a Cloudflare 403
          const reason = statusCode === 403 
            ? 'This website uses Cloudflare/WAF protection that is blocking automated access.'
            : browserError.message;
          html = buildBlockedErrorPage(url, reason);
        }
      }
    }

    // Always inline external CSS to bypass cross-origin blocking
    try {
      const cssResult = await inlineExternalCSS(html, targetUrl.origin);
      html = cssResult.html;
      

      
      // If many CSS files failed to inline, force a (re-)render with Puppeteer
      // The browser natively loads CSS, and document.styleSheets can extract it
      if (cssResult.failedCount > 3 && cssResult.failedCount > cssResult.totalCount * 0.5) {
        console.log(`[proxy] ${cssResult.failedCount}/${cssResult.totalCount} CSS files failed to inline, retrying with Puppeteer...`);
        try {
          html = await fetchWithBrowser(url);
          usedBrowser = true;
          isJSFramework = true; // Force script stripping for Puppeteer output
        } catch (browserError) {
          console.log(`[proxy] Puppeteer CSS retry failed: ${browserError.message}`);
          // Keep the quickFetch HTML with proxied CSS links as fallback
        }
      }
    } catch (e) {
      console.log(`[proxy] CSS inlining failed: ${e.message}`);
    }

    // Extract public proxy origin — behind Railway's reverse proxy, request.url
    // gives localhost:3000, but x-forwarded-host/proto give the real public domain
    const fwdHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
    const proxyOrigin = fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;
    console.log(`[proxy] proxyOrigin=${proxyOrigin} (fwdHost=${fwdHost}, fwdProto=${fwdProto}, reqUrl=${new URL(request.url).origin})`);

    // Strip scripts for JS framework sites (whether browser-rendered or fallback)
    // This prevents hydration failures in the iframe
    const shouldStripScripts = usedBrowser || isJSFramework;

    // Inject Nexoos scripts
    html = injectScripts(html, targetUrl, shouldStripScripts, proxyOrigin, usedBrowser);

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Frame-Options": "ALLOWALL",
        "Content-Security-Policy": "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval'; font-src * data:;",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cross-Origin-Embedder-Policy": "unsafe-none",
      },
    });
  } catch (error) {
    console.log(`[proxy] Fatal error for ${url}: ${error.message}`);
    // User-friendly error messages
    let title = "Unable to load this website";
    let message = "Something went wrong while loading the page.";
    const msg = error.message || "";
    if (msg.includes("ERR_NAME_NOT_RESOLVED")) {
      title = "Website not found";
      message = "This domain doesn't exist or couldn't be resolved. Please check the URL.";
    } else if (msg.includes("timeout") || msg.includes("Timeout")) {
      title = "Website took too long to respond";
      message = "The website didn't respond within the time limit. It may be slow or temporarily unavailable.";
    } else if (msg.includes("ERR_CONNECTION_REFUSED")) {
      title = "Connection refused";
      message = "The website's server refused the connection. It may be down or blocking automated access.";
    } else if (msg.includes("TIMED_OUT")) {
      title = "Connection timed out";
      message = "The website took too long to respond. It may be down or very slow.";
    } else if (msg.includes("ERR_SSL") || msg.includes("certificate")) {
      title = "SSL/Security error";
      message = "There's an issue with the website's security certificate.";
    }
    const errorHtml = `<!DOCTYPE html><html><head><title>${title}</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center;max-width:500px;padding:40px">
<div style="font-size:48px;margin-bottom:16px">⚠️</div>
<h2 style="margin:0 0 12px;color:#fff">${title}</h2>
<p style="margin:0 0 20px;color:#b0b0b0;line-height:1.5">${message}</p>
<p style="color:#666;font-size:12px;word-break:break-all">${msg}</p>
</div></body></html>`;
    return new NextResponse(errorHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "ALLOWALL",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }
}