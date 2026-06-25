# enable-sql-tcp.ps1 -- one-time setup: let Node.js (mssql/tedious) reach SQL Server.
#
# SQL Server Express ships with TCP/IP DISABLED, and the mssql driver connects over
# TCP only. This enables TCP/IP, pins a static port (1433) so we don't need the
# SQL Browser service, and restarts the instance.
#
# RUN AS ADMINISTRATOR:
#   1. Start menu -> type "PowerShell" -> right-click -> "Run as administrator"
#   2. cd "C:\Users\2472667\Downloads\Automation Framework\Automation Framework"
#   3. ./enable-sql-tcp.ps1

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

# Resolve the SQLEXPRESS instance's registry id (e.g. MSSQL16.SQLEXPRESS).
$base = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server"
$instanceId = (Get-ItemProperty "$base\Instance Names\SQL").SQLEXPRESS
if (-not $instanceId) { throw "SQLEXPRESS instance not found in registry." }
$tcp = "$base\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp"

Write-Host "Instance: $instanceId" -ForegroundColor Cyan

Set-ItemProperty -Path $tcp            -Name Enabled          -Value 1
Set-ItemProperty -Path "$tcp\IPAll"    -Name TcpPort          -Value "1433"
Set-ItemProperty -Path "$tcp\IPAll"    -Name TcpDynamicPorts  -Value ""
Write-Host "TCP/IP enabled; static port 1433 set." -ForegroundColor Green

Restart-Service 'MSSQL$SQLEXPRESS' -Force
Start-Sleep -Seconds 2
$status = (Get-Service 'MSSQL$SQLEXPRESS').Status
Write-Host "SQLEXPRESS service: $status" -ForegroundColor Green
Write-Host "Done. Node can now connect to localhost:1433." -ForegroundColor Cyan
