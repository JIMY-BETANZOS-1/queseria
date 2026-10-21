# Datos de demostración: corre scripts\demo\cargar_demo.py contra la base queseria (todos sus datos son ficticios).
# Exige un respaldo de pg_dump -Fc de queseria hecho en los últimos 10 minutos (nunca usa crear-bd.ps1).
# Uso: .\backend\scripts\demo\cargar-demo.ps1 -Dump .\respaldos\queseria-AAAAMMDD-HHMM.dump -ConfirmoDatosFicticios -Fase listar
#      .\backend\scripts\demo\cargar-demo.ps1 -Dump .\respaldos\queseria-AAAAMMDD-HHMM.dump -ConfirmoDatosFicticios -Fase todo
param(
    [Parameter(Mandatory = $true)][string]$Dump,
    [switch]$ConfirmoDatosFicticios,
    [ValidateSet('listar', 'todo')][string]$Fase = 'listar'
)
$ErrorActionPreference = 'Stop'
$backend = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$python = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { Write-Error 'Falta backend\.venv (corre antes backend\scripts\dev.ps1 una vez).'; exit 1 }
$argumentos = @('--base', 'queseria', '--dump', (Resolve-Path $Dump).Path, '--fase', $Fase)
if ($ConfirmoDatosFicticios) { $argumentos += '--confirmo-datos-ficticios' }
Push-Location $backend
try {
    & $python (Join-Path $PSScriptRoot 'cargar_demo.py') @argumentos
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
