# Recrea la base temporal "queseria_test", carga db/schema.sql y ejecuta db/tests/escenarios.sql.
# Muestra los casos que fallan y el total PASS/FAIL. Sale con código 1 si hay fallas.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_env.ps1"

$Base = 'queseria_test'
$dirDb = Join-Path $script:Raiz 'db'
$schema = Join-Path $dirDb 'schema.sql'
$escenarios = Join-Path $dirDb 'tests\escenarios.sql'

Write-Host "Recreando base '$Base' ..." -ForegroundColor Cyan
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS `"$Base`" WITH (FORCE);"
if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo borrar la base de pruebas.'; exit 1 }
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE `"$Base`" ENCODING 'UTF8' TEMPLATE template0;"
if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo crear la base de pruebas.'; exit 1 }

psql -X -q -v ON_ERROR_STOP=1 -d $Base -f $schema
if ($LASTEXITCODE -ne 0) { Write-Error 'Error al cargar schema.sql'; exit 1 }

Write-Host 'Ejecutando escenarios.sql ...' -ForegroundColor Cyan
# escenarios.sql maneja sus propios errores (ON_ERROR_STOP off) y termina con: pass | fail
# En PowerShell 5.1, stderr redirigido con 'Stop' aborta el script: se relaja solo aquí.
$ErrorActionPreference = 'Continue'
$salida = psql -X -d $Base -f $escenarios 2>&1 | ForEach-Object { "$_" }
$ErrorActionPreference = 'Stop'
$salida | Write-Host

$resumen = $salida | Where-Object { $_ -match '^\s*(\d+)\s*\|\s*(\d+)\s*$' } | Select-Object -Last 1
if (-not $resumen) {
    Write-Host 'No se encontró el resumen PASS/FAIL en la salida.' -ForegroundColor Red
    exit 1
}
$null = $resumen -match '^\s*(\d+)\s*\|\s*(\d+)\s*$'
$pass = [int]$Matches[1]; $fail = [int]$Matches[2]

$color = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "`nResultado: $pass PASS, $fail FAIL" -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
