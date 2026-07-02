/**
 * Link Health Checker
 *
 * HOW TO USE:
 *   1. Tasks -> Add Task
 *   2. Name: e.g. "Link Health Checker"
 *   3. Script path: e.g. "link_checker/task.ts"
 *   4. Script source: Upload .ts file → pick THIS file
 *   5. Run with parameters:
 *        url      -> https://example.com   (required)
 *        maxLinks -> 15                     (optional, default: 15 — caps how many links get checked)
 *
 * What it does:
 *   - Opens the URL
 *   - Finds every <a href> link on the page
 *   - Visits each link (up to maxLinks) and checks its HTTP status
 *   - Reports which links are OK (2xx/3xx) and which are BROKEN (4xx/5xx/timeout)
 *   - Takes a screenshot of the original page
 *
 * Good for: quickly verifying nothing on a page is dead before a release.
 */

import { chromium, request } from "playwright";

type Params = {
  url?: string;
  maxLinks?: string | number;
};

export default async function run(params: Params) {
  if (!params.url) {
    throw new Error("❌ Please provide 'url' in input parameters.");
  }

  const url      = params.url.trim();
  const maxLinks = Number(params.maxLinks ?? 15);
  const outDir   = process.env.EXECUTION_OUTPUT_DIR || ".";

  console.log(`🌐 Opening: ${url}`);
  console.log(`🔗 Will check up to ${maxLinks} links`);

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status   = response?.status() ?? 0;
    if (status >= 400) {
      throw new Error(`❌ Page itself returned HTTP ${status}. Check the URL.`);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    console.log(`📄 Page title: ${await page.title()}`);

    // Collect all unique, absolute http(s) links on the page
    const rawLinks: string[] = await page.$$eval("a[href]", (anchors) =>
      anchors.map((a) => (a as HTMLAnchorElement).href)
    );

    const uniqueLinks = Array.from(new Set(rawLinks)).filter(
      (href) => href.startsWith("http://") || href.startsWith("https://")
    );

    console.log(`🔍 Found ${uniqueLinks.length} unique links on the page`);

    const linksToCheck = uniqueLinks.slice(0, maxLinks);
    if (uniqueLinks.length > maxLinks) {
      console.log(`   (checking first ${maxLinks} only — increase 'maxLinks' to check more)`);
    }

    const requestContext = await request.newContext();
    const results: { link: string; status: number | string; ok: boolean }[] = [];

    for (const link of linksToCheck) {
      try {
        const res = await requestContext.get(link, { timeout: 10000 });
        const code = res.status();
        results.push({ link, status: code, ok: code < 400 });
      } catch (err: any) {
        results.push({ link, status: "TIMEOUT/ERROR", ok: false });
      }
    }

    await requestContext.dispose();

    const okLinks = results.filter((r) => r.ok);
    const brokenLinks = results.filter((r) => !r.ok);

    console.log("\n──────── Results ────────");
    console.log(`✅ Working links : ${okLinks.length}`);
    console.log(`❌ Broken links  : ${brokenLinks.length}`);

    console.log("\n--- All Links Checked ---");
    results.forEach((r, i) => {
      const icon = r.ok ? "✅" : "❌";
      console.log(`  ${i + 1}. ${icon} [${r.status}] ${r.link}`);
    });

    if (brokenLinks.length === 0) {
      console.log("\n✅ PASS: All checked links are healthy.");
    } else {
      console.log(`\n❌ FAIL: ${brokenLinks.length} broken link(s) found.`);
    }

    // Screenshot of the original page
    const file = `${outDir}/screenshot.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(`\n📸 Screenshot saved: ${file}`);

  } finally {
    await browser.close();
  }
}
