import puppeteer from "puppeteer";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "screenshots");

function getCachePath(url) {
  const hash = crypto.createHash("md5").update(url).digest("hex");
  return path.join(CACHE_DIR, `${hash}.png`);
}

async function closeBrowser(browser) {
  try {
    if (browser) {
      const pages = await browser.pages();
      for (const page of pages) {
        await page.close().catch(() => {});
      }
      await browser.close();
    }
  } catch {
    // Ignore EBUSY errors on Windows during cleanup
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Ensure cache directory exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const cachePath = getCachePath(url);

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
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    // Small delay for animations/lazy images
    await new Promise((r) => setTimeout(r, 800));

    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });

    await closeBrowser(browser);

    // Cache the screenshot
    fs.writeFileSync(cachePath, screenshot);

    return new NextResponse(screenshot, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    await closeBrowser(browser);
    return NextResponse.json(
      { error: "Failed to capture screenshot", details: error.message },
      { status: 500 }
    );
  }
}
