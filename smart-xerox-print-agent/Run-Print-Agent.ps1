Set-Location $PSScriptRoot
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  🤖 SMART XEROX DIRECT SILENT AUTO-PRINT AGENT" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path 'node_modules')) {
    Write-Host "📦 Installing print dependencies..." -ForegroundColor Yellow
    npm install axios socket.io-client ipp --no-audit --no-fund
}

Write-Host "⚡ Starting Direct Print Engine..." -ForegroundColor Green
node agent.js
Read-Host "Press Enter to exit..."
