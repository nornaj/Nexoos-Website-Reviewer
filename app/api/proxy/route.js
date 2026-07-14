import chromium from "@sparticuz/chromium";
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
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1000));

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
    const timeout = setTimeout(() => controller.abort(), 3000);
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
      // Only inline CSS from the same domain (skip Google Fonts, CDNs — those load fine cross-origin)
      if (cssUrl.includes(new URL(targetOrigin).hostname)) {
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

// Rewrite image/media URLs from the target domain to use our asset proxy
function proxyAssetUrls(html, targetOrigin) {
  const hostname = new URL(targetOrigin).hostname;
  
  // Rewrite img src, source srcset, video/audio src, poster
  // Match absolute URLs from the target domain in src/poster attributes
  html = html.replace(
    /((?:src|poster)\s*=\s*["'])(https?:\/\/[^"']*)/gi,
    (match, prefix, url) => {
      if (url.includes(hostname) && /\.(png|jpg|jpeg|gif|webp|svg|ico|avif|mp4|webm|mp3|woff2?|ttf|eot)/i.test(url)) {
        return `${prefix}/api/asset?url=${encodeURIComponent(url)}`;
      }
      return match;
    }
  );
  
  // Also catch relative URLs starting with / (not //) in src/poster
  html = html.replace(
    /((?:src|poster)\s*=\s*["'])\/((?!\/|api\/)[^"']*\.(png|jpg|jpeg|gif|webp|svg|ico|avif|mp4|webm))/gi,
    (match, prefix, path) => {
      return `${prefix}/api/asset?url=${encodeURIComponent(targetOrigin + '/' + path)}`;
    }
  );
  
  // Rewrite srcset values
  html = html.replace(
    /srcset\s*=\s*"([^"]*)"/gi,
    (match, srcset) => {
      const rewritten = srcset.replace(
        /(https?:\/\/[^\s,]+)/g,
        (url) => {
          if (url.includes(hostname) && /\.(png|jpg|jpeg|gif|webp|svg|ico|avif)/i.test(url)) {
            return `/api/asset?url=${encodeURIComponent(url)}`;
          }
          return url;
        }
      );
      return `srcset="${rewritten}"`;
    }
  );
  
  // Rewrite CSS background-image url() in inline styles
  html = html.replace(
    /url\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)/gi,
    (match, url) => {
      if (url.includes(hostname) && /\.(png|jpg|jpeg|gif|webp|svg|ico|avif)/i.test(url)) {
        return `url(/api/asset?url=${encodeURIComponent(url)})`;
      }
      return match;
    }
  );
  
  return html;
}

// Inject Nexoos scripts into the HTML
function injectScripts(html, targetUrl, wasBrowserRendered = false) {
  if (wasBrowserRendered) {
    html = stripFrameworkScripts(html);
  }
  
  // Proxy image/media URLs through our asset endpoint
  html = proxyAssetUrls(html, targetUrl.origin);

  const baseHref = `${targetUrl.origin}${targetUrl.pathname.replace(/\/[^/]*$/, "/")}`;

  // Everything goes INSIDE <head> to preserve <!DOCTYPE> (prevents quirks mode)
  // Use unsafe-url referrer so images load with a referer header (prevents hotlink blocking)
  const headInjection = `<base href="${baseHref}">` +
    `<meta name="referrer" content="unsafe-url">` +
    `<script data-nexoos="url-fix">history.replaceState(null,'','${targetUrl.pathname}${targetUrl.search || ''}');` +
    `Object.defineProperty(document,'referrer',{get:function(){return '${targetUrl.origin}'}});</script>`;

  if (/<head([^>]*)>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  } else if (/<html([^>]*)>/i.test(html)) {
    html = html.replace(/<html([^>]*)>/i, `<html$1><head>${headInjection}</head>`);
  } else {
    html = `<head>${headInjection}</head>` + html;
  }

  const injectedScript = `
<script data-nexoos="true">
(function() {
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
      console.log(`[proxy] Quick fetch failed for ${url} (HTTP ${result.status}), using Puppeteer`);
      html = await fetchWithBrowser(url);
      usedBrowser = true;
    }

    // Inline external CSS from the target domain to bypass referer-based blocking
    if (!usedBrowser) {
      try {
        html = await inlineExternalCSS(html, targetUrl.origin);
      } catch (e) {
        console.log(`[proxy] CSS inlining failed: ${e.message}`);
      }
    }

    // Inject Nexoos scripts
    html = injectScripts(html, targetUrl, usedBrowser);

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to proxy website", details: error.message },
      { status: 500 }
    );
  }
}
