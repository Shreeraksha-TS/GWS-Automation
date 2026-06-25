import { chromium } from "playwright";

type Params = {
  url?: string;
  term?: string;
};

export default async function run(params: Params) {

  if (!params.url) {
    throw new Error("❌ Please provide 'url' in input");
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log("🌐 Opening:", params.url);

    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Let the page settle and paint before screenshotting (avoids blank captures).
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // ✅ If term exists → search
    if (params.term) {
      console.log("🔍 Searching:", params.term);

      try {
        await page.fill("input[type='text']", params.term);
        await page.keyboard.press("Enter");
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);
      } catch {
        console.log("No search field found");
      }
    }

    // ✅ Screenshot
    const file = `${process.env.EXECUTION_OUTPUT_DIR}/screenshot.png`;

    await page.screenshot({
      path: file,
      fullPage: false
    });

    console.log("📸 Saved:", file);

  } finally {
    await browser.close();
  }
}
