# UI Task Automation Platform — Phase 1 POC

A self-hosted, web-based **RPA (Robotic Process Automation)** platform. Upload and
manage **Playwright** automation scripts (TypeScript modules), trigger them from a web
UI or on a cron schedule, watch their logs stream live, and review pass/fail results
with a generated HTML report.

This is the **Phase 1 proof-of-concept**, and the whole stack is **TypeScript/Node.js**:
the **API + frontend run in one Docker container** (Express + a static React build) and
the **Playwright worker(s) run natively as Windows processes**, sharing state through
JSON files in a host folder. **There is no database and no Python anywhere.** The full
specification lives in [`claude.md`](claude.md) (the previous Robot-Framework/Python
variant is preserved as [`claude_bk.md`](claude_bk.md)).

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Why one language?](#why-one-language)
- [Why a native Windows worker?](#why-a-native-windows-worker)
- [Why no database?](#why-no-database)
- [Project structure](#project-structure)
- [Quick start](#quick-start)
- [Local development (no Docker)](#local-development-no-docker)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Adding a task](#adding-a-task)
- [Inspecting state on disk](#inspecting-state-on-disk)
- [Verification status](#verification-status)
- [Notes & gotchas](#notes--gotchas)
- [Deviations from the spec](#deviations-from-the-spec)
- [Known limitations](#known-limitations)

---

## Features

- **Task management** — automation scripts are auto-discovered from `scripts/` and
  surfaced as runnable tasks; create/delete via API or UI.
- **Manual & scheduled triggers** — run on demand from the UI, or register a cron
  schedule (node-cron) that enqueues runs automatically.
- **Live log streaming** — step-level Playwright output streams to the browser over a
  WebSocket while a task runs; finished runs load their full logs over HTTP.
- **Results & reports** — pass/fail status, duration, and a link to a generated
  `report.html` with the log table and screenshots.
- **Native, parallel workers** — two Node + Playwright worker processes by default on
  the Windows host, scalable, each claiming jobs from a shared queue with no
  double-execution. Headless **or** visible (`WORKER_HEADLESS=false`) browser runs.

---

## Architecture

```
  ┌─────────────────────── Windows host ────────────────────────────────┐
  │                                                                      │
  │   Docker Desktop                          Native processes           │
  │   ┌──────────────────────────┐            ┌────────────────────────┐ │
  │   │  api (Express, tsx)       │            │  worker.ts × 2         │ │
  │   │  • REST /api/...          │            │  (node + tsx)          │ │
  │   │  • WS /ws/.../logs        │            │  • claim job           │ │
  │   │  • node-cron scheduler    │            │  • drive Chromium via  │ │
  │   │  • serves React + reports │            │    Playwright directly │ │
  │   └────────────┬─────────────┘            │  • write status+logs   │ │
  │                │  bind mount               │  • write report.html   │ │
  │                ▼                           └───────────┬────────────┘ │
  │        C:\…\data   ◀───── same host folder ────────────┘              │
  │        C:\…\reports        (queue + records + logs)                   │
  │        C:\…\scripts                                                   │
  └──────────────────────────────────────────────────────────────────────┘
```

- **`api`** (Docker, Node 20 + Express, run via `tsx`) — REST + WebSocket API, the
  embedded node-cron scheduler, and it serves the compiled React app and the generated
  HTML reports. Bind-mounts the host `data/`, `reports/`, and `scripts/` folders.
- **`worker`** (native Windows Node process, `tsx worker.ts`) — polls the file-based
  job queue, launches Chromium through the `playwright` package, dynamic-imports the
  task module and calls its exported `run()`, then writes results back. **Not
  containerised.**
- **`common/`** — `store.ts`, `records.ts`, `jobqueue.ts`, `types.ts` are shared: the
  API image `COPY`s them in; the native worker imports them via relative `../common/…`
  paths. They use only Node's standard library, so neither side installs anything for
  them.

### How the file store replaces a database

| Database job | File-based replacement |
|---|---|
| Tables / rows | One JSON file per record under `data/{tasks,executions,schedules}/` |
| Safe concurrent writes | Atomic write: temp file in the same dir, then `fs.renameSync()` (with a Windows-safe retry for AV/indexer locks) |
| `SELECT … FOR UPDATE SKIP LOCKED` queue | A job file in `queue/pending/`, claimed by an atomic `fs.renameSync()` into `queue/running/` — exactly one worker wins, losers get `ENOENT` |
| Append-only event log | `data/logs/{execution_id}.jsonl`, tailed by line number |

## Why one language?

Robot Framework's Browser Library was only ever a Python wrapper around Playwright's
Node.js engine. Calling **Playwright directly** removes the wrapper, removes Python, and
lets the frontend, backend, **and** worker share one language (TypeScript) and one
toolchain (Node 20 + [`tsx`](https://github.com/privatenumber/tsx)). `tsx` runs `.ts`
directly — no build step — so task scripts under `scripts/` are `.ts` modules the worker
dynamic-imports at runtime: drop a folder in and it works.

## Why a native Windows worker?

RPA frequently has to drive the *real* Windows environment — native desktop apps, a
headed (visible) browser, a logged-in session, locally installed drivers, or hardware.
A Linux Docker container can't reach the Windows desktop, so the worker runs **on
Windows itself**. The API stays containerised because it has no such requirement. The
two meet at a **host folder**: the API bind-mounts it; the native worker points
`DATA_DIR` at the same Windows path. The whole trick is that `HOST_DATA_DIR` (API) and
`DATA_DIR` (worker) resolve to the **same folder**.

## Why no database?

Removing PostgreSQL means one fewer service and a state directory you can read by hand.
The filesystem takes over the two jobs the DB did — a job queue (atomic
directory-rename) and safe concurrent writes (atomic file replace). When the POC needs
many workers, multi-host, or transactions, only `store.ts` and `jobqueue.ts` are swapped
for SQLite/Postgres — the API, scheduler, worker, and frontend are untouched.

---

## Project structure

```
.
├── docker-compose.yml          # single `api` service; data/reports/scripts are HOST bind mounts
├── .env / .env.example         # API config + HOST_* folder paths
├── tsconfig.base.json          # shared TS compiler options (ESM / NodeNext)
├── claude.md                   # the current spec (all-Node.js / Playwright)
├── claude_bk.md                # the previous spec (Python / Robot Framework) — historical
├── README.md                   # this file
├── LOCAL_DEV.md                # all-native dev workflow (API + worker, no Docker)
├── run-local.ps1               # helper: run the API natively via tsx (instead of Docker)
│
├── common/                     # shared TS modules (COPYd into the API image; imported by the worker)
│   ├── store.ts · records.ts · jobqueue.ts · types.ts
│
├── backend/                    # Express application (Docker)
│   ├── Dockerfile              # multi-stage: builds React, then runs the API via tsx
│   ├── package.json · tsconfig.json
│   ├── server.ts · config.ts · schemas.ts (zod) · ws.ts
│   ├── routes/                 # tasks · executions · schedules
│   └── services/scheduler.ts   # node-cron
│
├── worker/                     # Playwright worker — RUNS NATIVELY ON WINDOWS
│   ├── worker.ts               # polling loop; claims jobs
│   ├── runner.ts               # launches Chromium, runs the task module, writes report.html
│   ├── package.json · tsconfig.json
│   ├── .env.worker.example     # worker paths (must match the API's HOST_* folders)
│   ├── setup-worker.ps1        # one-time: npm install + `npx playwright install chromium`
│   ├── run-worker.ps1          # launch N native worker processes
│   └── Dockerfile.linux        # OPTIONAL legacy headless-Linux worker (not used)
│
├── scripts/open_google/        # sample task (auto-seeded on boot)
│   ├── task.ts                 # exports async run(ctx) — drives Playwright
│   └── task_config.json
│
├── frontend/                   # React 18 + Vite + Tailwind (unchanged)
│   └── src/{pages,components,api,types,lib}
│
└── data/                       # ALL STATE — a HOST folder shared by api + native worker
    ├── tasks/ · executions/ · schedules/ · logs/
    └── queue/{pending,running,done}/
```

---

## Quick start

> Single Windows host. Docker Desktop runs the API; the worker runs natively beside it.

**Prerequisites:** Docker Desktop (file sharing enabled), **Node.js 20 LTS (64-bit)**,
and Git — all on the Windows host. **No Python.** Playwright downloads its own Chromium.

### A. API (Docker)

```powershell
# 1. Create the shared HOST folders (bind-mounted into the container AND used by the worker)
mkdir C:\rpa-platform\data, C:\rpa-platform\reports -Force

# 2. Configure: copy the example and set HOST_DATA_DIR / HOST_REPORTS_DIR / HOST_SCRIPTS_DIR
Copy-Item .env.example .env
#   HOST_SCRIPTS_DIR should point at this repo's scripts\ folder.

# 3. Build and start the single `api` service
docker compose up --build -d
docker compose ps                 # one service: api (no worker, no DB)
Start-Process http://localhost:8000
```

### B. Worker (native Windows)

```powershell
cd worker

# 4. One-time setup: npm install + download Chromium
Copy-Item .env.worker.example .env.worker
#   Set DATA_DIR / REPORTS_DIR / SCRIPTS_DIR to the SAME folders as the API's HOST_* vars.
.\setup-worker.ps1

# 5. Launch 2 native workers
.\run-worker.ps1 -Count 2
```

**Try it:** open http://localhost:8000 → **Tasks** → **Run** on *Open Google* →
**Executions** → watch `QUEUED → RUNNING → PASSED` with live logs, then **View Report**.
Set `WORKER_HEADLESS=false` in `.env.worker` to watch Chromium open on the desktop.

**Stop:** close the worker windows (or `Get-Process node | Stop-Process`), then
`docker compose down`. **Scale:** re-run `.\run-worker.ps1 -Count N`.

---

## Local development (no Docker)

For fast iteration you can run **everything natively** — the API via `tsx` and the
worker via its scripts — both pointed at this repo's `data/` folder. With no Python and
no build step, this is a full end-to-end stack with `tsx` running the TypeScript
directly. See [LOCAL_DEV.md](LOCAL_DEV.md). In short:

```powershell
# one-time
npm install --prefix backend
npm install --prefix frontend
cd worker; .\setup-worker.ps1; cd ..      # npm install + playwright chromium

# API (terminal 1) — sets DATA_DIR / SCRIPTS_DIR / REPORTS_DIR and runs tsx
./run-local.ps1
npm run dev --prefix frontend             # UI on :5173, proxies /api, /ws, /reports → :8000

# Worker (terminal 2)
cd worker; .\run-worker.ps1 -Count 2
```

---

## Configuration

All configuration is environment variables. There is **no** `DATABASE_URL`.

### API — [`.env`](.env.example) (consumed by Docker Compose)

| Variable | Example | Purpose |
|---|---|---|
| `DATA_DIR` | `/app/data` | State root **inside** the container |
| `SCRIPTS_DIR` / `REPORTS_DIR` | `/app/scripts` `/app/reports` | Paths inside the container |
| `SECRET_KEY` | `change-me…` | Reserved for future auth |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Frontend build-time API base (empty = same-origin) |
| `HOST_DATA_DIR` | `C:\rpa-platform\data` | **Host** folder bind-mounted to `/app/data` |
| `HOST_REPORTS_DIR` | `C:\rpa-platform\reports` | **Host** folder bind-mounted to `/app/reports` |
| `HOST_SCRIPTS_DIR` | `<repo>\scripts` | **Host** folder bind-mounted to `/app/scripts` |

### Worker — [`worker/.env.worker`](worker/.env.worker.example) (native process)

| Variable | Example | Purpose |
|---|---|---|
| `DATA_DIR` | `C:\rpa-platform\data` | **Must equal** the API's `HOST_DATA_DIR` |
| `REPORTS_DIR` | `C:\rpa-platform\reports` | **Must equal** `HOST_REPORTS_DIR` |
| `SCRIPTS_DIR` | `C:\rpa-platform\scripts` | **Must equal** `HOST_SCRIPTS_DIR` |
| `WORKER_POLL_INTERVAL` | `3` | Seconds between queue polls |
| `WORKER_HEADLESS` | `true` | `false` shows the browser on the desktop |

> **The one rule that matters:** the API's `HOST_DATA_DIR` and the worker's `DATA_DIR`
> must be the **same Windows folder**, or the API enqueues jobs the worker never sees.

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tasks` | List tasks |
| `POST` | `/api/tasks` | Create a task (zod-validated) |
| `GET` | `/api/tasks/:id` | Get a task |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `POST` | `/api/tasks/:id/run` | Trigger a run → returns the execution |
| `GET` | `/api/executions` | List executions (optional `?task_id=`) |
| `GET` | `/api/executions/:id` | Get an execution |
| `GET` | `/api/executions/:id/logs?after_id=0` | Log lines from a cursor |
| `WS` | `/ws/executions/:id/logs` | Live log stream (closes on terminal status) |
| `GET` | `/api/schedules` | List schedules |
| `POST` | `/api/schedules` | Create a schedule (validates cron) |
| `PATCH` | `/api/schedules/:id/toggle` | Pause / resume |
| `DELETE` | `/api/schedules/:id` | Delete a schedule |
| `GET` | `/reports/:execution_id/report.html` | Generated HTML report |

```powershell
# Example: trigger the sample task
curl -X POST http://localhost:8000/api/tasks/<task-id>/run `
     -H "Content-Type: application/json" -d '{\"robot_params\": {}}'
```

---

## Adding a task

A task is a **folder under `scripts/`** containing a Playwright module plus a config
file. The worker dynamic-imports the module at runtime (via `tsx`) — no build, no
recompile.

1. Create `scripts/<your_task>/task.ts` exporting an async `run(ctx)`. The runner hands
   it a Playwright `page`, the run's `params`, an `outputDir` for artifacts, and
   `log`/`step` helpers for live logging:
   ```ts
   import type { TaskContext } from "../../common/types.js";

   export async function run({ page, params, outputDir, log, step }: TaskContext): Promise<void> {
     const term = (params.TERM as string) ?? "Playwright";
     await step("Open Wikipedia", () => page.goto("https://www.wikipedia.org"));
     await step("Search", async () => {
       await page.fill("#searchInput", term);
       await page.click("button[type=submit]");
     });
     const title = await step("Get title", () => page.title());
     log("INFO", `Title: ${title}`);
     await step("Screenshot", () => page.screenshot({ path: `${outputDir}/result.png` }));
   }
   ```
   - `headless` is decided by the runner (`WORKER_HEADLESS`), not the task.
   - Each key in a run's `robot_params` arrives in `params` (e.g. `{"TERM": "FastAPI"}`).
   - Throwing from `run()` (or from inside a `step`) fails the execution.
2. Add `scripts/<your_task>/task_config.json`:
   ```json
   {
     "name": "Search Wikipedia",
     "description": "Searches Wikipedia and screenshots the result.",
     "script_path": "<your_task>/task.ts",
     "tags": ["smoke", "browser"]
   }
   ```
3. Restart the `api` service. Tasks are auto-seeded on startup and de-duplicated by
   `script_path`, so re-seeding never creates duplicates. (The worker needs no restart.)

> Any npm package your task imports must be available to the worker — add it to
> `worker/package.json` and `npm install`. `playwright` is already there.

---

## Inspecting state on disk

No database client needed — it's all readable JSON, **directly on the host**:

```powershell
Get-ChildItem -Recurse C:\rpa-platform\data
Get-Content C:\rpa-platform\data\executions\<execution-id>.json
```

A run leaves a trail you can watch: an execution file flips
`QUEUED → RUNNING → PASSED`, and its job file moves
`queue/pending/ → queue/running/ → queue/done/`.

---

## Verification status

Verified on a Windows host (Node 24), running the **API natively** (`tsx`) and the
**Playwright worker natively** against a shared `data/` folder — a full end-to-end run
of the converted all-Node.js stack:

- ✅ `npm install` (backend + worker) and `npx playwright install chromium` (~130 MB) succeed
- ✅ Express API boots via `tsx`, auto-seeds **Open Google** (`script_path=open_google/task.ts`)
- ✅ `POST /api/tasks/:id/run` creates an execution record **and** a time-ordered
  `queue/pending/` job
- ✅ Native worker starts (`headless=true`), claims the job (atomic
  `pending → running → done`), dynamic-imports `task.ts`, and drives **real Chromium**
  via Playwright — `QUEUED → RUNNING → PASSED`
- ✅ Navigates to google.com, asserts the title contains `Google`, captures
  `reports/<id>/google_home.png` (~107 KB)
- ✅ `report.html` generated and served at `/reports/<id>/report.html` (HTTP 200);
  step-level logs (`▶ Task → ▷ Navigate → ▷ Get Title → … → ✅ [PASS]`) captured to
  `logs/<id>.jsonl`
- ✅ Schedules create/toggle/list/delete; cron-parser computes `next_run_at`; invalid
  cron rejected with `400`; bad task body rejected with `400` (see Deviations)
- ℹ️ The **Docker bind-mount** path follows the spec but was exercised here with the API
  run natively (`tsx`); the worker (native NTFS) side is identical either way.

---

## Notes & gotchas

- **`tsx` runs TypeScript directly — no build step.** Both the API (`tsx server.ts`) and
  the worker (`tsx worker.ts`) execute `.ts` as ESM (NodeNext). Relative imports use the
  `.js` extension even for `.ts` files (e.g. `import * as store from "../common/store.js"`)
  — that's the NodeNext convention, and both `tsx` and `tsc` resolve it to the `.ts`.
- **Caret ranges intentionally pull current builds.** `package.json` uses `^` ranges
  (e.g. `tsx ^4.16.2`, `playwright ^1.45.0`), so `npm install` resolves the latest
  compatible release — which is what makes the stack run cleanly on **Node 24** even
  though the spec was written against Node 20.
- **`npx playwright install chromium` downloads ~130 MB once.** It's the direct
  equivalent of the old `rfbrowser init`. On Windows no `--with-deps` is needed.
- **Local dev needs the env vars.** `common/store.ts` reads `DATA_DIR` straight from the
  environment; `run-local.ps1` and `run-worker.ps1` export the repo's folders before
  launching. Docker does the equivalent via the compose `environment:` block and bind
  mounts.

---

## Deviations from the spec

The spec is the source of truth; one minimal change was made so the project meets its
own acceptance criteria, plus an environment note:

1. **zod errors → HTTP 400.** The routes call `Schema.parse(req.body)`, which throws a
   `ZodError` on bad input. The spec includes no error handler, so Express's default
   handler would return **500** — but the acceptance criteria require **400** for
   invalid bodies. Added a small error-handling middleware in `backend/server.ts` that
   maps `ZodError → 400` (everything else → 500).
2. **Node 24 host.** Dependencies install via their `^` ranges (see Notes), so current
   builds compatible with Node 24 are used; `package.json` keeps the spec's pinned
   floors. No source changes.

---

## Known limitations (by design, POC)

- **Last-write-wins** if two writers touch the same record at the same instant; no
  transactions.
- **No cross-host atomicity** — the atomic-rename queue holds within a single
  filesystem, so keep `data/` on one host (the POC does).
- **Docker bind-mount boundary** — the API writes through Docker Desktop's
  file-sharing layer while the native worker writes through native NTFS. Only one side
  ever writes a given file (the API creates uniquely-named pending jobs; the claiming
  worker is the sole writer of that execution's record), so this is safe for the POC.
- **Linear directory scans** for list endpoints — fine for hundreds of records, not
  millions.
- Swapping `store.ts` + `jobqueue.ts` for SQLite or Postgres removes all of the above
  without touching the API, scheduler, worker, or frontend.
```
