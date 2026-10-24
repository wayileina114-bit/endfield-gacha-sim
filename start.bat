@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem find node: bundled runtime first, then system PATH
if exist "%~dp0runtime\node.exe" (
  set "NODE_EXE=%~dp0runtime\node.exe"
  goto :run
)
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
  goto :run
)
echo [ERROR] Node.js not found.
echo         The bundled runtime\node.exe is missing and no system Node.js is installed.
echo         Install Node.js 18+ or place node.exe into the runtime\ folder, then retry.
pause
exit /b 1

:run
echo ================================================================
echo   Arknights: Endfield - Gacha Simulator
echo   Open http://127.0.0.1:3276 in your browser.
echo   To STOP the server: close this window, or double-click stop.bat,
echo   or click the [Shutdown] button in the page footer.
echo ================================================================
"%NODE_EXE%" server.js
pause
