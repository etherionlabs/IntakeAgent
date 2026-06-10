# Instalador de Intake para Windows.
#
# Uso (PowerShell, dentro de la carpeta del proyecto):
#   .\install.ps1
#
# Hace:
#   1. Verifica Node.js >= 20.
#   2. Instala dependencias (npm install).
#   3. Ejecuta el setup interactivo (.env + base de datos).
#
# Si PowerShell bloquea el script, ejecútalo así:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "=== Instalador de Intake ===" -ForegroundColor Cyan
Write-Host ""

# 1. Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "✖ Node.js no está instalado." -ForegroundColor Red
  Write-Host "  Instálalo desde https://nodejs.org (versión 20 o superior) y vuelve a intentar."
  exit 1
}
$versionRaw = (& node --version).TrimStart('v')
$major = [int]($versionRaw.Split('.')[0])
if ($major -lt 20) {
  Write-Host "✖ Node.js $versionRaw es demasiado antiguo. Se requiere 20 o superior." -ForegroundColor Red
  exit 1
}
Write-Host "• Node.js $versionRaw detectado" -ForegroundColor Green

# 2. Dependencias
Write-Host "• Instalando dependencias (esto puede tardar unos minutos)..." -ForegroundColor Green
& npm install --include=dev
if ($LASTEXITCODE -ne 0) {
  Write-Host "✖ Falló npm install." -ForegroundColor Red
  exit 1
}

# 3. Setup interactivo
Write-Host ""
& npm run setup
if ($LASTEXITCODE -ne 0) {
  Write-Host "✖ Falló el setup." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== Instalación completa ===" -ForegroundColor Cyan
Write-Host "Para arrancar el asistente:  npm start" -ForegroundColor Yellow
Write-Host ""
