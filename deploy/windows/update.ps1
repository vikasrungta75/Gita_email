<#  Updates Gita Mail to the latest code: backup, git pull, install, build, migrate, restart.
      powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1                    #>
$ErrorActionPreference = 'Stop'
$App = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $App
& "$PSScriptRoot\backup.ps1"
Stop-ScheduledTask -TaskName 'Gita Mail' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server[\\/]main\.ts' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
git pull
npm ci --no-audit --no-fund
npm run build
npm run migrate
Start-ScheduledTask -TaskName 'Gita Mail'
Write-Host 'Updated and restarted: http://localhost:8888'
