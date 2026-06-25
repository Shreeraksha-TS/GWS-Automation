/**
 * Page Load Time Checker + Screenshot
 *
 * HOW TO USE:
 *   1. Tasks -> Add Task
 *   2. Name: e.g. "Page Load Check"
 *   3. Script path: e.g. "page_load_check/task.ts"
 *   4. Script source: Upload .ts file → pick THIS file
 *   5. Run with parameters:
 *        url       -> https://example.com   (required)
 *        threshold -> 3000                  (optional: warn if load > Nms, default 3000)
 *
 * What it does:
 *   - Opens the URL and measures how long it takes to fully load
 *   - Logs DNS, connection, TTFB, DOM, and full load timings
 *   - Warns if load time exceeds the threshold (ms)
 *   - Takes a screenshot and saves it to the report
 */

import { chromium } from "playwright";

type Params = {
  url?: string;
  threshold?: string | number;
};

export default async function run(params: Params) {
  if (!params.url) {
    throw new Error("❌ Please provide 'url' in input parameters.");
  }

  const url       = params.url.trim();
  const threshold = Number(params.threshold ?? 3000);
  const outDir    = process.env.EXECUTION_OUTPUT_DIR || ".";

  console.log(`🌐 Opening: ${url}`);
  console.log(`⏱️  Slow threshold: ${threshold}ms`);

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    const startTime = Date.now();

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const domContentLoaded = Date.now() - startTime;

    const status = response?.status() ?? 0;
    if (status >= 400) {
      throw new Error(`❌ Page returned HTTP ${status}. Check the URL.`);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const fullLoadTime = Date.now() - startTime;

    const title = await page.title();
    console.log(`📄 Page title: ${title}`);
    console.log(`📊 HTTP status: ${status}`);

    // Navigation timing from browser
    const timing = await page.evaluate(() => {
      const t = performance.timing;
      return {
        dns:   t.domainLookupEnd  - t.domainLookupStart,
        tcp:   t.connectEnd       - t.connectStart,
        ttfb:  t.responseStart    - t.requestStart,
        dom:   t.domContentLoadedEventEnd - t.navigationStart,
        load:  t.loadEventEnd     - t.navigationStart,
      };
    }).catch(() => null);

    console.log("\n📈 Load timings:");
    if (timing) {
      console.log(`   DNS lookup    : ${timing.dns}ms`);
      console.log(`   TCP connect   : ${timing.tcp}ms`);
      console.log(`   TTFB          : ${timing.ttfb}ms`);
      console.log(`   DOM ready     : ${timing.dom}ms`);
      console.log(`   Full load     : ${timing.load > 0 ? timing.load : fullLoadTime}ms`);
    } else {
      console.log(`   DOM content loaded : ${domContentLoaded}ms`);
      console.log(`   Full load time     : ${fullLoadTime}ms`);
    }

    const reportedLoad = timing?.load > 0 ? timing.load : fullLoadTime;

    if (reportedLoad > threshold) {
      console.log(`\n⚠️  SLOW: Page took ${reportedLoad}ms — exceeds threshold of ${threshold}ms`);
    } else {
      console.log(`\n✅ FAST: Page loaded in ${reportedLoad}ms — within threshold of ${threshold}ms`);
    }

    // Screenshot
    const file = `${outDir}/screenshot.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(`\n📸 Screenshot saved: ${file}`);

  } finally {
    await browser.close();
  }
}
