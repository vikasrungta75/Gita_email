<#
  Gita Mail on a Windows desktop: one-time install (or repair).
  Needs Node.js 22 LTS (nodejs.org) and PostgreSQL 16+ (postgresql.org) installed first.
  Run in PowerShell from the app folder (e.g. C:\Vikproj\Gita_email):
      powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
  It creates the database, writes .env (if missing), installs packages, builds the web app,
  starts Gita Mail when you sign in to Windows, and backs up the database every night.
#>
$ErrorActionPreference = 'Stop'
$App = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $App
Write-Host "Gita Mail folder: $App"

# 1. Tools
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org and run this again.' }
$pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $pgBin) { throw 'PostgreSQL is not installed. Install it from https://www.postgresql.org/download/windows/ and run this again.' }
$psql = Join-Path $pgBin.FullName 'bin\psql.exe'
Write-Host "Node $(node -v), PostgreSQL $($pgBin.Name)"

# 2. Database
if (-not (Test-Path "$App\.env")) {
  $pgPass = Read-Host 'Password of the PostgreSQL "postgres" user (set when PostgreSQL was installed)' -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgPass))
  $dbPass = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  $hasRole = & $psql -U postgres -h localhost -tAc "select 1 from pg_roles where rolname='gitamail'"
  if ($hasRole -match '1') { & $psql -U postgres -h localhost -c "alter user gitamail with password '$dbPass';" | Out-Null }
  else { & $psql -U postgres -h localhost -c "create user gitamail with password '$dbPass';" | Out-Null }
  $exists = & $psql -U postgres -h localhost -tAc "select 1 from pg_database where datname='gitamail'"
  if ($exists -notmatch '1') { & $psql -U postgres -h localhost -c "create database gitamail owner gitamail;" | Out-Null }
  Remove-Item Env:\PGPASSWORD

  # 3. Settings
  $admin = Read-Host 'Your email (first administrator)'
  $adminPass = Read-Host 'Choose a password for Gita Mail (10+ characters, letters and numbers)'
  $hex = { param($n) -join ((1..$n) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }
  $envText = Get-Content "$App\.env.example" -Raw
  $set = { param($k, $v) $script:envText = [regex]::Replace($script:envText, "(?m)^$k=.*$", "$k=$v") }
  & $set 'DATABASE_URL' "postgres://gitamail:$dbPass@localhost:5432/gitamail?sslmode=disable"
  & $set 'JWT_SECRET' (& $hex 32)
  & $set 'ENCRYPTION_KEY' (& $hex 32)
  & $set 'INTERNAL_API_SECRET' (& $hex 24)
  & $set 'ADMIN_EMAIL' $admin
  & $set 'ADMIN_PASSWORD' $adminPass
  & $set 'ADMIN_NAME' 'Administrator'
  & $set 'APP_ROLE' 'local'
  Set-Content -Path "$App\.env" -Value $envText -Encoding UTF8
  Write-Host '.env written. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ANTHROPIC_API_KEY to it when you have them.'
} else { Write-Host '.env already exists: kept as it is.' }

# 4. Packages, build, database tables
npm ci --no-audit --no-fund
npm run build
npm run migrate
npm run check

# 5. Start with Windows (when you sign in), restart if it stops
$start = "$App\deploy\windows\start.cmd"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$start`"" -WorkingDirectory $App
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Gita Mail' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

# 6. Nightly backup at 21:00
$bAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-ExecutionPolicy Bypass -File `"$App\deploy\windows\backup.ps1`"" -WorkingDirectory $App
$bTrigger = New-ScheduledTaskTrigger -Daily -At 21:00
Register-ScheduledTask -TaskName 'Gita Mail backup' -Action $bAction -Trigger $bTrigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Force | Out-Null

Start-ScheduledTask -TaskName 'Gita Mail'
Start-Sleep -Seconds 8
Write-Host ''
Write-Host 'Gita Mail is installed and running: open http://localhost:8888'
Write-Host 'It starts by itself when you sign in to Windows. Logs: logs\gitamail.log'
