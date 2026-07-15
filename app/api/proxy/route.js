import puppeteer from "puppeteer-core";
import { NextResponse } from "next/server";
import fs from "fs";

// Vercel serverless config
export const maxDuration = 60;

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
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}&stealth`,
    });
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Set a realistic user-agent to help bypass bot detection
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Use networkidle2 (allows 2 open connections) — networkidle0 is too strict
    // for sites with analytics, websockets, or continuous polling
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Detect and wait for Cloudflare JS challenge to resolve
    const isCloudflare = await page.evaluate(() => {
      const title = document.title || "";
      const text = document.body?.textContent || "";
      return (
        title.includes("Just a moment") ||
        text.includes("Checking the site connection security") ||
        text.includes("Verifying you are human") ||
        !!document.querySelector("#challenge-running, #challenge-stage")
      );
    });

    if (isCloudflare) {
      console.log(`[proxy] Cloudflare challenge detected for ${url}, waiting...`);
      try {
        // Wait up to 15 seconds for the challenge to resolve
        await page.waitForFunction(
          () => {
            const title = document.title || "";
            return (
              !title.includes("Just a moment") &&
              !document.querySelector("#challenge-running, #challenge-stage") &&
              document.body?.innerText?.length > 200
            );
          },
          { timeout: 15000 }
        );
        // Extra wait for page to fully render after challenge
        await new Promise((r) => setTimeout(r, 2000));
        console.log(`[proxy] Cloudflare challenge resolved for ${url}`);
      } catch {
        console.log(`[proxy] Cloudflare challenge did not resolve for ${url}`);
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

    const html = await page.content();
    await browser.close();
    return html;
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
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
      return await res.text();
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

// Strip client-side framework JS from Puppeteer-rendered HTML
function stripFrameworkScripts(html) {
  html = html.replace(/<script[^>]*>self\.__next_f\.push[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*src="\/_next\/static[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*id="__NEXT_DATA__"[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*>window\.__NUXT__[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*>window\.__remixContext[\s\S]*?<\/script>/gi, '');
  return html;
}

// Rewrite image/media/font URLs from the target domain to use our asset proxy
function proxyAssetUrls(html, targetOrigin, proxyOrigin) {
  const hostname = new URL(targetOrigin).hostname;
  const assetBase = `${proxyOrigin}/api/asset?url=`;
  
  // Extensions to skip (never proxy scripts/pages)
  const skipPattern = /\.(js|mjs|json|html|htm|php|aspx)(\?|#|$)/i;
  
  // Resolve relative URL to absolute
  function resolveUrl(url) {
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/') && !url.startsWith('//')) return targetOrigin + url;
    if (url.startsWith('http')) return url;
    return null;
  }
  
  // Check if URL should be proxied through our asset endpoint
  function shouldProxy(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/asset')) return false;
    if (skipPattern.test(url)) return false;
    const resolved = resolveUrl(url);
    return resolved && resolved.includes(hostname);
  }
  
  function getProxied(url) {
    const resolved = resolveUrl(url);
    return resolved ? assetBase + encodeURIComponent(resolved) : null;
  }
  
  // 1. Proxy ALL src and poster attributes from the target domain
  // (no file extension requirement — catches all images, videos, fonts)
  html = html.replace(
    /((?:src|poster)\s*=\s*["'])([^"']+)(["'])/gi,
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
        const rewritten = url.replace(
          /(https?:\/\/[^\s,]+|\/(?!\/|api\/)[^\s,]+)/g,
          (u) => {
            if (!shouldProxy(u)) return u;
            return getProxied(u) || u;
          }
        );
        return prefix + rewritten + suffix;
      }
      if (!shouldProxy(url)) return match;
      const proxied = getProxied(url);
      return proxied ? prefix + proxied + suffix : match;
    }
  );
  
  // 3. Proxy srcset values (responsive images)
  html = html.replace(
    /(srcset\s*=\s*["'])([^"']*)(["'])/gi,
    (match, prefix, srcset, suffix) => {
      const rewritten = srcset.replace(
        /(https?:\/\/[^\s,]+|\/(?!\/|api\/)[^\s,]+)/g,
        (url) => {
          if (!shouldProxy(url)) return url;
          return getProxied(url) || url;
        }
      );
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
function injectScripts(html, targetUrl, wasBrowserRendered = false, proxyOrigin = '') {
  if (wasBrowserRendered) {
    html = stripFrameworkScripts(html);
  }
  
  // Proxy image/media URLs through our asset endpoint (server-side)
  html = proxyAssetUrls(html, targetUrl.origin, proxyOrigin);
  
  const baseHref = `${targetUrl.origin}${targetUrl.pathname.replace(/\/[^/]*$/, "/")}`;

  // Everything goes INSIDE <head> to preserve <!DOCTYPE> (prevents quirks mode)
  const headInjection = `<base href="${baseHref}">` +
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
  
  // Convert any URL to an absolute URL using the target origin
  function resolveUrl(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/asset')) return null;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return TARGET_ORIGIN + url;
    if (url.startsWith('http')) return url;
    return TARGET_ORIGIN + '/' + url;
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
    if (src && !src.includes('/api/asset') && !src.startsWith('data:')) {
      var proxied = proxyUrl(src);
      if (proxied) {
        img.dataset.nexoosProxied = '1';
        img.setAttribute('src', proxied);
      }
    }
    // Also handle srcset
    var srcset = img.getAttribute('srcset');
    if (srcset && !srcset.includes('/api/asset')) {
      img.setAttribute('srcset', srcset.replace(/(https?:\\/\\/[^\\s,]+|\\/(\\w[^\\s,]*))/g, function(url) {
        if (url.includes('/api/asset')) return url;
        var p = proxyUrl(url);
        return p || url;
      }));
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
      if (src && !src.includes('/api/asset')) {
        var proxied = proxyUrl(src);
        if (proxied) el.setAttribute('src', proxied);
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
        s.srcset = s.srcset.replace(/(https?:\\/\\/[^\\s,]+|\\/(\\w[^\\s,]*))/g, function(url) {
          var p = proxyUrl(url);
          return p || url;
        });
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

// Detect if the HTML is a JS-rendered shell
function needsBrowserRendering(html) {
  const stylesheetCount = (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || []).length;
  const styleTagCount = (html.match(/<style[^>]*>[^<]{50,}<\/style>/gi) || []).length;

  const isNextJS = /self\.__next_f\.push|__NEXT_DATA__|__next/i.test(html);
  const isReactSPA = /<div\s+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html);
  const isNuxt = /__NUXT__|window\.__nuxt/i.test(html);
  const isRemix = /window\.__remixContext/i.test(html);

  const isJSFramework = isNextJS || isReactSPA || isNuxt || isRemix;

  if (isJSFramework && stylesheetCount <= 2 && styleTagCount <= 1) return true;
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

    if (result.ok && result.html && result.html.trim().length > 0) {
      html = result.html;

      if (needsBrowserRendering(html)) {
        console.log(`[proxy] JS-rendered site detected for ${url}, using Puppeteer`);
        try {
          html = await fetchWithBrowser(url);
          usedBrowser = true;
        } catch (browserError) {
          console.log(`[proxy] Puppeteer failed: ${browserError.message}, using fetch HTML`);
        }
      }
    } else {
      // Quick fetch failed — try Puppeteer, but fall back gracefully
      console.log(`[proxy] Quick fetch failed for ${url} (HTTP ${result.status}), using Puppeteer`);
      try {
        html = await fetchWithBrowser(url);
        usedBrowser = true;
      } catch (browserError) {
        console.log(`[proxy] Puppeteer also failed: ${browserError.message}`);
        // If quick fetch got SOME html (even with error status), use it
        if (result.html && result.html.trim().length > 0) {
          html = result.html;
        } else {
          // Last resort: return a friendly error page
          html = `<!DOCTYPE html><html><head><title>Unable to load</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0"><div style="text-align:center;max-width:500px"><h2>Unable to load this website</h2><p>The website may be blocking automated access or is temporarily unavailable.</p><p style="color:#888;font-size:14px">${browserError.message}</p></div></body></html>`;
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

    // Inject Nexoos scripts
    html = injectScripts(html, targetUrl, usedBrowser, proxyOrigin);

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
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
