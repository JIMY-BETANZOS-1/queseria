# Base de demostración: corre scripts\demo\cargar_demo.py SOLO contra queseria_demo.
# La base queseria_demo se crea antes, a mano, desde un dump nuevo de queseria (ver docs; nunca con crear-bd.ps1).
# Uso: .\backend\scripts\demo\cargar-demo.ps1 -Fase listar   (no cambia nada)
#      .\backend\scripts\demo\cargar-demo.ps1 -Fase todo
param([ValidateSet('listar', 'todo')][string]$Fase = 'listar')
$ErrorActionPreference = 'Stop'
$backend = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$python = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { Write-Error 'Falta backend\.venv (corre antes backend\scripts\dev.ps1 una vez).'; exit 1 }
Push-Location $backend
try {
    & $python (Join-Path $PSScriptRoot 'cargar_demo.py') --base queseria_demo --fase $Fase
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
