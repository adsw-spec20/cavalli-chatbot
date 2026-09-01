@echo off
REM Runs the always-on Tabit agent (queue worker + periodic snapshot).
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca
"C:\Program Files\nodejs\node.exe" agent.js
echo.
echo ========================================================
echo   הסוכן נעצר. אם זה קרה מיד - קרא את השורות למעלה.
echo   ("agent.lock" = כבר רץ סוכן / "401" = צריך התחברות מחדש)
echo ========================================================
pause
