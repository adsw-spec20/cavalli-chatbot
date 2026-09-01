@echo off
REM Wrapper for the Windows scheduled task. Runs the Tabit bridge once and logs.
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca
"C:\Program Files\nodejs\node.exe" sync.js >> sync.log 2>&1
