<#  Restores a backup. REPLACES everything in the Gita Mail database.
      powershell -ExecutionPolicy Bypass -File deploy\windows\restore.ps1 backups\gitamail-2026-11-21-2100.dump   #>
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
$App = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $App
if ((Read-Host "This replaces ALL data with $File. Type RESTORE to continue") -ne 'RESTORE') { Write-Host 'Cancelled'; exit 1 }
$url = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', '' -replace '\?.*$', ''
$pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory | Sort-Object Name -Descending | Select-Object -First 1
Stop-ScheduledTask -TaskName 'Gita Mail' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server[\\/]main\.ts' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
& (Join-Path $pgBin.FullName 'bin\pg_restore.exe') --clean --if-exists --no-owner --dbname=$url $File
Start-ScheduledTask -TaskName 'Gita Mail'
Write-Host "Restored from $File"
