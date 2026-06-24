# worker/setup-worker.ps1  —  run once on the Windows host
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path   # ...\worker

Push-Location $here
Write-Host "Installing worker dependencies..."
npm install

Write-Host "Installing Playwright's Chromium browser..."
npx playwright install chromium       # replaces the old `rfbrowser init`
Pop-Location

Write-Host "Setup complete. Copy .env.worker.example to .env.worker and edit the paths."
