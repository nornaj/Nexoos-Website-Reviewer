import { NextResponse } from "next/server";

// Simple asset proxy — fetches CSS, images, fonts from target sites
// with proper headers to bypass hotlink protection
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const targetUrl = new URL(url);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": targetUrl.origin + "/",
        "Accept": "*/*",
      },
    });

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const isCSS = contentType.includes("text/css") || url.endsWith(".css");

    if (isCSS) {
      // For CSS files, rewrite relative url() references to absolute URLs
      // so fonts, images, and other assets still load correctly
      let css = await res.text();
      const cssDir = url.substring(0, url.lastIndexOf("/") + 1);

      // Fix root-relative URLs: url(/path/...) → url(https://origin/path/...)
      css = css.replace(
        /url\(\s*['"]?(?!data:|http|\/\/)(\/[^'")\s]+)['"]?\s*\)/gi,
        `url(${targetUrl.origin}$1)`
      );
      // Fix relative URLs: url(../path/...) → url(https://origin/full/path/...)
      css = css.replace(
        /url\(\s*['"]?(?!data:|http|\/\/|\/)([^'")\s]+)['"]?\s*\)/gi,
        (match, path) => `url(${cssDir}${path})`
      );

      return new NextResponse(css, {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
