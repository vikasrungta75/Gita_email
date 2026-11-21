@echo off
REM Starts Gita Mail (used by the "Gita Mail" scheduled task). Output goes to logs\gitamail.log
cd /d "%~dp0\..\.."
if not exist logs mkdir logs
npm start >> logs\gitamail.log 2>&1
