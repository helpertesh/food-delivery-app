# Start ngrok tunnel to local API (port 3000). Run from backend folder:
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-ngrok.ps1
# Requires: node server.js on 3000, and `ngrok config add-authtoken` once (use same ngrok.exe or any v3.20+).

$ErrorActionPreference = "Stop"
$backendRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $backendRoot "server.js"))) {
    Write-Error "Could not find backend/server.js next to scripts folder."
    exit 1
}

$localNgrok = Join-Path $backendRoot "tools\ngrok-win\ngrok.exe"
$wingetNgrok = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"

function Test-NgrokAgentOk([string] $exePath) {
    if (-not (Test-Path $exePath)) { return $false }
    $raw = & $exePath version 2>&1 | Out-String
    if ($raw -match 'version\s+(\d+)\.(\d+)') {
        $maj = [int]$Matches[1]
        $min = [int]$Matches[2]
        return ($maj -gt 3) -or ($maj -eq 3 -and $min -ge 20)
    }
    return $false
}

$ngrok = $null
if ((Test-Path $localNgrok) -and (Test-NgrokAgentOk $localNgrok)) {
    $ngrok = $localNgrok
}
elseif ((Test-Path $wingetNgrok) -and (Test-NgrokAgentOk $wingetNgrok)) {
    $ngrok = $wingetNgrok
}

if (-not $ngrok) {
    $wingetTooOld = (Test-Path $wingetNgrok) -and -not (Test-NgrokAgentOk $wingetNgrok)
    Write-Host ""
    Write-Host "ERR_NGROK_121 fix: ngrok must be v3.20.0 or newer. WinGet often installs 3.3.1 (too old)." -ForegroundColor Yellow
    if ($wingetTooOld) {
        Write-Host "Your WinGet ngrok is outdated — do not use it for tunnels." -ForegroundColor Yellow
    }
    Write-Host @"

Do this:
  1. Open https://ngrok.com/download
  2. Download Windows (64-bit) zip
  3. Extract ngrok.exe into this folder (create folder if needed):
     $localNgrok
  4. Run this script again.

Optional: add authtoken using the NEW exe (once):
     & `"$localNgrok`" config add-authtoken YOUR_TOKEN
"@
    Write-Host ""
    exit 1
}

Write-Host "Using: $ngrok"
& $ngrok version
& $ngrok http 3000 @args
