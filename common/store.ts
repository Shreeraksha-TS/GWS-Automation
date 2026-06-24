/**
 * File-based storage for the POC. Replaces PostgreSQL.
 * One JSON file per entity, so concurrent writers rarely touch the same file.
 * All writes are atomic (temp file + fs.renameSync). Stdlib-only, cross-platform.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export const DATA_DIR      = process.env.DATA_DIR ?? "/app/data";
export const TASKS_DIR     = path.join(DATA_DIR, "tasks");
export const EXEC_DIR      = path.join(DATA_DIR, "executions");
export const SCHED_DIR     = path.join(DATA_DIR, "schedules");
export const LOGS_DIR      = path.join(DATA_DIR, "logs");
export const QUEUE_DIR     = path.join(DATA_DIR, "queue");
export const QUEUE_PENDING = path.join(QUEUE_DIR, "pending");
export const QUEUE_RUNNING = path.join(QUEUE_DIR, "running");
export const QUEUE_DONE    = path.join(QUEUE_DIR, "done");

const ALL_DIRS = [TASKS_DIR, EXEC_DIR, SCHED_DIR, LOGS_DIR,
                  QUEUE_PENDING, QUEUE_RUNNING, QUEUE_DONE];

export const utcnowIso = (): string => new Date().toISOString();

export function initStorage(): void {
  for (const d of ALL_DIRS) fs.mkdirSync(d, { recursive: true });
}

// Synchronous sleep (used only for the brief Windows retry below).
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function _atomicWrite(file: string, data: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {                 // Windows-safe retry on transient locks
    try { fs.renameSync(tmp, file); return; }   // atomic on POSIX + Windows
    catch (e: any) {
      if (["EPERM", "EBUSY", "EACCES"].includes(e?.code)) { lastErr = e; sleep(50); continue; }
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw e;
    }
  }
  try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  throw lastErr;
}

function _readJson(file: string): any | null {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }   // mid-replace, or briefly locked by AV/indexer on Windows
}

// ── Generic entity helpers ───────────────────────────────────────────
export function saveEntity(dir: string, id: string, data: unknown): void {
  _atomicWrite(path.join(dir, `${id}.json`), data);
}
export function getEntity<T = any>(dir: string, id: string): T | null {
  return _readJson(path.join(dir, `${id}.json`));
}
export function listEntities<T = any>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => _readJson(path.join(dir, f)))
    .filter((x): x is T => x != null);
}
export function deleteEntity(dir: string, id: string): boolean {
  const f = path.join(dir, `${id}.json`);
  if (fs.existsSync(f)) { fs.rmSync(f, { force: true }); return true; }
  return false;
}

// ── Logs (append-only JSONL) ─────────────────────────────────────────
export function appendLog(executionId: string, level: string, message: string): void {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const entry = { timestamp: utcnowIso(), level, message };
  fs.appendFileSync(path.join(LOGS_DIR, `${executionId}.jsonl`), JSON.stringify(entry) + "\n");
}
export function readLogs(executionId: string, afterLine = 0): any[] {
  const file = path.join(LOGS_DIR, `${executionId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  const out: any[] = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i >= afterLine && lines[i].trim()) { const rec = JSON.parse(lines[i]); rec.id = i; out.push(rec); }
  }
  return out;
}
