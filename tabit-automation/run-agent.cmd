@echo off
REM Runs the always-on Tabit agent (queue worker + periodic snapshot).
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca
"C:\Program Files\nodejs\node.exe" agent.js >> agent.log 2>&1
