import { NextResponse } from "next/server";
import { getCookiesForDomain } from "../../../lib/cookie-cache";

// Simple asset proxy — fetches CSS, images, fonts from target sites
// with proper headers to bypass hotlink protection and security challenges
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const targetUrl = new URL(url);
    
    // Build request headers
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": targetUrl.origin + "/",
      "Accept": "*/*",
    };
    
    // Include cached cookies from Puppeteer sessions to bypass SiteGround/Cloudflare
    const cachedCookies = getCookiesForDomain(targetUrl.hostname);
    if (cachedCookies) {
      headers["Cookie"] = cachedCookies;
    }

    let res = await fetch(url, { headers, redirect: "follow" });

    // If we got an HTML response (likely a security challenge), try following the redirect
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html") && !url.endsWith(".html") && !url.endsWith(".htm")) {
      // This is probably a security challenge redirect — try to extract the redirect URL
      const html = await res.text();
      const metaRefresh = html.match(/content="0;([^"]+)"/i);
      if (metaRefresh) {
        const redirectPath = metaRefresh[1];
        const redirectUrl = redirectPath.startsWith("http") 
          ? redirectPath 
          : `${targetUrl.origin}${redirectPath}`;
        
        console.log(`[asset] Challenge redirect detected, following to: ${redirectUrl}`);
        
        // Follow the challenge redirect
        const res2 = await fetch(redirectUrl, { headers, redirect: "follow" });
        
        // Check if we got back a proper response
        const ct2 = res2.headers.get("content-type") || "";
        if (!ct2.includes("text/html")) {
          // Got the actual asset
          const buffer = await res2.arrayBuffer();
          return new NextResponse(buffer, {
            headers: {
              "Content-Type": ct2,
              "Cache-Control": "public, max-age=86400",
              "Access-Control-Allow-Origin": "*",
              "Cross-Origin-Resource-Policy": "cross-origin",
            },
          });
        }
        
        // Still HTML — the challenge didn't resolve, return the original response
        console.log(`[asset] Challenge redirect still returned HTML for: ${url}`);
      }
      
      // Return 502 for unresolvable challenges rather than serving HTML as an image
      return new NextResponse(null, { status: 502 });
    }

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
