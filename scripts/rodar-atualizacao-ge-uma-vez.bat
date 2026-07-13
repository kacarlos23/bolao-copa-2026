@echo off
setlocal
cd /d "%~dp0\.."
npm --workspace @bolao/api run scrape:ge-scores:once -- --force
pause
