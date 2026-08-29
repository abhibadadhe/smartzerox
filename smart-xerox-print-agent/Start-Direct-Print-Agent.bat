@echo off
title Smart Xerox Direct Silent Auto-Print Engine
color 0A
cls
echo ========================================================
echo   🤖 SMART XEROX DIRECT SILENT AUTO-PRINT AGENT
echo ========================================================
echo.

cd /d "%~dp0"

echo 🔍 Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
  color 0C
  echo.
  echo ❌ ERROR: Node.js is NOT installed on this computer!
  echo ----------------------------------------------------
  echo 1. Please download and install Node.js from:
  echo    👉 https://nodejs.org (Download LTS Version)
  echo 2. After installing Node.js, restart this bat file.
  echo ----------------------------------------------------
  echo.
  pause
  exit /b
)
echo ✅ Node.js is detected!

echo.
echo 🔍 Checking configuration file...
if not exist config.json if not exist agent-config.json (
  color 0E
  echo ⚠️ Config file not found. Creating default config.json...
  (
    echo {
    echo   "apiUrl": "https://api.pratibimb.online",
    echo   "shopkeeperEmail": "pratibimb@example.com",
    echo   "shopkeeperPassword": "Password@123",
    echo   "silentPrint": true,
    echo   "printers": [
    echo     {
    echo       "name": "Canon B&W Printer",
    echo       "ipAddress": "192.168.1.80",
    echo       "port": 9100,
    echo       "protocol": "raw",
    echo       "type": "bw"
    echo     },
    echo     {
    echo       "name": "HP Color Printer",
    echo       "ipAddress": "192.168.1.244",
    echo       "port": 631,
    echo       "protocol": "ipp",
    echo       "type": "color"
    echo     }
    echo   ]
    echo }
  ) > config.json
  echo ✅ Created config.json!
)

echo.
echo 🔍 Checking dependencies...
if not exist node_modules (
  echo 📦 Installing required print modules (axios, socket.io-client, ipp)...
  call npm install axios socket.io-client ipp --no-audit --no-fund
  if %errorlevel% neq 0 (
    color 0C
    echo ❌ Failed to install dependencies. Please check your internet connection.
    pause
    exit /b
  )
)

echo.
echo ⚡ DIRECT SILENT PRINT ACTIVE! Starting print engine...
echo ========================================================
echo.

if exist agent.js (
  node agent.js
) else if exist direct-agent.js (
  node direct-agent.js
) else (
  color 0C
  echo ❌ Error: agent.js file not found in this folder!
)

echo.
echo --------------------------------------------------------
echo ⚠️ Agent process stopped.
pause
