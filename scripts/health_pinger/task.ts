/**
 * Multi-URL Health Pinger
 *
 * HOW TO USE:
 *   1. Tasks -> Add Task
 *   2. Name: e.g. "Health Pinger"
 *   3. Script path: e.g. "health_pinger/task.ts"
 *   4. Script source: Upload .ts file → pick THIS file
 *   5. Run with parameters:
 *        urls -> https://example.com,https://github.com,https://google.com
 *               (comma-separated list, required)
 *
 * What it does:
 *   - Sends a direct HTTPS request to EACH url using Node's native https module
 *     (bypasses Playwright's request layer, which can hit local cert-trust issues
 *     on machines with corporate proxies/antivirus doing SSL inspection)
 *   - Measures response time for each
 *   - Reports status code, response time, and UP/DOWN verdict per URL
 *   - Takes a single summary screenshot (a simple generated results page)
 *   - Throws an error if any endpoint is down, so the run is correctly marked FAILED
 */

import { chromium } from "playwright";
import https from "https";
import http from "http";
import { URL } from "url";

type Params = {
  urls?: string;
};

type PingResult = {
  url: string;
  status: number | string;
  timeMs: number;
  up: boolean;
};

function pingUrl(targetUrl: string, timeoutMs = 10000): Promise<{ status: number; timeMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      reject(new Error("Invalid URL"));
      return;
    }

    const client = parsed.protocol === "http:" ? http : https;
    const req = client.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        // Skip certificate validation — avoids "unable to get local issuer
        // certificate" errors caused by corporate proxies/AV doing SSL inspection.
        rejectUnauthorized: false,
        headers: { "User-Agent": "Mozilla/5.0 (HealthPinger/1.0)" },
      },
      (res) => {
        const elapsed = Date.now() - start;
        resolve({ status: res.statusCode || 0, timeMs: elapsed });
        res.resume(); // drain response, we don't need the body
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

export default async function run(params: Params) {
  if (!params.urls) {
    throw new Error("❌ Please provide 'urls' (comma-separated) in input parameters.");
  }

  const urlList = params.urls
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  if (urlList.length === 0) {
    throw new Error("❌ No valid URLs found in 'urls' parameter.");
  }

  console.log(`🔢 Pinging ${urlList.length} URL(s)...\n`);

  const results: PingResult[] = [];

  for (const url of urlList) {
    try {
      const { status, timeMs } = await pingUrl(url);
      results.push({ url, status, timeMs, up: status < 400 });
      console.log(`${status < 400 ? "✅" : "❌"} ${url} — HTTP ${status} (${timeMs}ms)`);
    } catch (err: any) {
      const msg = err?.message || "request failed";
      results.push({ url, status: "ERROR", timeMs: 0, up: false });
      console.log(`❌ ${url} — ${msg}`);
    }
  }

  const upCount = results.filter((r) => r.up).length;
  const downCount = results.length - upCount;
  const validTimes = results.filter((r) => r.timeMs > 0).map((r) => r.timeMs);
  const avgTime = validTimes.length
    ? Math.round(validTimes.reduce((a, b) => a + b, 0) / validTimes.length)
    : 0;

  console.log("\n──────── Summary ────────");
  console.log(`✅ Up      : ${upCount}/${results.length}`);
  console.log(`❌ Down    : ${downCount}/${results.length}`);
  console.log(`⏱️  Avg time: ${avgTime}ms`);

  if (downCount === 0) {
    console.log("\n✅ PASS: All endpoints are up.");
  } else {
    console.log(`\n❌ FAIL: ${downCount} endpoint(s) are down.`);
  }

  // Generate a simple visual summary screenshot using a real browser page
  const outDir = process.env.EXECUTION_OUTPUT_DIR || ".";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 800, height: Math.max(400, 80 + results.length * 50) },
  });

  const rowsHtml = results
    .map(
      (r) => `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px 14px;font-family:monospace;font-size:13px;">${r.url}</td>
        <td style="padding:10px 14px;text-align:center;">${r.status}</td>
        <td style="padding:10px 14px;text-align:center;">${r.timeMs}ms</td>
        <td style="padding:10px 14px;text-align:center;font-size:18px;">${r.up ? "✅" : "❌"}</td>
      </tr>`
    )
    .join("");

  const html = `
    <html>
      <body style="font-family:Arial,sans-serif;margin:0;padding:24px;">
        <h2 style="margin:0 0 16px;">Health Pinger Results</h2>
        <p style="color:#555;margin:0 0 16px;">Up: ${upCount}/${results.length} · Avg: ${avgTime}ms</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #eee;">
          <thead>
            <tr style="background:#f5f5f5;text-align:left;">
              <th style="padding:10px 14px;">URL</th>
              <th style="padding:10px 14px;">Status</th>
              <th style="padding:10px 14px;">Time</th>
              <th style="padding:10px 14px;">Up?</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>`;

  await page.setContent(html);
  const file = `${outDir}/screenshot.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`\n📸 Summary screenshot saved: ${file}`);

  await browser.close();

  // Throw if any endpoint is down so the run is correctly marked FAILED
  if (downCount > 0) {
    throw new Error(`${downCount}/${results.length} endpoint(s) are down: ${results.filter(r => !r.up).map(r => r.url).join(", ")}`);
  }
}
