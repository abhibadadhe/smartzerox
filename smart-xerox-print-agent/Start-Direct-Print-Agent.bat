@echo off
title Smart Xerox Direct Silent Auto-Print Engine
color 0A
cls

cd /d "%~dp0"

echo ========================================================
echo   🤖 SMART XEROX DIRECT SILENT AUTO-PRINT AGENT
echo ========================================================
echo.

:: Launch via PowerShell engine (works 100%% with installed Node)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; try { if (-not (Test-Path 'node_modules')) { Write-Host '📦 Installing dependencies...' -ForegroundColor Yellow; npm install axios socket.io-client ipp --no-audit --no-fund }; Write-Host '⚡ Launching Print Agent...' -ForegroundColor Green; node agent.js } catch { Write-Host '⚠️ Error: ' $_.Exception.Message -ForegroundColor Red; Read-Host 'Press Enter to close...' }"

pause
