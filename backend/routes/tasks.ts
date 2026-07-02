import { Router, type Request, type Response, type NextFunction } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { tasksRepo } from "../../common/repo.js";
import { config } from "../config.js";
import { TaskCreate, TaskUpdate } from "../schemas.js";
import { extractScriptParams, toTaskParams } from "../../common/scriptParams.js";
import type { Task, TaskParam } from "../../common/types.js";

export const tasks = Router();

// Express 4 doesn't catch async errors; forward them to the error handler.
const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

// Generate a runnable starter task.ts wired to the fields declared in the Add Task form.
// (Single-quoted lines keep their backticks/${} literal -- they belong in the generated file.)
function generateTaskTs(name: string, params: TaskParam[]): string {
  const L: string[] = [];
  L.push('import type { TaskContext } from "../../common/types.js";');
  L.push('');
  L.push(`// Auto-generated starter for "${name}". Edit this to implement your automation.`);
  L.push('export async function run({ page, params, outputDir, log, step }: TaskContext): Promise<void> {');

  const required = params.filter(p => p.required);
  if (required.length) {
    L.push('  // Required fields (enforced as a safety net for API/schedule calls):');
    for (const p of required) {
      const label = (p.label ?? p.name).replace(/"/g, '\\"');
      L.push(`  if (String(params["${p.name}"] ?? "").trim() === "") throw new Error("${label} is required.");`);
    }
    L.push('');
  }

  L.push('  log("INFO", `Params: ${JSON.stringify(params)}`);');

  const urlParam = params.find(p => p.type === "url") ?? params.find(p => /url/i.test(p.name));
  if (urlParam) {
    L.push('');
    L.push(`  const target = String(params["${urlParam.name}"] ?? "").trim();`);
    L.push('  if (target) await step("Open URL", () => page.goto(target, { waitUntil: "domcontentloaded" }));');
  }

  L.push('');
  L.push('  // TODO: add your automation steps here.');
  L.push('');
  L.push('  await step("Screenshot", () => page.screenshot({ path: `${outputDir}/screenshot.png` }));');
  L.push('}');
  L.push('');
  return L.join("\n");
}

// Create scripts/<dir>/task.ts + task_config.json for a new task. Never overwrites
// existing files (so registering a script that's already on disk is safe).
function scaffoldTaskFiles(
  scriptPath: string, name: string, description: string | null, tags: string[], params: TaskParam[],
  scriptContent?: string,
): void {
  const norm = scriptPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.includes("..")) throw new Error(`Invalid script path: ${scriptPath}`);
  if (!norm.endsWith(".ts")) throw new Error(`Script path must end with ".ts" (e.g. my_task/task.ts)`);
  if (!norm.includes("/")) throw new Error(`Script path must include a folder (e.g. my_task/task.ts)`);
  const fileAbs = path.join(config.scriptsDir, norm);
  const dirAbs = path.dirname(fileAbs);
  fs.mkdirSync(dirAbs, { recursive: true });
  // Uploaded source wins; otherwise generate a starter. Never clobber an existing file.
  if (!fs.existsSync(fileAbs))
    fs.writeFileSync(fileAbs, scriptContent?.trim() ? scriptContent : generateTaskTs(name, params), "utf8");
  const cfgAbs = path.join(dirAbs, "task_config.json");
  if (!fs.existsSync(cfgAbs))
    fs.writeFileSync(cfgAbs, JSON.stringify({ name, description, script_path: norm, tags, params }, null, 2), "utf8");
}

// Keep task_config.json in sync after an edit so disk-wins seeding doesn't revert it.
// Only rewrites the config that actually belongs to this task (matching script_path).
function syncTaskConfig(task: Task): void {
  const norm = task.script_path.replace(/\\/g, "/");
  const cfgAbs = path.join(config.scriptsDir, path.dirname(norm), "task_config.json");
  if (!fs.existsSync(cfgAbs)) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgAbs, "utf8"));
    if ((cfg.script_path ?? "").replace(/\\/g, "/") !== norm) return;   // config is for a different task
    cfg.name = task.name;
    cfg.description = task.description;
    cfg.tags = task.tags;
    cfg.params = task.params;
    fs.writeFileSync(cfgAbs, JSON.stringify(cfg, null, 2), "utf8");
  } catch { /* leave the config alone on parse/write errors */ }
}

