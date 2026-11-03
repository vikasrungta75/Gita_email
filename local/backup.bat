@echo off
REM Back up the local Gita Mail database to data\backup
cd /d "%~dp0\.."
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set D=%%i
docker compose exec -T db pg_dump -U gitamail -d gitamail -Fc -f /backup/gitamail-%D%.dump && echo Saved data\backup\gitamail-%D%.dump
