@echo off
REM Re-login to Tabit when the session expires. Opens a Chrome window; log in
REM (email, password, pick user, access code), wait for the reservations
REM screen, then close the window. IMPORTANT: close the agent window first.
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca
"C:\Program Files\nodejs\node.exe" login.js
