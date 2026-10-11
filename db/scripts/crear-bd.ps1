# Borra y crea la base "queseria" y carga db/schema.sql (y db/seed.sql si existe).
# Conexión: PGHOST, PGPORT, PGUSER, PGPASSWORD desde .env
param([string]$Base = 'queseria')

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_env.ps1"

$dirDb = Join-Path $script:Raiz 'db'
$schema = Join-Path $dirDb 'schema.sql'
$seed = Join-Path $dirDb 'seed.sql'

Write-Host "Recreando base '$Base' en $env:PGHOST`:$env:PGPORT ..." -ForegroundColor Cyan
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS `"$Base`" WITH (FORCE);"
if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo borrar la base.'; exit 1 }
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE `"$Base`" ENCODING 'UTF8' TEMPLATE template0;"
if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo crear la base.'; exit 1 }

Write-Host 'Cargando schema.sql ...' -ForegroundColor Cyan
psql -X -q -v ON_ERROR_STOP=1 -d $Base -f $schema
if ($LASTEXITCODE -ne 0) { Write-Error 'Error al cargar schema.sql'; exit 1 }

if (Test-Path $seed) {
    Write-Host 'Cargando seed.sql ...' -ForegroundColor Cyan
    psql -X -q -v ON_ERROR_STOP=1 -d $Base -f $seed
    if ($LASTEXITCODE -ne 0) { Write-Error 'Error al cargar seed.sql'; exit 1 }
}

Write-Host "Base '$Base' lista." -ForegroundColor Green
