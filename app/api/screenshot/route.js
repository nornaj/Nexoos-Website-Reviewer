import puppeteer from "puppeteer-core";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "screenshots");

function getCachePath(url, fullPage) {
  const key = fullPage ? `${url}__fullpage` : url;
  const hash = crypto.createHash("md5").update(key).digest("hex");
  return path.join(CACHE_DIR, `${hash}.png`);
}

// Find a locally installed Chrome for development
function getLocalChromePath() {
  const paths = [
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    // Mac
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Linux
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const fullPage = searchParams.get("fullPage") === "true";

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Ensure cache directory exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const cachePath = getCachePath(url, fullPage);

  // Return cached screenshot if exists and less than 24h old
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age < 24 * 60 * 60 * 1000) {
      const buffer = fs.readFileSync(cachePath);
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }

  let browser;
  try {
    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      // Development: use locally installed Chrome
      const executablePath = getLocalChromePath();
      if (!executablePath) {
        return NextResponse.json(
          { error: "No local Chrome found. Install Google Chrome for thumbnails." },
          { status: 500 }
        );
      }
      browser = await puppeteer.launch({
        headless: "shell",
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        defaultViewport: { width: 1280, height: 800 },
      });
    } else {
      // Production (Vercel): use Browserless.io cloud browser
      const token = process.env.BROWSERLESS_TOKEN;
      if (!token) {
        return NextResponse.json(
          { error: "BROWSERLESS_TOKEN is not set" },
          { status: 500 }
        );
      }
      browser = await puppeteer.connect({
        browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}`,
      });
    }

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    // Small delay for animations/lazy images
    await new Promise((r) => setTimeout(r, 800));

    let screenshot;
    if (fullPage) {
      // Capture the full scrollable page
      screenshot = await page.screenshot({ type: "png", fullPage: true });
    } else {
      screenshot = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: 1280, height: 800 },
      });
    }

    await browser.close().catch(() => {});

    // Cache the screenshot
    fs.writeFileSync(cachePath, screenshot);

    return new NextResponse(screenshot, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return NextResponse.json(
      { error: "Failed to capture screenshot", details: error.message },
      { status: 500 }
    );
  }
}