tasks.get("/", wrap(async (_req, res) => {
  res.json(await tasksRepo.list());
}));

// Scripts on disk (scripts/<dir>/task_config.json) that aren't registered as tasks yet.
tasks.get("/available", wrap(async (_req, res) => {
  const registered = new Set((await tasksRepo.list()).map(t => t.script_path));
  const available: any[] = [];
  if (fs.existsSync(config.scriptsDir)) {
    for (const entry of fs.readdirSync(config.scriptsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cfgPath = path.join(config.scriptsDir, entry.name, "task_config.json");
      if (!fs.existsSync(cfgPath)) continue;
      let cfg: any;
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { continue; }
      if (!cfg.script_path || registered.has(cfg.script_path)) continue;
      available.push({
        name: cfg.name ?? entry.name,
        description: cfg.description ?? null,
        script_path: cfg.script_path,
        tags: cfg.tags ?? [],
        params: cfg.params ?? [],
      });
    }
  }
  res.json(available);
}));

tasks.get("/:id", wrap(async (req, res) => {
  const t = await tasksRepo.get(req.params.id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json(t);
}));

// Preview the input fields a script declares (parsed from its `Params` type), so the
// UI can show what will be generated before the task is created.
tasks.post("/parse-params", wrap(async (req, res) => {
  const source = typeof req.body?.script_content === "string" ? req.body.script_content : "";
  const detected = extractScriptParams(source);
  res.json({ detected, fields: toTaskParams(detected) });
}));

tasks.post("/", wrap(async (req, res) => {
  const p = TaskCreate.parse(req.body);
  if (await tasksRepo.getByScriptPath(p.script_path))
    return res.status(409).json({ error: `A task for "${p.script_path}" already exists` });
  try {
    scaffoldTaskFiles(p.script_path, p.name, p.description ?? null, p.tags, p.params, p.script_content);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to create script files" });
  }
  // Read back the script file that was just written, so its exact source is saved in the DB.
  let scriptSource: string | null = null;
  try {
    scriptSource = fs.readFileSync(path.join(config.scriptsDir, p.script_path.replace(/\\/g, "/")), "utf8");
  } catch { /* leave null if unreadable */ }
  // Auto-generate the task's input fields from the script's `Params` type when the
  // caller didn't supply any. This makes an uploaded script's UI fields appear by itself.
  let params = p.params;
  if ((!params || params.length === 0) && scriptSource) {
    const extracted = toTaskParams(extractScriptParams(scriptSource));
    if (extracted.length) params = extracted;
  }
  const t = await tasksRepo.create({
    name: p.name, description: p.description ?? null, script_path: p.script_path,
    tags: p.tags, params, script_source: scriptSource,
  });
  res.json(t);
}));

tasks.patch("/:id", wrap(async (req, res) => {
  const p = TaskUpdate.parse(req.body);
  const updated = await tasksRepo.update(req.params.id, {
    name: p.name, description: p.description ?? null, tags: p.tags, params: p.params,
  });
  if (!updated) return res.status(404).json({ error: "Task not found" });
  syncTaskConfig(updated);
  res.json(updated);
}));

tasks.delete("/:id", wrap(async (req, res) => {
  const task = await tasksRepo.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  await tasksRepo.remove(req.params.id);
  // Best-effort cleanup of the task's script files so no orphans are left on disk.
  try {
    const norm = task.script_path.replace(/\\/g, "/");
    const fileAbs = path.join(config.scriptsDir, norm);
    const dirAbs = path.dirname(fileAbs);
    if (fs.existsSync(fileAbs)) fs.rmSync(fileAbs, { force: true });
    // Remove task_config.json only if it belongs to THIS task (shared folders are safe).
    const cfgAbs = path.join(dirAbs, "task_config.json");
    if (fs.existsSync(cfgAbs)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgAbs, "utf8"));
        if ((cfg.script_path ?? "").replace(/\\/g, "/") === norm) fs.rmSync(cfgAbs, { force: true });
      } catch { /* leave config on parse error */ }
    }
    // Drop the folder if it's now empty.
    if (dirAbs !== config.scriptsDir && fs.existsSync(dirAbs) && fs.readdirSync(dirAbs).length === 0)
      fs.rmdirSync(dirAbs);
  } catch (e) {
    console.error(`[tasks] cleanup failed for ${task.script_path}:`, e);
  }
  res.status(204).end();
}));
