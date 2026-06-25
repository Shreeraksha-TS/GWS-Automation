# run-local.ps1 — start the Express API for LOCAL (no-Docker) development on Windows.
#
# Why this script exists: common/store.ts reads DATA_DIR straight from the environment,
# and the API resolves scripts/reports from env vars too. Docker sets these for the
# container; locally we export the repo's folders before launching the API via tsx.
#
# Usage:   ./run-local.ps1   (also auto-launches the Playwright worker in a new window)
# Then in a second terminal:   npm run dev --prefix frontend
# Open:    http://localhost:5173   (Vite proxies /api, /ws, /reports to :8000)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$env:DATA_DIR    = Join-Path $root "data"
$env:SCRIPTS_DIR = Join-Path $root "scripts"
$env:REPORTS_DIR = Join-Path $root "reports"
$env:SECRET_KEY  = "dev-secret"
# STATIC_DIR intentionally unset: the SPA is served by the Vite dev server in dev.

if (-not (Test-Path (Join-Path $root "backend\node_modules"))) {
    Write-Host "Backend deps not installed. Run first:" -ForegroundColor Yellow
    Write-Host "  npm install --prefix backend"
    exit 1
}

# Start the Playwright worker in its own window so it claims QUEUED jobs.
# (The worker is a SEPARATE process from the API -- without it, runs sit in QUEUED.)
$workerScript = Join-Path $root "run-worker.ps1"
Write-Host "Launching worker in a new window..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-File", $workerScript

Write-Host "API on http://localhost:8000  DATA_DIR=$env:DATA_DIR" -ForegroundColor Cyan
npm start --prefix "$root\backend"
