@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if /I "%~1"=="--silent" goto silent

title Bolao Copa 2026 - Inicializacao
echo Verificando e inicializando o Bolao Copa 2026...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\check-start-project.ps1"
set "BOLAO_EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%BOLAO_EXIT_CODE%"=="0" echo Falha na inicializacao. Consulte os arquivos na pasta logs.
pause
exit /b %BOLAO_EXIT_CODE%

:silent
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\check-start-project.ps1"
exit /b %ERRORLEVEL%
