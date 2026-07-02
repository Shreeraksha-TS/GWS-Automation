import { chromium } from "playwright";

type Params = {
  url?: string;    // key: "url"  -- the page to open and screenshot (required)
  term?: string;   // key: "term" -- optional search term (best-effort)
};

export default async function run(params: Params) {
  const url = (params.url || "").trim();
  if (!url) throw new Error("url is required -- provide it as a key-value parameter on Run.");

  // Save into the execution's report folder so it shows under "View Report".
  const outDir = process.env.EXECUTION_OUTPUT_DIR || ".";

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  try {
    console.log("🌐 Opening:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Let the page settle and paint before screenshotting (avoids blank captures).
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Optional: if a term is given, try to search on the page (best-effort; e.g. Amazon).
    const term = (params.term || "").trim();
    if (term) {
      try {
        await page.fill("#twotabsearchtextbox", term);
        await page.keyboard.press("Enter");
        await page.waitForSelector(".s-main-slot", { timeout: 15000 });
        console.log("🔍 Searched for:", term);
      } catch {
        console.log("ℹ️ Search skipped -- no matching search box on this page.");
      }
    }

    // Viewport (overview) screenshot of the provided URL -- not the full long page.
    const file = `${outDir}/screenshot.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log("📸 Screenshot saved:", file);
  } finally {
    await browser.close();
  }
}