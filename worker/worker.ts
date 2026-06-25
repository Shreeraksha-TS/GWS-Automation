/**
 * Playwright Worker -- runs NATIVELY on Windows.
 * Claims QUEUED executions from SQL Server (atomic UPDATE with READPAST) and runs
 * the Playwright task module. Multiple worker processes are safe: the claim is atomic.
 */
import * as os from "node:os";
import { tasksRepo, executionsRepo, logsRepo } from "../common/repo.js";
import { runTask } from "./runner.js";
import type { Execution } from "../common/types.js";

const POLL_MS   = Number(process.env.WORKER_POLL_INTERVAL ?? 3) * 1000;
const HEADLESS  = (process.env.WORKER_HEADLESS ?? "true").toLowerCase() !== "false";
const WORKER_ID = `${os.hostname()}-${process.pid}`;

async function processExecution(ex: Execution): Promise<void> {
  console.log(`[WORKER] claimed execution ${ex.id}`);

  const task = await tasksRepo.get(ex.task_id);
  if (!task) {
    await logsRepo.append(ex.id, "ERROR", "Task not found");
    await executionsRepo.finish(ex.id, { status: "FAILED", error_message: "Task not found" });
    return;
  }

  // Run parameters come from the normalized execution_parameters table.
  const params = await executionsRepo.getParams(ex.id);
  try {
    const { passed, error, reportPath } = await runTask(ex.id, task, params);
    await executionsRepo.finish(ex.id, {
      status: passed ? "PASSED" : "FAILED",
      report_path: reportPath,
      error_message: error,
    });
    console.log(`[WORKER] execution ${ex.id} -> ${passed ? "PASSED" : "FAILED"}`);
  } catch (e: any) {
    await executionsRepo.finish(ex.id, { status: "FAILED", error_message: e?.message ?? String(e) });
    console.error(`[WORKER] execution ${ex.id} error:`, e);
  }
}

async function main(): Promise<void> {
  console.log(`[WORKER] started ${WORKER_ID} (headless=${HEADLESS})`);
  // Chromium is installed ONCE by setup-worker.ps1 via `npx playwright install chromium`.
  for (;;) {
    const ex = await executionsRepo.claimNext();
    if (ex) await processExecution(ex);
    else await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
