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

:: Check standard PATH
where node >nul 2>nul
if %errorlevel% equ 0 goto node_ok

:: Check default Program Files
if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=%PATH%;C:\Program Files\nodejs"
  goto node_ok
)

:: Check x86 Program Files
if exist "C:\Program Files (x86)\nodejs\node.exe" (
  set "PATH=%PATH%;C:\Program Files (x86)\nodejs"
  goto node_ok
)

:: Check Local AppData
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
  set "PATH=%PATH%;%LOCALAPPDATA%\Programs\nodejs"
  goto node_ok
)

:node_missing
color 0C
echo.
echo ❌ ERROR: Node.js is NOT installed on this computer!
echo ----------------------------------------------------
echo To enable 100%% fully automated silent printing:
echo 1. Install Node.js (Takes 1 minute):
echo    👉 https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi
echo.
echo 2. OR open PowerShell and run:
echo    👉 winget install OpenJS.NodeJS.LTS
echo.
echo 3. After installing Node.js, run this file again!
echo ----------------------------------------------------
echo.
choice /m "Would you like to open the official Node.js installer download page now?"
if %errorlevel% equ 1 start https://nodejs.org/en/download
pause
exit /b

:node_ok
echo ✅ Node.js detected successfully!

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
