# run-worker.ps1 -- start the Playwright worker for LOCAL (no-Docker) development.
#
# The worker claims QUEUED executions from SQL Server and runs the task scripts.
# It is a SEPARATE process from the API (run-local.ps1) -- BOTH must be running.
#
# Usage:  ./run-worker.ps1
# Leave this window open; it polls for jobs until you close it (Ctrl+C).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$env:DATA_DIR    = Join-Path $root "data"
$env:SCRIPTS_DIR = Join-Path $root "scripts"
$env:REPORTS_DIR = Join-Path $root "reports"
$env:SECRET_KEY  = "dev-secret"

if (-not (Test-Path (Join-Path $root "worker\node_modules"))) {
    Write-Host "Worker deps not installed. Run first:" -ForegroundColor Yellow
    Write-Host "  npm install --prefix worker"
    exit 1
}

Write-Host "Worker starting. SCRIPTS_DIR=$env:SCRIPTS_DIR" -ForegroundColor Cyan
npm start --prefix "$root\worker"