/**
 * Multi-Step Flow Automation Task
 *
 * HOW TO USE:
 *   1. Tasks -> Add Task
 *   2. Name: e.g. "Multi-Step Flow"
 *   3. Script path: e.g. "multi_step_flow/task.ts"
 *   4. Script source: choose "Upload .ts file" and pick THIS file
 *   5. Add Task, then Run it with parameters:
 *        url       -> https://example.com      (starting page)
 *        steps     -> 3                         (number of Next/Continue clicks, default: 3)
 *        selector  -> button[type="submit"]     (optional: custom button selector)
 *
 * Behaviour:
 *   - Navigates to the given URL
 *   - On each step, tries a prioritised list of "next/continue" button selectors
 *   - Takes a screenshot after every step (step-1.png, step-2.png …)
 *   - Saves a final screenshot as screenshot.png (picked up by "View Report")
 *   - Logs step titles and any selector fallbacks to the console
 */

import { chromium, Page } from "playwright";

type Params = {
  url?: string;       // Starting URL
  steps?: number;     // How many Next/Continue clicks to perform (default: 3)
  selector?: string;  // Override the button selector for every step
};

// Ordered list of selectors tried when no custom selector is given.
const DEFAULT_SELECTORS = [
  "button[type='submit']",
  "input[type='submit']",
  "button:has-text('Next')",
  "button:has-text('Continue')",
  "button:has-text('Proceed')",
  "a:has-text('Next')",
  "a:has-text('Continue')",
  "[role='button']:has-text('Next')",
  "[role='button']:has-text('Continue')",
];

async function clickNextButton(page: Page, customSelector?: string): Promise<string> {
  const selectors = customSelector ? [customSelector] : DEFAULT_SELECTORS;

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click();
        return sel; // return the selector that worked
      }
    } catch {
      // not found — try the next selector
    }
  }

  throw new Error(
    `❌ No clickable Next/Continue button found.\n   Tried: ${selectors.join(", ")}`
  );
}

async function waitForSettle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

export default async function run(params: Params) {
  const url      = (params.url || "https://example.com").trim();
  const totalSteps = Number(params.steps ?? 3);
  const customSel  = params.selector?.trim() || undefined;
  const outDir     = process.env.EXECUTION_OUTPUT_DIR || ".";

  if (!params.url) {
    throw new Error("❌ Please provide 'url' in input parameters.");
  }
  if (isNaN(totalSteps) || totalSteps < 1) {
    throw new Error("❌ 'steps' must be a positive number.");
  }

  console.log(`🌐 Opening: ${url}`);
  console.log(`🔢 Steps to click through: ${totalSteps}`);
  if (customSel) console.log(`🎯 Using custom selector: ${customSel}`);

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSettle(page);

    console.log(`📄 Initial page title: ${await page.title()}`);

    // ── Step loop ──────────────────────────────────────────────────────────────
    for (let step = 1; step <= totalSteps; step++) {
      console.log(`\n➡️  Step ${step} / ${totalSteps}`);

      const usedSelector = await clickNextButton(page, customSel);
      console.log(`   ✅ Clicked via: ${usedSelector}`);

      await waitForSettle(page);
      console.log(`   📄 Page title: ${await page.title()}`);

      // Per-step screenshot
      const stepFile = `${outDir}/step-${step}.png`;
      await page.screenshot({ path: stepFile, fullPage: false });
      console.log(`   📸 Screenshot: ${stepFile}`);
    }

    // ── Final screenshot (shown in "View Report") ──────────────────────────────
    const finalFile = `${outDir}/screenshot.png`;
    await page.screenshot({ path: finalFile, fullPage: false });
    console.log(`\n🏁 Final screenshot saved: ${finalFile}`);
    console.log("✅ Multi-step flow completed successfully.");

  } finally {
    await browser.close();
  }
}
