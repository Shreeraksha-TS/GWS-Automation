# Local development (all-native, no Docker)

The canonical deployment runs the **API in Docker** and the **worker natively** on
Windows (see [README.md](README.md) and [`claude.md`](claude.md)). For fast iteration
you can instead run **everything natively** — the Express API via `tsx` and the
Playwright worker(s) via their scripts — both pointed at this repo's `data/` folder.
The whole stack is TypeScript and `tsx` runs it directly (no build step), so this is a
full end-to-end stack with **no Docker and no Python**, including the real Chromium run.

## One-time setup

```powershell
# 1. API + frontend deps
npm install --prefix backend
npm install --prefix frontend

# 2. Worker deps + Chromium
cd worker
Copy-Item .env.worker.example .env.worker     # then edit the paths (see below)
.\setup-worker.ps1                              # npm install + `npx playwright install chromium`
cd ..
```

> **Node version.** `package.json` files use `^` ranges, so `npm install` resolves
> current builds — the stack runs cleanly on **Node 24** even though the spec targets
> Node 20. No Python is involved anywhere.

### Point every path at the same folder

The whole system hinges on the API and the worker sharing one `data/` folder. For an
all-native dev run, point them all at this repo:

- **API** (`run-local.ps1`) already exports `DATA_DIR=<repo>\data`,
  `SCRIPTS_DIR=<repo>\scripts`, `REPORTS_DIR=<repo>\reports`.
- **Worker** (`worker/.env.worker`) must use the **same** three folders:

  ```env
  DATA_DIR=C:\Automation Framework\data
  REPORTS_DIR=C:\Automation Framework\reports
  SCRIPTS_DIR=C:\Automation Framework\scripts
  WORKER_POLL_INTERVAL=3
  WORKER_HEADLESS=true        # false = watch Chromium on the desktop
  ```

## Run

```powershell
# Terminal 1 — API (sets DATA_DIR / SCRIPTS_DIR / REPORTS_DIR, runs `tsx server.ts`)
./run-local.ps1

# Terminal 2 — frontend dev server
npm run dev --prefix frontend         # http://localhost:5173 (proxies /api, /ws, /reports → :8000)

# Terminal 3 — native worker(s)
cd worker
.\run-worker.ps1 -Count 2
```

Open **http://localhost:5173**, run the *Open Google* task, and watch
`QUEUED → RUNNING → PASSED` with live logs and a real browser run.

## Why the env vars are required

`common/store.ts` reads `DATA_DIR` directly from the environment (it has no config
dependency, so the worker can import it with nothing installed). The backend's
`config.ts` reads the same env vars. `run-local.ps1` and `run-worker.ps1` export the
paths before launching, which is exactly what Docker does for the API via the compose
`environment:` block and bind mounts.

## How this differs from the canonical setup

| | Canonical (README) | All-native (this file) |
|---|---|---|
| API | Docker container (Express via `tsx`) | `tsx server.ts` via `run-local.ps1` |
| Worker | Native Windows Node process | Native Windows Node process (same) |
| Shared `data/` | Host folder bind-mounted into the API container | Plain repo folder for both |
| Use when | Production-like / demo | Fast local iteration |

The **worker is identical** in both; only how the API is launched changes. The one
thing the all-native path does *not* exercise is the Docker bind-mount file-sharing
layer between the container and the host.

## Stopping

```powershell
Get-Process node | Stop-Process            # stops API + workers (close the Vite window too)
```
