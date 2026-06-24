# worker/run-worker.ps1  —  usage:  .\run-worker.ps1 -Count 2
param([int]$Count = 2)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path   # ...\worker

# Load .env.worker into THIS process's environment (children inherit it)
Get-Content "$here\.env.worker" |
  Where-Object { $_ -match "=" -and $_ -notmatch "^\s*#" } |
  ForEach-Object {
    $name, $value = $_ -split "=", 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
  }

Write-Host "Starting $Count worker(s)..."
for ($i = 1; $i -le $Count; $i++) {
  # `npm run start` == `tsx worker.ts` (see worker/package.json)
  Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start" `
    -WorkingDirectory $here -NoNewWindow
  Write-Host "  worker #$i started"
}
Write-Host "Workers running. Close the windows or use Stop-Process to stop them."
