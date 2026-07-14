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
    // @sparticuz/chromium v149+ API: headless is baked into args,
    // use "shell" mode, pass args directly
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }

  try {
    const page = await browser.newPage();
    // Use networkidle0 to ensure all resources (CSS, JS) are loaded
    await page.goto(url, { waitUntil: "networkidle0", timeout: 20000 });
    
    // Wait for stylesheets to be applied and JS to render
    await new Promise((r) => setTimeout(r, 1000));
    
    // For JS-rendered sites, wait for the body to have real content
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (document.body && document.body.innerText.length > 100) {
          return resolve();
        }
        // Wait up to 3 more seconds for content to appear
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

// Strip client-side framework JS from Puppeteer-rendered HTML
// These scripts try to hydrate the page and fail on a different origin
function stripFrameworkScripts(html) {
  // Remove Next.js bootstrap/hydration scripts
  html = html.replace(/<script[^>]*>self\.__next_f\.push[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*src="\/_next\/static[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*id="__NEXT_DATA__"[\s\S]*?<\/script>/gi, '');
  
  // Remove Nuxt hydration scripts
  html = html.replace(/<script[^>]*>window\.__NUXT__[\s\S]*?<\/script>/gi, '');
  
  // Remove Remix hydration scripts
  html = html.replace(/<script[^>]*>window\.__remixContext[\s\S]*?<\/script>/gi, '');
  
  return html;
}

// Inject Nexoos scripts into the HTML
function injectScripts(html, targetUrl, wasBrowserRendered = false) {
  // If this was rendered by Puppeteer (JS framework), strip hydration scripts
  // to prevent "This page couldn't load" errors
  if (wasBrowserRendered) {
    html = stripFrameworkScripts(html);
  }

  const baseHref = `${targetUrl.origin}${targetUrl.pathname.replace(/\/[^/]*$/, "/")}`;
  
  // The urlFix + base tag go INSIDE <head> to preserve <!DOCTYPE> (prevents quirks mode)
  const headInjection = `<base href="${baseHref}">` +
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
// Detect if the HTML is a JS-rendered shell that needs a real browser to render
function needsBrowserRendering(html) {
  // Count real stylesheet links
  const stylesheetCount = (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || []).length;
  // Count style tags with actual CSS (not empty)
  const styleTagCount = (html.match(/<style[^>]*>[^<]{50,}<\/style>/gi) || []).length;
  
  // Check for JS framework shell markers
  const isNextJS = /self\.__next_f\.push|__NEXT_DATA__|__next/i.test(html);
  const isReactSPA = /<div\s+id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>/i.test(html);
  const isNuxt = /__NUXT__|window\.__nuxt/i.test(html);
  const isRemix = /window\.__remixContext/i.test(html);
  
  const isJSFramework = isNextJS || isReactSPA || isNuxt || isRemix;
  
  // If it's a JS framework with very few stylesheets, it needs browser rendering
  if (isJSFramework && stylesheetCount <= 2 && styleTagCount <= 1) {
    return true;
  }
  
  // If there's almost no CSS at all, something is wrong
  if (stylesheetCount === 0 && styleTagCount === 0) {
    return true;
  }
  
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

    // Step 1: Quick fetch (4s timeout) — works for most normal sites
    const result = await quickFetch(url);

    let html;
    let usedBrowser = false;

    if (result.ok && result.html && result.html.trim().length > 0) {
      html = result.html;

      // Step 2: Check if the HTML is a JS-rendered shell (needs full browser)
      if (needsBrowserRendering(html)) {
        console.log(`[proxy] JS-rendered site detected for ${url}, using Puppeteer for full render`);
        try {
          html = await fetchWithBrowser(url);
          usedBrowser = true;
        } catch (browserError) {
          console.log(`[proxy] Puppeteer failed for JS render: ${browserError.message}, using fetch HTML`);
          // Fall back to the simple fetch HTML — better than nothing
        }
      }
    } else {
      // Step 2b: Fetch failed (non-2xx or empty) — use Puppeteer
      console.log(`[proxy] Quick fetch failed for ${url} (HTTP ${result.status}), using Puppeteer`);
      html = await fetchWithBrowser(url);
      usedBrowser = true;
    }

    // Step 3: Inject scripts and return
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
