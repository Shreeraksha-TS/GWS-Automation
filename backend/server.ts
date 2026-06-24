import express from "express";
import { ZodError } from "zod";
import { createServer } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as store from "../common/store.js";
import { newTask } from "../common/records.js";
import { config } from "./config.js";
import { tasks } from "./routes/tasks.js";
import { executions } from "./routes/executions.js";
import { schedules } from "./routes/schedules.js";
import { loadSchedules } from "./services/scheduler.js";
import { attachWs } from "./ws.js";
import type { Task } from "../common/types.js";

// Scan scripts/<dir>/task_config.json: create tasks that don't exist yet, and
// keep the param definitions of existing tasks in sync with their config file.
function seedTasks(): void {
  const existing = store.listEntities<Task>(store.TASKS_DIR);
  const byPath = new Map(existing.map(t => [t.script_path, t]));
  if (!fs.existsSync(config.scriptsDir)) return;
  for (const entry of fs.readdirSync(config.scriptsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(config.scriptsDir, entry.name, "task_config.json");
    if (!fs.existsSync(cfgPath)) continue;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const params = cfg.params ?? [];
    const prev = byPath.get(cfg.script_path);
    if (prev) {
      // Refresh declared params for tasks seeded before this field existed.
      if (JSON.stringify(prev.params ?? []) !== JSON.stringify(params)) {
        store.saveEntity(store.TASKS_DIR, prev.id, { ...prev, params, updated_at: new Date().toISOString() });
      }
      continue;
    }
    const t = newTask(cfg.name, cfg.script_path, cfg.description ?? null, cfg.tags ?? [], params);
    store.saveEntity(store.TASKS_DIR, t.id, t);
  }
}

// ── Startup ──────────────────────────────────────────────────────────
store.initStorage();   // create the data/ tree (idempotent)
seedTasks();           // auto-seed tasks from task_config.json files
loadSchedules();       // register active schedules with node-cron

const app = express();
app.use(express.json());
app.use((_req, res, next) => {              // permissive CORS for the POC
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Access-Control-Allow-Headers", "*");
  next();
});

// API routers
app.use("/api/tasks", tasks);
app.use("/api", executions);                 // owns /api/tasks/:id/run + /api/executions/*
app.use("/api/schedules", schedules);

// Generated HTML reports ("View Report" opens /reports/<execution_id>/report.html)
fs.mkdirSync(config.reportsDir, { recursive: true });
app.use("/reports", express.static(config.reportsDir));

// React static build + SPA fallback (registered last so it never swallows /api or /ws)
if (fs.existsSync(config.staticDir)) {
  app.use(express.static(config.staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/reports")) return next();
    res.sendFile(path.join(config.staticDir, "index.html"));
  });
}

// Error handler: zod validation failures → 400 (the routes call `.parse()`, which
// throws a ZodError; without this, Express's default handler would return 500). Must be
// registered last and take 4 args so Express treats it as error-handling middleware.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError)
    return res.status(400).json({ error: "Invalid request body", details: err.issues });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = createServer(app);
attachWs(server);                            // WebSocket upgrades handled outside Express
server.listen(config.port, config.host, () =>
  console.log(`API listening on http://${config.host}:${config.port}`));
