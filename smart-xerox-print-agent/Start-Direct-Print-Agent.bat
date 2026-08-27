@echo off
title Smart Xerox Direct Silent Auto-Print Engine (0 Popups)
color 0A
echo ========================================================
echo   🤖 STARTING DIRECT SILENT AUTO-PRINT AGENT (0 POPUPS)
echo ========================================================
echo.
cd /d "%~dp0"

if not exist node_modules (
  echo 📦 Setting up direct silent print engine...
  npm install axios socket.io-client ipp --no-audit --no-fund
  echo.
)

echo ⚡ DIRECT SILENT PRINT ACTIVE! No print dialogs will open.
if exist agent.js (
  node agent.js
) else if exist direct-agent.js (
  node direct-agent.js
) else (
  echo ❌ Error: agent.js file not found!
)
pause
