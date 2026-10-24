@echo off
rem Stop the Endfield gacha simulator - and ONLY it.
rem Identity-checked in stop-server.ps1: node.exe + server.js on port 3276.
rem Other programs on that port are reported and left untouched.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-server.ps1"
echo.
echo You can close this window now.
pause
