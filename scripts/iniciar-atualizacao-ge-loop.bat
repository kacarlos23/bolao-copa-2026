@echo off
setlocal
cd /d "%~dp0\.."
npm run scrape:ge-scores:watch
