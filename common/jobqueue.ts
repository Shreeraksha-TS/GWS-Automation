/**
 * Directory-based job queue. A job is a file in queue/pending/. A worker claims it by
 * atomically renaming it into queue/running/. Only one worker can move a given file;
 * the loser gets ENOENT (source gone) and moves on. No locking required.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { QUEUE_PENDING, QUEUE_RUNNING, QUEUE_DONE, utcnowIso } from "./store.js";

export function enqueue(executionId: string): void {
  fs.mkdirSync(QUEUE_PENDING, { recursive: true });
  // Zero-padded monotonic key → lexicographic sort == chronological order.
  const ts = process.hrtime.bigint().toString().padStart(22, "0");
  const fname = `${ts}_${executionId}.json`;
  const file = path.join(QUEUE_PENDING, fname);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ execution_id: executionId, enqueued_at: utcnowIso() }));
  fs.renameSync(tmp, file);   // appears atomically in pending/
}

export interface ClaimedJob {
  execution_id: string;
  enqueued_at: string;
  _file: string;
  _worker: string;
}

export function claimNext(workerId: string): ClaimedJob | null {
  const pending = fs.existsSync(QUEUE_PENDING)
    ? fs.readdirSync(QUEUE_PENDING).filter(f => f.endsWith(".json")).sort()
    : [];
  for (const fname of pending) {
    const src = path.join(QUEUE_PENDING, fname);
    const dst = path.join(QUEUE_RUNNING, fname);
    try { fs.renameSync(src, dst); }            // atomic claim
    catch { continue; }                          // another worker grabbed it — try next
    const job = JSON.parse(fs.readFileSync(dst, "utf8"));
    return { ...job, _file: fname, _worker: workerId };
  }
  return null;
}

export function markDone(jobFile: string): void {
  const src = path.join(QUEUE_RUNNING, jobFile);
  const dst = path.join(QUEUE_DONE, jobFile);
  if (fs.existsSync(src)) fs.renameSync(src, dst);
}

export function markFailed(jobFile: string): void {
  // For the POC, failed jobs also go to done/ (a finished, non-retryable state).
  markDone(jobFile);
}
