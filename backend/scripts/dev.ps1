# Levanta la API en modo desarrollo (recarga automática) en http://localhost:8000  (docs en /docs)
# Uso: .\backend\scripts\dev.ps1 [-Puerto 8000]
param([int]$Puerto = 8000)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_venv.ps1"

$archivoEnv = Join-Path $script:Backend '..\.env'
if (-not (Test-Path $archivoEnv)) {
    Write-Error 'No existe .env en la raíz. Copia .env.example a .env y completa los valores.'
    exit 1
}
if (-not (Select-String -Path $archivoEnv -Pattern '^\s*JWT_SECRET\s*=\s*\S{16,}' -Quiet)) {
    Write-Error 'Falta JWT_SECRET (16+ caracteres) en .env. Ver .env.example.'
    exit 1
}

Push-Location $script:Backend
try {
    & $script:Python -m uvicorn app.main:app --reload --host 0.0.0.0 --port $Puerto
} finally {
    Pop-Location
}
