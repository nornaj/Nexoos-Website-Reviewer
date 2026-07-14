import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { NextResponse } from "next/server";
import fs from "fs";

// Vercel serverless config — Puppeteer needs more time
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

// Try fetching with a headless browser (bypasses WAF/Cloudflare)
async function fetchWithBrowser(url) {
  const isDev = process.env.NODE_ENV === "development";
  let executablePath;
  let args;

  if (isDev) {
    executablePath = getLocalChromePath();
    if (!executablePath) throw new Error("No local Chrome found");
    args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ];
  } else {
    executablePath = await chromium.executablePath();
    args = chromium.args;
  }

  const browser = await puppeteer.launch({
    headless: isDev ? "new" : chromium.headless,
    executablePath,
    args,
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    const page = await browser.newPage();
    // Use domcontentloaded for speed — networkidle2 can take 10+ seconds
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    // Brief wait for any JS rendering, but keep it short
    await new Promise((r) => setTimeout(r, 300));

    const html = await page.content();
    await browser.close();
    return html;
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

// Quick fetch with a tight timeout — we just want to see if a simple GET works
async function quickFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000); // 4s max

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
  } catch (error) {
    clearTimeout(timeout);
    return { ok: false, status: 0, html: "" };
  }
}

// Inject Nexoos scripts into the HTML
function injectScripts(html, targetUrl) {
  // Inject URL override at the VERY START of the document
  const urlFix = `<script data-nexoos="url-fix">history.replaceState(null,'','${targetUrl.pathname}${targetUrl.search || ''}');` +
    `Object.defineProperty(document,'referrer',{get:function(){return '${targetUrl.origin}'}});</script>`;

  html = urlFix + html;

  // Insert <base> tag so all relative URLs resolve correctly
  const baseHref = `${targetUrl.origin}${targetUrl.pathname.replace(/\/[^/]*$/, "/")}`;
  if (/<head/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
  } else {
    html = `<base href="${baseHref}">` + html;
  }

  // Inject scroll-tracking script + link interception
  const injectedScript = `
<script data-nexoos="true">
(function() {
  // Send scroll position to parent
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
  
  // Send initial scroll after load
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

  // Intercept link clicks — prevent navigation inside the review iframe
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      // Optionally open in new tab
      var href = link.getAttribute('href');
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        window.parent.postMessage({ type: 'nexoos-link', href: link.href }, '*');
      }
    }
  }, true);

  // Listen for scroll-to commands from parent
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const targetUrl = new URL(url);

    // Step 1: Quick fetch with 4s timeout — works for most normal sites
    const result = await quickFetch(url);

    let html;

    if (result.ok && result.html && result.html.trim().length > 0) {
      // Simple fetch worked — fast path
      html = result.html;
    } else {
      // Step 2: Simple fetch failed (non-2xx, empty, or timed out)
      // Use Puppeteer headless browser to bypass WAF/Cloudflare/auth walls
      console.log(`[proxy] Quick fetch failed for ${url} (HTTP ${result.status}, body: ${result.html?.length || 0} bytes), using Puppeteer`);
      html = await fetchWithBrowser(url);
    }

    // Step 3: Inject our scripts and return
    html = injectScripts(html, targetUrl);

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
