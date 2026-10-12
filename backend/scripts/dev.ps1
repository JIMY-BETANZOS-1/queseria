# Levanta la API en modo desarrollo (recarga automática).
# Uso: .\backend\scripts\dev.ps1 [-Puerto 8000] [-Lan]
#   -Lan  escucha en todas las interfaces (0.0.0.0) para que el celular en la red local pueda conectarse.
#         Sin -Lan solo acepta conexiones desde la misma PC (127.0.0.1).
param([int]$Puerto = 8000, [switch]$Lan)

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

$host_bind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
if ($Lan) { Write-Host "Escuchando en red local ($host_bind:$Puerto) — visible para otros equipos" }

Push-Location $script:Backend
try {
    & $script:Python -m uvicorn app.main:app --reload --host $host_bind --port $Puerto
} finally {
    Pop-Location
}
