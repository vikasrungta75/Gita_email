@echo off
REM Copy the existing Gita Mail database from Netlify into the local database.
REM Usage: local\import-from-cloud.bat "postgres://...cloud connection string (unpooled)..."
cd /d "%~dp0\.."
if "%~1"=="" (echo Give the cloud database connection string in quotes & exit /b 1)
if not exist data\backup mkdir data\backup
echo 1/3 Downloading the cloud database...
docker run --rm -v "%cd%\data\backup:/backup" postgres:17 pg_dump "%~1" -Fc --no-owner --no-acl -f /backup/cloud.dump || exit /b 1
echo 2/3 Starting the local database...
docker compose up -d db
timeout /t 5 >nul
echo 3/3 Restoring into the local database...
docker compose exec -T db pg_restore -U gitamail -d gitamail --no-owner --no-acl --clean --if-exists /backup/cloud.dump
echo Done. Now run: docker compose up -d --build
