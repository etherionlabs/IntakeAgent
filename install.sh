#!/usr/bin/env bash
# Instalador de Intake para macOS / Linux.
#
# Uso (dentro de la carpeta del proyecto):
#   bash install.sh
#
# Hace:
#   1. Verifica Node.js >= 20.
#   2. Instala dependencias (npm install).
#   3. Ejecuta el setup interactivo (.env + base de datos).
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "=== Instalador de Intake ==="
echo ""

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "✖ Node.js no está instalado."
  echo "  Instálalo desde https://nodejs.org (versión 20 o superior) y vuelve a intentar."
  exit 1
fi
version_raw="$(node --version | sed 's/^v//')"
major="${version_raw%%.*}"
if [ "$major" -lt 20 ]; then
  echo "✖ Node.js $version_raw es demasiado antiguo. Se requiere 20 o superior."
  exit 1
fi
echo "• Node.js $version_raw detectado"

# 2. Dependencias
echo "• Instalando dependencias (esto puede tardar unos minutos)..."
npm install --include=dev

# 3. Setup interactivo
echo ""
npm run setup

echo ""
echo "=== Instalación completa ==="
echo "Para arrancar el asistente:  npm start"
echo ""
