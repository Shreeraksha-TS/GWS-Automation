import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, Browser } from "playwright";
import * as store from "../common/store.js";
import type { Task, TaskContext } from "../common/types.js";

const SCRIPTS_DIR = process.env.SCRIPTS_DIR ?? path.resolve("scripts");
const REPORTS_DIR = process.env.REPORTS_DIR ?? path.resolve("reports");
const HEADLESS    = (process.env.WORKER_HEADLESS ?? "true").toLowerCase() !== "false";

export interface RunResult { passed: boolean; error: string | null; reportPath: string; }

export async function runTask(
  executionId: string, task: Task, params: Record<string, unknown>,
): Promise<RunResult> {
  const outputDir = path.join(REPORTS_DIR, executionId);
  fs.mkdirSync(outputDir, { recursive: true });
  const log = (level: string, message: string) => store.appendLog(executionId, level, message);
  const started = Date.now();
  let browser: Browser | null = null;
  let passed = false;
  let error: string | null = null;

  log("INFO", `▶ Task: ${task.name}`);
  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext();
    const page = await context.newPage();

    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      log("KEYWORD", `  ▷ ${name}`);
      try { return await fn(); }
      catch (e: any) { log("ERROR", `  ✗ ${name} [FAIL] — ${e?.message ?? e}`); throw e; }
    };

    const taskUrl = pathToFileURL(path.join(SCRIPTS_DIR, task.script_path)).href;
    const mod = await import(taskUrl);          // tsx loads .ts task modules at runtime
    if (typeof mod.run !== "function")
      throw new Error(`Task ${task.script_path} has no exported run()`);

    await mod.run({ page, params, outputDir, log, step } as TaskContext);
    passed = true;
    log("INFO", `✅ Task finished: ${task.name} [PASS]`);
  } catch (e: any) {
    error = e?.message ?? String(e);
    log("ERROR", `❌ Task failed: ${task.name} — ${error}`);
  } finally {
    if (browser) await browser.close();
  }

  writeReport(outputDir, executionId, task, passed, error, Date.now() - started);
  return { passed, error, reportPath: path.join(executionId, "report.html") };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

function writeReport(
  outputDir: string, executionId: string, task: Task,
  passed: boolean, error: string | null, ms: number,
): void {
  const logs = store.readLogs(executionId);
  const rows = logs.map(l =>
    `<tr><td>${l.timestamp}</td><td>${l.level}</td><td>${escapeHtml(String(l.message))}</td></tr>`).join("");
  const shots = fs.readdirSync(outputDir)
    .filter(f => /\.(png|jpe?g)$/i.test(f))
    .map(f => `<figure><img src="./${f}"><figcaption>${f}</figcaption></figure>`).join("");
  const color = passed ? "#16a34a" : "#dc2626";
  const html = `<!doctype html><meta charset="utf-8"><title>Report ${executionId}</title>
<style>
 body{font-family:system-ui,sans-serif;margin:2rem;color:#111}
 .badge{padding:.2rem .6rem;border-radius:.4rem;color:#fff;background:${color};font-size:.9rem}
 table{border-collapse:collapse;width:100%;margin-top:.5rem}
 td{border-bottom:1px solid #eee;padding:.3rem .5rem;font-family:ui-monospace,monospace;font-size:.85rem;vertical-align:top}
 img{max-width:480px;border:1px solid #ddd;border-radius:4px}
 figure{display:inline-block;margin:.5rem}
</style>
<h1>${escapeHtml(task.name)} <span class="badge">${passed ? "PASS" : "FAIL"}</span></h1>
<p>Execution <code>${executionId}</code> · ${ms} ms${error ? ` · <b>Error:</b> ${escapeHtml(error)}` : ""}</p>
${shots ? `<h2>Screenshots</h2>${shots}` : ""}
<h2>Log</h2><table>${rows}</table>`;
  fs.writeFileSync(path.join(outputDir, "report.html"), html);
}
