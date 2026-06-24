/**
 * Playwright Worker (POC, file-based) — runs NATIVELY on Windows.
 * Claims jobs from the directory queue and runs Playwright task modules.
 * Multiple worker processes are safe: jobs are claimed via atomic fs.renameSync().
 */
import * as os from "node:os";
import * as store from "../common/store.js";
import { claimNext, markDone, markFailed } from "../common/jobqueue.js";
import { runTask } from "./runner.js";
import type { Execution, Task } from "../common/types.js";

const POLL_MS   = Number(process.env.WORKER_POLL_INTERVAL ?? 3) * 1000;
const HEADLESS  = (process.env.WORKER_HEADLESS ?? "true").toLowerCase() !== "false";
const WORKER_ID = `${os.hostname()}-${process.pid}`;

function update(executionId: string, changes: Partial<Execution>): void {
  const ex = store.getEntity<Execution>(store.EXEC_DIR, executionId);
  if (!ex) return;
  Object.assign(ex, changes);
  store.saveEntity(store.EXEC_DIR, executionId, ex);
}

async function processJob(job: { execution_id: string; _file: string }): Promise<void> {
  const executionId = job.execution_id;
  const jobFile = job._file;
  console.log(`[WORKER] claimed execution ${executionId}`);

  const ex = store.getEntity<Execution>(store.EXEC_DIR, executionId);
  if (!ex) { markFailed(jobFile); return; }

  const task = store.getEntity<Task>(store.TASKS_DIR, ex.task_id);
  if (!task) {
    update(executionId, { status: "FAILED", error_message: "Task not found", finished_at: store.utcnowIso() });
    markFailed(jobFile);
    return;
  }

  update(executionId, { status: "RUNNING", started_at: store.utcnowIso() });
  try {
    const { passed, error, reportPath } = await runTask(executionId, task, ex.robot_params ?? {});
    update(executionId, {
      status: passed ? "PASSED" : "FAILED",
      finished_at: store.utcnowIso(),
      report_path: reportPath,
      error_message: error,
    });
    markDone(jobFile);
    console.log(`[WORKER] execution ${executionId} -> ${passed ? "PASSED" : "FAILED"}`);
  } catch (e: any) {
    update(executionId, { status: "FAILED", finished_at: store.utcnowIso(), error_message: e?.message ?? String(e) });
    markFailed(jobFile);
    console.error(`[WORKER] execution ${executionId} error:`, e);
  }
}

async function main(): Promise<void> {
  console.log(`[WORKER] started ${WORKER_ID} (headless=${HEADLESS})`);
  console.log(`[WORKER] DATA_DIR=${store.DATA_DIR}`);
  store.initStorage();
  // Chromium is installed ONCE by setup-worker.ps1 via `npx playwright install chromium`.
  for (;;) {
    const job = claimNext(WORKER_ID);
    if (job) await processJob(job);
    else await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
