import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const targetUrl = new URL(url);

    // Fetch the website
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch: ${res.status}` },
        { status: 502 }
      );
    }

    let html = await res.text();

    // Inject URL override FIRST — before any app scripts run
    // This makes the SPA router see the original URL, not /api/proxy
    const urlOverride = `<script data-nexoos="url-fix">history.replaceState(null, '', '${targetUrl.pathname}${targetUrl.search}');</script>`;

    // Insert <base> tag so all relative URLs resolve correctly
    const baseHref = `${targetUrl.origin}${targetUrl.pathname.replace(/\/[^/]*$/, "/")}`; 
    if (/<head/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${urlOverride}<base href="${baseHref}">`);
    } else {
      html = urlOverride + `<base href="${baseHref}">` + html;
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

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300", // Cache 5 min
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to proxy website", details: error.message },
      { status: 500 }
    );
  }
}
