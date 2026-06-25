import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, Browser } from "playwright";
import { logsRepo, artifactsRepo } from "../common/repo.js";
import type { Task, TaskContext } from "../common/types.js";

const SCRIPTS_DIR = process.env.SCRIPTS_DIR ?? path.resolve("scripts");
const REPORTS_DIR = process.env.REPORTS_DIR ?? path.resolve("reports");
const HEADLESS    = (process.env.WORKER_HEADLESS ?? "true").toLowerCase() !== "false";

export interface RunResult { passed: boolean; error: string | null; reportPath: string; }

export async function runTask(
  executionId: string, task: Task, params: Record<string, unknown>,
): Promise<RunResult> {
  // Reports are organized: reports/<script-folder>/<YYYY-MM-DD>/<executionId>/...
  // e.g. reports/search_wiki/2026-06-24/<id>/report.html
  const scriptDir = path.posix.dirname(task.script_path.replace(/\\/g, "/"));
  const folder = scriptDir && scriptDir !== "." ? scriptDir : "root";
  const date = new Date().toISOString().slice(0, 10);            // YYYY-MM-DD (UTC)
  const relDir = path.posix.join(folder, date, executionId);     // forward slashes for URLs
  const outputDir = path.join(REPORTS_DIR, folder, date, executionId);
  fs.mkdirSync(outputDir, { recursive: true });

  // Log writes are async (DB). Track them so the report can read a complete log.
  const pending: Promise<void>[] = [];
  const log = (level: string, message: string): void => {
    pending.push(logsRepo.append(executionId, level, message).catch(() => { /* best effort */ }));
  };

  const started = Date.now();
  let browser: Browser | null = null;
  let passed = false;
  let error: string | null = null;

  log("INFO", `Task: ${task.name}`);
  try {
    const taskUrl = pathToFileURL(path.join(SCRIPTS_DIR, task.script_path)).href;
    const mod = await import(taskUrl);          // tsx loads .ts task modules at runtime

    // Two supported contracts:
    //  (a) framework style: `export async function run(ctx: TaskContext)` -- we provide the page.
    //  (b) standalone style: `export default async function run(params)` -- script manages its own browser.
    const frameworkRun = typeof mod.run === "function" ? mod.run : null;
    const standaloneRun = !frameworkRun && typeof mod.default === "function" ? mod.default : null;
    if (!frameworkRun && !standaloneRun)
      throw new Error(`Task ${task.script_path} must export run() (named) or a default function`);

    if (frameworkRun) {
      browser = await chromium.launch({ headless: HEADLESS });
      const context = await browser.newContext();
      const page = await context.newPage();
      const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        log("KEYWORD", `  > ${name}`);
        try { return await fn(); }
        catch (e: any) { log("ERROR", `  x ${name} [FAIL] -- ${e?.message ?? e}`); throw e; }
      };
      await frameworkRun({ page, params, outputDir, log, step } as TaskContext);
    } else {
      // Standalone script: it launches its own browser. Mirror its console output into
      // the run log, and expose the report folder so it can save screenshots there
      // (anything it writes to this dir shows up under "View Report").
      process.env.EXECUTION_OUTPUT_DIR = outputDir;
      const origLog = console.log, origErr = console.error;
      console.log = (...a: unknown[]) => { log("INFO", a.map(String).join(" ")); origLog(...a); };
      console.error = (...a: unknown[]) => { log("ERROR", a.map(String).join(" ")); origErr(...a); };
      try {
        await standaloneRun!(params);
      } finally {
        console.log = origLog; console.error = origErr;
      }
    }
    passed = true;
    log("INFO", `Task finished: ${task.name} [PASS]`);
  } catch (e: any) {
    error = e?.message ?? String(e);
    log("ERROR", `Task failed: ${task.name} -- ${error}`);
  } finally {
    if (browser) await browser.close();
  }

  await Promise.all(pending);                   // flush logs before rendering the report
  await writeReport(outputDir, executionId, task, passed, error, Date.now() - started);

  // Record artifacts (report + screenshots) in the DB with their relative paths.
  const reportRel = path.posix.join(relDir, "report.html");
  try {
    const reportAbs = path.join(outputDir, "report.html");
    if (fs.existsSync(reportAbs)) {
      const bytes = fs.readFileSync(reportAbs);         // store report HTML bytes in the DB
      await artifactsRepo.add(executionId, "report", reportRel, "text/html", bytes.length, bytes);
    }
    for (const f of fs.readdirSync(outputDir).filter((f) => /\.(png|jpe?g)$/i.test(f))) {
      const bytes = fs.readFileSync(path.join(outputDir, f));   // store screenshot bytes in the DB
      await artifactsRepo.add(executionId, "screenshot", path.posix.join(relDir, f),
        f.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg", bytes.length, bytes);
    }
  } catch (e) {
    console.error(`[WORKER] failed to record artifacts for ${executionId}:`, e);
  }

  return { passed, error, reportPath: reportRel };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

async function writeReport(
  outputDir: string, executionId: string, task: Task,
  passed: boolean, error: string | null, ms: number,
): Promise<void> {
  const logs = await logsRepo.read(executionId);
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
<p>Execution <code>${executionId}</code> &middot; ${ms} ms${error ? ` &middot; <b>Error:</b> ${escapeHtml(error)}` : ""}</p>
${shots ? `<h2>Screenshots</h2>${shots}` : ""}
<h2>Log</h2><table>${rows}</table>`;
  fs.writeFileSync(path.join(outputDir, "report.html"), html);
}
