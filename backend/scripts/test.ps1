# Recrea la base "queseria_test" con schema.sql + seed.sql y corre las pruebas del backend.
# Uso: .\backend\scripts\test.ps1 [argumentos extra para pytest, p. ej. -k rutas]
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_venv.ps1"

$crearBd = Join-Path $script:Backend '..\db\scripts\crear-bd.ps1'
& $crearBd -Base queseria_test
if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo preparar la base de pruebas.'; exit 1 }

Push-Location $script:Backend
try {
    & $script:Python -m pytest @args
    $codigo = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $codigo
