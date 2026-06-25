/**
 * Sample uploadable task script for the Automation Framework.
 *
 * HOW TO USE:
 *   1. Tasks -> Add Task
 *   2. Name: e.g. "Screenshot URL"
 *   3. Script path: e.g. "screenshot_url/task.ts"   (folder/file -- created on save)
 *   4. Script source: choose "Upload .ts file" and pick THIS file
 *   5. Add Task, then Run it and enter parameter:  url -> https://example.com
 *
 * Contract: the framework runs a default-exported async function and passes the
 * run parameters. It manages nothing for you here -- this script opens its own
 * browser. Save screenshots to process.env.EXECUTION_OUTPUT_DIR so they appear
 * under "View Report" and are stored in the database.
 */
import { chromium } from "playwright";

type Params = {
  url?: string;   // key: "url" -- the page to open and screenshot
};

export default async function run(params: Params) {
  const url = (params.url || "https://example.com").trim();
  const outDir = process.env.EXECUTION_OUTPUT_DIR || ".";

  console.log("🌐 Opening:", url);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Let the page settle and paint so the screenshot isn't blank.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const title = await page.title();
    console.log("📄 Page title:", title);

    const file = `${outDir}/screenshot.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log("📸 Screenshot saved:", file);
  } finally {
    await browser.close();
  }
}