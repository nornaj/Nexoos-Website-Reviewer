import puppeteer from "puppeteer-core";
import { NextResponse } from "next/server";
import fs from "fs";
import { setCookiesForDomain } from "../../../lib/cookie-cache";

// Vercel serverless config
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Find a locally installed Chrome for development
function getLocalChromePath() {
  const paths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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

// Fetch page HTML using a real headless browser (bypasses WAF/Cloudflare)
async function fetchWithBrowser(url) {
  const isDev = process.env.NODE_ENV === "development";
  let browser;

  if (isDev) {
    // Development: use locally installed Chrome
    const executablePath = getLocalChromePath();
    if (!executablePath) throw new Error("No local Chrome found");
    browser = await puppeteer.launch({
      headless: "shell",
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      defaultViewport: { width: 1280, height: 900 },
    });
  } else {
    // Production (Vercel): use Browserless.io cloud browser with stealth mode
    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) throw new Error("BROWSERLESS_TOKEN is not set");
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}&stealth&blockAds`,
    });
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    
    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    });

    // Use networkidle2 (allows 2 open connections) — networkidle0 is too strict
    // for sites with analytics, websockets, or continuous polling
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Detect security challenges: SiteGround PoW, Cloudflare, or generic
    const challengeType = await page.evaluate(() => {
      const title = (document.title || "").toLowerCase();
      // SiteGround: "Robot Challenge Screen", has #powCaptcha, uses sgchallenge variable
      if (title.includes("robot challenge") || document.querySelector("#powCaptcha") || typeof window.sgchallenge !== "undefined") {
        return "siteground";
      }
      // Cloudflare: "Just a moment", has challenge elements
      if (title.includes("just a moment") || document.querySelector("#challenge-running, #challenge-stage, .cf-challenge-running")) {
        return "cloudflare";
      }
      // Generic: page has very little content and mentions "checking" or "security"
      const text = document.body?.textContent || "";
      if (text.length < 500 && (text.includes("Checking") || text.includes("Verifying"))) {
        return "generic";
      }
      return null;
    });

    if (challengeType) {
      console.log(`[proxy] Security challenge detected (${challengeType}) for ${url}, waiting for redirect...`);
      try {
        // The challenge solves via Web Workers then redirects (may be 2+ hops)
        // Wait for navigation chain to complete
        for (let hop = 0; hop < 3; hop++) {
          try {
            await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 });
          } catch { break; }

          // Check if we've reached the real page
          const currentUrl = page.url();
          const currentTitle = await page.title();
          const isStillChallenge = currentUrl.includes(".well-known") || 
                                    currentUrl.includes("captcha") ||
                                    currentTitle.toLowerCase().includes("robot challenge") ||
                                    currentTitle.includes("Just a moment");
          if (!isStillChallenge) break;
        }
        // Extra wait for the real page to fully render
        await new Promise((r) => setTimeout(r, 3000));
        console.log(`[proxy] Security challenge resolved for ${url}, now at: ${page.url()}`);
      } catch (e) {
        console.log(`[proxy] Security challenge handling error for ${url}: ${e.message}`);
      }
    }

    // Wait for body to have real content
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (document.body && document.body.innerText.length > 100) return resolve();
        let checks = 0;
        const interval = setInterval(() => {
          checks++;
          if ((document.body && document.body.innerText.length > 100) || checks > 6) {
            clearInterval(interval);
            resolve();
          }
        }, 500);
      });
    });

    // Extract and inline all CSS from the browser's loaded stylesheets.
    // This solves the CSS rendering problem: the real browser has already
    // fetched all CSS (with correct referer, cookies, etc.), so we just
    // grab the parsed rules and inline them into <style> tags.
    await page.evaluate(async () => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        if (!sheet.href) continue; // Skip already-inline styles
        try {
          // Try accessing rules directly (same-origin stylesheets)
          const rules = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
          const style = document.createElement('style');
          style.setAttribute('data-nexoos-browser-inlined', sheet.href);
          style.textContent = rules;
          if (sheet.ownerNode && sheet.ownerNode.parentNode) {
            sheet.ownerNode.parentNode.insertBefore(style, sheet.ownerNode);
            sheet.ownerNode.remove();
          }
        } catch (e) {
          // Cross-origin stylesheet — fetch from within the page context
          // (the browser has the correct origin/referer, so this works)
          try {
            const res = await fetch(sheet.href);
            if (res.ok) {
              const cssText = await res.text();
              const style = document.createElement('style');
              style.setAttribute('data-nexoos-browser-inlined', sheet.href);
              style.textContent = cssText;
              if (sheet.ownerNode && sheet.ownerNode.parentNode) {
                sheet.ownerNode.parentNode.insertBefore(style, sheet.ownerNode);
                sheet.ownerNode.remove();
              }
            }
          } catch (fetchErr) {
            // Can't access this stylesheet — leave the link tag as-is
          }
        }
      }
    });

    // Dismiss popups, modals, overlays, cookie banners before extracting HTML
    console.log(`[proxy] Dismissing popups/overlays for ${url}...`);
    await page.evaluate(() => {
      // Common popup/modal/overlay selectors
      const popupSelectors = [
        // Cookie consent
        '.cookie-banner', '.cookie-notice', '.cookie-consent', '#cookie-notice',
        '#cookie-banner', '.cookies-popup', '[class*="cookie"]',
        '#CybotCookiebotDialog', '.cc-window', '.cc-banner',
        '#gdpr-consent', '.gdpr-banner', '[class*="gdpr"]',
        '#onetrust-banner-sdk', '#onetrust-consent-sdk',
        '.qc-cmp-showing', '#qcCmpButtons',
        // Newsletter / signup popups
        '.newsletter-popup', '.popup-overlay', '.email-popup',
        '[class*="newsletter-popup"]', '[class*="popup-modal"]',
        // Generic modals/overlays  
        '.modal-overlay', '.modal-backdrop', '.modal.show',
        '.overlay', '.popup', '.lightbox-overlay',
        '[class*="modal-overlay"]', '[class*="popup-overlay"]',
        // WordPress specific popup plugins
        '.pum-overlay', '.pum-container', // Popup Maker
        '.sgpb-popup-overlay', '.sgpb-popup-dialog-main-div', // Popup Builder
        '.hustle-popup-overlay', '.hustle-popup', // Hustle
        '.optinmonster-overlay', '#om-holder', // OptinMonster
        '.elementor-popup-modal', // Elementor popups
        '#elementor-popup-modal', '.dialog-widget',
        '.elementor-location-popup',
        // Notification bars
        '.notification-bar', '.announcement-bar', '.top-bar-notice',
        // Chat widgets
        '.crisp-client', '#hubspot-messages-iframe-container',
        '#tidio-chat', '.intercom-lightweight-app',
      ];

      // Close button selectors — try clicking them first
      const closeSelectors = [
        '.close-popup', '.popup-close', '.modal-close',
        '.cookie-close', '.banner-close',
        '[class*="close"]', '[aria-label="Close"]', '[aria-label="close"]',
        '.pum-close', '.sgpb-popup-close-button',
        'button.close', '.btn-close',
      ];

      // Try clicking close buttons inside popups
      for (const sel of closeSelectors) {
        try {
          const buttons = document.querySelectorAll(sel);
          buttons.forEach(btn => {
            try { btn.click(); } catch {}
          });
        } catch {}
      }

      // Remove popup/overlay elements
      for (const sel of popupSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          els.forEach(el => el.remove());
        } catch {}
      }

      // Remove elements with high z-index that cover the page (likely overlays)
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        try {
          const style = window.getComputedStyle(el);
          const zIndex = parseInt(style.zIndex, 10);
          const position = style.position;
          const isFixed = position === 'fixed' || position === 'sticky';
          const isFullScreen = el.offsetWidth > window.innerWidth * 0.8 && 
                               el.offsetHeight > window.innerHeight * 0.8;
          const isOverlay = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                            style.opacity !== '0';
          
          // Remove full-screen fixed overlays with high z-index
          if (isFixed && zIndex > 999 && isFullScreen && isOverlay) {
            el.remove();
          }
          // Remove modal backdrops (semi-transparent full-screen overlays)
          if (isFixed && isFullScreen && parseFloat(style.opacity) < 0.9 && zIndex > 100) {
            const bgColor = style.backgroundColor;
            if (bgColor.includes('rgba') && bgColor.includes('0.')) {
              el.remove();
            }
          }
        } catch {}
      }

      // Fix body scroll — popups often set overflow:hidden on body
      document.body.style.overflow = '';
      document.body.style.overflowY = '';
      document.body.style.position = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.overflowY = '';
    });

    // Convert images to inline data URIs from within the browser
    // (the browser has the SiteGround cookies, so it can fetch assets)
    console.log(`[proxy] Converting images to inline data URIs for ${url}...`);

    // Trigger lazy-loaded images by scrolling through the page
    await page.evaluate(async () => {
      const step = Math.max(window.innerHeight, 500);
      const max = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      for (let y = 0; y < max; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 200));
      }
      window.scrollTo(0, 0);
    });
    // Wait for lazy images to start loading
    await new Promise(r => setTimeout(r, 1500));

    await page.evaluate(async () => {
      // Cache: url -> dataUri (avoids re-fetching the same URL)
      const cache = new Map();

      async function fetchAsDataUri(url, timeout = 8000) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
        if (cache.has(url)) return cache.get(url);
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) { cache.set(url, null); return null; }
          const blob = await res.blob();
          if (blob.size > 4 * 1024 * 1024) { cache.set(url, null); return null; }
          const result = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
          cache.set(url, result);
          return result;
        } catch { cache.set(url, null); return null; }
      }

      const batchSize = 6;
      async function processBatch(items, handler) {
        for (let i = 0; i < items.length; i += batchSize) {
          await Promise.allSettled(items.slice(i, i + batchSize).map(handler));
        }
      }

      // 1. Convert <img> elements (the proven approach)
      const imgs = Array.from(document.querySelectorAll('img[src]'));
      await processBatch(imgs, async (img) => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
        const dataUri = await fetchAsDataUri(src);
        if (dataUri) {
          img.setAttribute('src', dataUri);
          img.removeAttribute('srcset');
          img.removeAttribute('data-srcset');
        }
      });

      // 2. Convert lazy-loaded images (only if src is missing/placeholder)
      const lazyImgs = Array.from(document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]'));
      await processBatch(lazyImgs, async (img) => {
        const currentSrc = img.getAttribute('src') || '';
        if (currentSrc.startsWith('data:image') && currentSrc.length > 100) return; // Already converted
        const lazySrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
        if (!lazySrc || lazySrc.startsWith('data:')) return;
        const dataUri = await fetchAsDataUri(lazySrc);
        if (dataUri) {
          img.setAttribute('src', dataUri);
          img.removeAttribute('srcset');
          img.removeAttribute('data-srcset');
        }
      });

      // 3. Convert <picture> <source> srcset
      const sources = Array.from(document.querySelectorAll('picture source[srcset]'));
      await processBatch(sources, async (source) => {
        const srcset = source.getAttribute('srcset');
        if (!srcset || srcset.startsWith('data:')) return;
        const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
        const dataUri = await fetchAsDataUri(firstUrl);
        if (dataUri) {
          source.setAttribute('srcset', dataUri);
        }
      });

      // 4. Convert <video poster>
      const videos = Array.from(document.querySelectorAll('video[poster]'));
      await processBatch(videos, async (video) => {
        const poster = video.getAttribute('poster');
        if (!poster || poster.startsWith('data:')) return;
        const dataUri = await fetchAsDataUri(poster);
        if (dataUri) {
          video.setAttribute('poster', dataUri);
        }
      });

      // 5. Convert computed CSS background images (catches class-based backgrounds)
      const allEls = Array.from(document.querySelectorAll('div, section, article, header, footer, figure, span, a, li, main, aside, nav, picture, p'));
      const bgItems = [];
      for (const el of allEls) {
        try {
          const bg = window.getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none' && bg.includes('url(') && !bg.includes('data:')) {
            bgItems.push({ el, bg });
          }
        } catch {}
      }
      await processBatch(bgItems, async ({ el, bg }) => {
        // Match ANY url() — computed styles always return absolute URLs
        const urlRegex = /url\(\s*["']?((?:https?:\/\/|\/\/)[^"'\)\s]+)["']?\s*\)/gi;
        let newBg = bg;
        let changed = false;
        let match;
        while ((match = urlRegex.exec(bg)) !== null) {
          let imgUrl = match[1];
          // Protocol-relative URLs
          if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
          const dataUri = await fetchAsDataUri(imgUrl);
          if (dataUri) {
            newBg = newBg.replace(match[0], `url(${dataUri})`);
            changed = true;
          }
        }
        if (changed) el.style.backgroundImage = newBg;
      });

      // 6. Handle data-bg attributes (common lazy-load pattern)
      const dataBgEls = Array.from(document.querySelectorAll('[data-bg], [data-background]'));
      await processBatch(dataBgEls, async (el) => {
        const bgUrl = el.getAttribute('data-bg') || el.getAttribute('data-background');
        if (!bgUrl || bgUrl.startsWith('data:')) return;
        const dataUri = await fetchAsDataUri(bgUrl);
        if (dataUri) el.style.backgroundImage = `url(${dataUri})`;
      });
    });
    console.log(`[proxy] Image conversion complete for ${url}`);

    const html = await page.content();

    // Extract and cache cookies from the browser session
    try {
      const cookies = await page.cookies();
      if (cookies.length > 0) {
        const domain = new URL(url).hostname;
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        setCookiesForDomain(domain, cookieStr);
      }
    } catch {}

    await browser.close();
    return html;
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

// Detect if HTML is a Cloudflare/WAF block page (403 Forbidden, challenge, etc.)
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
  // Sucuri WAF block (very specific — requires Sucuri branding)
  if (/sucuri\.net|cloudproxy/i.test(html) && /blocked|access denied/i.test(html) && html.length < 5000) return true;
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
  // SiteGround captcha challenge (202 + tiny meta-refresh to sgcaptcha)
  if (html.includes('sgcaptcha') || html.includes('SG-Captcha') || html.includes('powCaptcha')) return true;
  // Meta refresh to a challenge/captcha URL with very short HTML
  if (html.length < 1000 && /meta\s+http-equiv=["']refresh["'][^>]*(?:captcha|challenge|\.well-known)/i.test(html)) return true;
  // Cloudflare challenge pages
  if (isCloudflareBlock(html)) return true;
  // Very small HTML with just a redirect (likely a challenge)
  if (html.length < 500 && /meta\s+http-equiv=["']refresh["']/i.test(html)) return true;
  // Robot Challenge Screen (SiteGround)
  if (/Robot Challenge|robot.?challenge/i.test(html)) return true;
  return false;
}

// Quick fetch with a tight timeout
async function quickFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
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
    const res = await fetch(cssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/css,*/*;q=0.1",
        "Referer": new URL(cssUrl).origin + "/",
      },
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
  
  // Replace <link> tags with inline <style> tags
  for (const r of results) {
    if (r.css) {
      // Fix relative url() references in CSS to be absolute
      let fixedCSS = r.css.replace(
        /url\(\s*['"]?(?!data:|http|\/\/)(\/[^'")]+)['"]?\s*\)/gi,
        `url(${targetOrigin}$1)`
      );
      fixedCSS = fixedCSS.replace(
        /url\(\s*['"]?(?!data:|http|\/\/|\/)([^'")]+)['"]?\s*\)/gi,
        (match, path) => {
          const cssDir = r.url.substring(0, r.url.lastIndexOf("/") + 1);
          return `url(${cssDir}${path})`;
        }
      );
      html = html.replace(r.tag, `<style data-nexoos-inlined="${r.url}">${fixedCSS}</style>`);
    }
  }

  return html;
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

// Rewrite image/media/font URLs from the target domain to use our asset proxy
function proxyAssetUrls(html, targetOrigin, proxyOrigin) {
  const hostname = new URL(targetOrigin).hostname;
  const assetBase = `${proxyOrigin}/api/asset?url=`;
  
  // Extensions to skip (never proxy scripts/pages)
  const skipPattern = /\.(js|mjs|json|html|htm|php|aspx)(\?|#|$)/i;
  
  // Media/image extensions to always proxy regardless of domain
  const mediaPattern = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|ogg|woff2?|ttf|eot|otf)(\?|#|$)/i;
  
  // Resolve relative URL to absolute
  function resolveUrl(url) {
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/') && !url.startsWith('//')) return targetOrigin + url;
    if (url.startsWith('http')) return url;
    return null;
  }
  
  // Check if a URL belongs to a known CDN
  function isCdnUrl(url) {
    try {
      const resolved = resolveUrl(url);
      if (!resolved) return false;
      const urlHost = new URL(resolved).hostname;
      return CDN_DOMAINS.some(cdn => urlHost === cdn || urlHost.endsWith('.' + cdn));
    } catch { return false; }
  }
  
  // Check if URL should be proxied through our asset endpoint
  function shouldProxy(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/asset')) return false;
    if (skipPattern.test(url)) return false;
    const resolved = resolveUrl(url);
    if (!resolved) return false;
    // Proxy ALL http(s) URLs — in the iframe context, cross-origin resources
    // will fail due to different origin, so everything needs proxying
    return true;
  }
  
  function getProxied(url) {
    const resolved = resolveUrl(url);
    return resolved ? assetBase + encodeURIComponent(resolved) : null;
  }
  
  // 1. Proxy ALL src and poster attributes from the target domain
  // (no file extension requirement — catches all images, videos, fonts)
  // Use \s before src/poster to avoid matching data-src, data-poster etc.
  html = html.replace(
    /(\s(?:src|poster)\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, url, suffix) => {
      if (!shouldProxy(url)) return match;
      const proxied = getProxied(url);
      return proxied ? prefix + proxied + suffix : match;
    }
  );
  
  // 2. Proxy data-src, data-lazy-src, data-bg (WordPress/lazy-loading plugins)
  html = html.replace(
    /((?:data-src|data-lazy-src|data-bg|data-background-image|data-srcset)\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, url, suffix) => {
      // Handle data-srcset specially (comma-separated)
      if (match.toLowerCase().startsWith('data-srcset')) {
        const entries = url.split(/,(?=\s*(?:https?:\/\/|\/\/|\/(?!\/)))/);
        const rewritten = entries.map(entry => {
          return entry.replace(
            /(https?:\/\/[^\s]+|\/\/[^\s]+|\/(?!\/|api\/)[^\s]+)/,
            (u) => {
              if (!shouldProxy(u)) return u;
              return getProxied(u) || u;
            }
          );
        }).join(',');
        return prefix + rewritten + suffix;
      }
      if (!shouldProxy(url)) return match;
      const proxied = getProxied(url);
      return proxied ? prefix + proxied + suffix : match;
    }
  );
  
  // 3. Proxy srcset values (responsive images)
  // Note: can't simply split on commas — URLs may contain commas (e.g., Cloudflare /cdn-cgi/image/width=1200,quality=80/...)
  // Instead, we match each srcset entry as: URL followed by optional whitespace+descriptor, then comma or end
  html = html.replace(
    /((?:srcset|imageSrcSet)\s*=\s*["'])([^"']*)(["'])/gi,
    (match, prefix, srcset, suffix) => {
      // Parse srcset: split on comma followed by optional whitespace and a URL-start character
      // Each entry is: <url> [<descriptor>]
      const entries = srcset.split(/,(?=\s*(?:https?:\/\/|\/\/|\/(?!\/)))/);
      const rewritten = entries.map(entry => {
        // Match the URL part (everything up to the last whitespace+descriptor like "1x" or "768w")
        return entry.replace(
          /(https?:\/\/[^\s]+|\/\/[^\s]+|\/(?!\/|api\/)[^\s]+)/,
          (url) => {
            if (!shouldProxy(url)) return url;
            return getProxied(url) || url;
          }
        );
      }).join(',');
      return prefix + rewritten + suffix;
    }
  );
  
  // 4. Proxy url() in ALL CSS — inline styles, <style> tags, browser-inlined CSS
  // This catches background-image, @font-face src, cursor, etc.
  html = html.replace(
    /url\(\s*['"]?(https?:\/\/[^'")\s]+|\/(?!\/|api\/)[^'")\s]+)['"]?\s*\)/gi,
    (match, url) => {
      if (!shouldProxy(url)) return match;
      const proxied = getProxied(url);
      return proxied ? `url(${proxied})` : match;
    }
  );
  
  return html;
}

// Inject Nexoos scripts into the HTML
function injectScripts(html, targetUrl, shouldStripScripts = false, proxyOrigin = '') {
  if (shouldStripScripts) {
    html = stripFrameworkScripts(html);
  }
  
  // Proxy image/media URLs through our asset endpoint (server-side)
  html = proxyAssetUrls(html, targetUrl.origin, proxyOrigin);
  
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
    /* Prevent body scroll lock from popup scripts */
    html, body {
      overflow: auto !important;
      position: static !important;
      height: auto !important;
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

  // ===== IMAGE PROXY: Permanent catch-all solution =====
  
  // Known CDN domains to always proxy
  var CDN_DOMAINS = ['cdn.shopify.com','cdn.shopifycdn.net','images.unsplash.com','cdn.jsdelivr.net','cdn.builder.io','images.contentful.com','res.cloudinary.com','cdn.sanity.io','images.prismic.io','cdn.bigcommerce.com','akamaized.net','cloudfront.net','imgix.net','fastly.net'];
  var MEDIA_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|woff2?|ttf|eot|otf)(\?|#|$)/i;

  // Convert any URL to an absolute URL using the target origin
  function resolveUrl(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/asset')) return null;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return TARGET_ORIGIN + url;
    if (url.startsWith('http')) return url;
    return TARGET_ORIGIN + '/' + url;
  }

  function isCdnUrl(url) {
    try {
      var resolved = resolveUrl(url);
      if (!resolved) return false;
      var h = new URL(resolved).hostname;
      for (var i = 0; i < CDN_DOMAINS.length; i++) {
        if (h === CDN_DOMAINS[i] || h.endsWith('.' + CDN_DOMAINS[i])) return true;
      }
    } catch(e) {}
    return false;
  }

  function shouldProxyUrl(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/asset')) return false;
    var resolved = resolveUrl(url);
    return !!resolved;
  }

  // Proxy an image URL through our asset endpoint
  function proxyUrl(url) {
    var resolved = resolveUrl(url);
    if (!resolved) return null;
    return ASSET_PROXY + encodeURIComponent(resolved);
  }

  // Rewrite a single image element's src to use the proxy
  function proxyImage(img) {
    if (img.dataset.nexoosProxied) return;
    var src = img.getAttribute('src');
    if (src && !src.includes('/api/asset') && !src.startsWith('data:') && shouldProxyUrl(src)) {
      var proxied = proxyUrl(src);
      if (proxied) {
        img.dataset.nexoosProxied = '1';
        img.setAttribute('src', proxied);
      }
    }
    // Also handle srcset
    var srcset = img.getAttribute('srcset');
    if (srcset && !srcset.includes('/api/asset')) {
      var entries = srcset.split(/,(?=\s*(?:https?:\/\/|\/\/|\/(?!\/)))/);
      img.setAttribute('srcset', entries.map(function(entry) {
        return entry.replace(/(https?:\/\/[^\s]+|\/\/[^\s]+|\/(?!\/|api\/)[^\s]+)/, function(url) {
          if (url.includes('/api/asset')) return url;
          if (!shouldProxyUrl(url)) return url;
          var p = proxyUrl(url);
          return p || url;
        });
      }).join(','));
    }
    // Handle data-src (lazy loading)
    var dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
    if (dataSrc && !dataSrc.includes('/api/asset') && !dataSrc.startsWith('data:')) {
      var proxied = proxyUrl(dataSrc);
      if (proxied) {
        img.setAttribute('data-src', proxied);
        if (img.getAttribute('data-lazy-src')) img.setAttribute('data-lazy-src', proxied);
      }
    }
  }

  // Rewrite background-image in inline styles
  function proxyBackgroundImages(el) {
    var style = el.getAttribute('style');
    if (style && style.includes('url(') && !style.includes('/api/asset')) {
      el.setAttribute('style', style.replace(/url\\(\\s*['"]?([^'")\\s]+)['"]?\\s*\\)/gi, function(match, url) {
        if (url.startsWith('data:') || url.includes('/api/asset')) return match;
        var p = proxyUrl(url);
        return p ? 'url(' + p + ')' : match;
      }));
    }
  }

  // 1. CATCH-ALL ERROR HANDLER: If any image fails, retry through proxy
  document.addEventListener('error', function(e) {
    var el = e.target;
    if (el.tagName === 'IMG' && !el.dataset.nexoosRetried) {
      el.dataset.nexoosRetried = '1';
      var src = el.getAttribute('src');
      if (src && !src.includes('/api/asset') && !src.startsWith('data:')) {
        // On error, always try proxying regardless of domain — the image failed anyway
        var proxied = proxyUrl(src);
        if (proxied) el.setAttribute('src', proxied);
      }
    }
    // Also handle <source> errors inside <picture>
    if (el.tagName === 'SOURCE' && !el.dataset.nexoosRetried) {
      el.dataset.nexoosRetried = '1';
      var srcset = el.getAttribute('srcset');
      if (srcset && !srcset.includes('/api/asset')) {
        var entries = srcset.split(/,(?=\s*(?:https?:\/\/|\/\/|\/(?!\/)))/);
        el.setAttribute('srcset', entries.map(function(entry) {
          return entry.replace(/(https?:\/\/[^\s]+|\/\/[^\s]+|\/(?!\/|api\/)[^\s]+)/, function(url) {
            if (url.includes('/api/asset')) return url;
            var p = proxyUrl(url);
            return p || url;
          });
        }).join(','));
      }
    }
  }, true);

  // 2. PROACTIVE: Rewrite all existing images on page load
  function proxyAllImages() {
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) proxyImage(imgs[i]);
    // Also handle elements with background-image
    var allEls = document.querySelectorAll('[style*="url"]');
    for (var i = 0; i < allEls.length; i++) proxyBackgroundImages(allEls[i]);
    // Handle <source> elements (picture, video, audio)
    var sources = document.querySelectorAll('source[srcset], source[src]');
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (s.srcset && !s.srcset.includes('/api/asset')) {
        var entries = s.srcset.split(/,(?=\s*(?:https?:\/\/|\/\/|\/(?!\/)))/);
        s.srcset = entries.map(function(entry) {
          return entry.replace(/(https?:\/\/[^\s]+|\/\/[^\s]+|\/(?!\/|api\/)[^\s]+)/, function(url) {
            if (!shouldProxyUrl(url)) return url;
            var p = proxyUrl(url);
            return p || url;
          });
        }).join(',');
      }
    }
  }
  proxyAllImages();
  if (document.readyState !== 'complete') {
    window.addEventListener('load', proxyAllImages);
  }

  // 3. MUTATION OBSERVER: Catch dynamically added images
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var nodes = mutations[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') proxyImage(node);
        var imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
        for (var k = 0; k < imgs.length; k++) proxyImage(imgs[k]);
      }
      // Handle src attribute changes
      if (mutations[i].type === 'attributes' && mutations[i].attributeName === 'src') {
        var target = mutations[i].target;
        if (target.tagName === 'IMG' && !target.dataset.nexoosProxied) {
          proxyImage(target);
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

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
        
        // Verify Puppeteer didn't also get stuck on a challenge page
        // (only check for challenge pages, NOT generic isCloudflareBlock which can false-positive on real content)
        if (html && isChallengePage(html, 0)) {
          console.log(`[proxy] Puppeteer also got a challenge page for ${url}`);
          html = buildBlockedErrorPage(url, 'This website has bot protection that could not be bypassed automatically.');
          usedBrowser = false;
        }
      } catch (browserError) {
        console.log(`[proxy] Puppeteer also failed: ${browserError.message}`);
        // Check if quick fetch got any usable HTML (not a Cloudflare block)
        if (result.html && result.html.trim().length > 0 && !isCloudflareBlock(result.html)) {
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
      html = await inlineExternalCSS(html, targetUrl.origin);
    } catch (e) {
      console.log(`[proxy] CSS inlining failed: ${e.message}`);
    }

    // Extract proxy origin from request URL
    const reqUrl = new URL(request.url);
    const proxyOrigin = reqUrl.origin;

    // Strip scripts for JS framework sites (whether browser-rendered or fallback)
    // This prevents hydration failures in the iframe
    const shouldStripScripts = usedBrowser || isJSFramework;

    // Inject Nexoos scripts
    html = injectScripts(html, targetUrl, shouldStripScripts, proxyOrigin);

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
