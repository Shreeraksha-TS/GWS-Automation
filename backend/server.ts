import express from "express";
import { ZodError } from "zod";
import { createServer } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { tasksRepo } from "../common/repo.js";
import { extractScriptParams, toTaskParams } from "../common/scriptParams.js";
import { config } from "./config.js";
import { tasks } from "./routes/tasks.js";
import { executions } from "./routes/executions.js";
import { schedules } from "./routes/schedules.js";
import { loadSchedules } from "./services/scheduler.js";
import { attachWs } from "./ws.js";

// Scan scripts/<dir>/task_config.json and upsert into the DB. Disk wins: existing
// tasks have their name/description/tags/params refreshed from the config file.
async function seedTasks(): Promise<void> {
  if (!fs.existsSync(config.scriptsDir)) return;
  for (const entry of fs.readdirSync(config.scriptsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(config.scriptsDir, entry.name, "task_config.json");
    if (!fs.existsSync(cfgPath)) continue;
    let cfg: any;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { continue; }
    if (!cfg.script_path) continue;
    let scriptSource: string | null = null;
    try { scriptSource = fs.readFileSync(path.join(config.scriptsDir, cfg.script_path), "utf8"); } catch { /* ignore */ }
    // The script's `Params` type is the source of truth for input fields. Derive them
    // automatically; fall back to the config's params only if the script declares none.
    const derived = scriptSource ? toTaskParams(extractScriptParams(scriptSource)) : [];
    await tasksRepo.upsertFromDisk({
      name: cfg.name ?? entry.name,
      description: cfg.description ?? null,
      script_path: cfg.script_path,
      tags: cfg.tags ?? [],
      params: derived.length ? derived : (cfg.params ?? []),
      script_source: scriptSource,
    });
  }
}

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

// Error handler: zod validation failures -> 400; everything else -> 500. Must be
// registered last and take 4 args so Express treats it as error-handling middleware.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError)
    return res.status(400).json({ error: "Invalid request body", details: err.issues });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = createServer(app);
attachWs(server);                            // WebSocket upgrades handled outside Express

// Startup: seed from disk and register schedules (both hit the DB) before listening.
(async () => {
  await seedTasks();
  await loadSchedules();
  server.listen(config.port, config.host, () =>
    console.log(`API listening on http://${config.host}:${config.port}`));
})().catch((e) => { console.error("Startup failed:", e); process.exit(1); });
