# Pruebas del panel web: revisión de tipos (tsc) y pruebas (Vitest). No necesita la API ni la base.
# Uso: .\web\scripts\test.ps1 [argumentos extra para vitest, p. ej. src/App.test.tsx]
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_node.ps1"

Push-Location $script:Web
try {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { Write-Error 'Falló la revisión de tipos (tsc).'; exit 1 }
    npm test -- @args
    $codigo = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $codigo
