<#  Backs up the Gita Mail database to the backups folder (keeps 30 days).
      powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1                    #>
$ErrorActionPreference = 'Stop'
$App = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $App
$url = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', '' -replace '\?.*$', ''
$pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory | Sort-Object Name -Descending | Select-Object -First 1
New-Item -ItemType Directory -Force -Path "$App\backups" | Out-Null
$file = "$App\backups\gitamail-$(Get-Date -Format 'yyyy-MM-dd-HHmm').dump"
& (Join-Path $pgBin.FullName 'bin\pg_dump.exe') --format=custom --no-owner --dbname=$url --file=$file
Write-Host "Saved $file"
Get-ChildItem "$App\backups\gitamail-*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
