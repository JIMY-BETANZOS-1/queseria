# Pruebas del panel web: revisión de tipos (tsc) y pruebas (Vitest). No necesita la API ni la base.
# Uso: .\web\scripts\test.ps1 [argumentos extra para vitest, p. ej. src/App.test.tsx]
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_node.ps1"

Push-Location $script:Web
# npm y Vitest escriben en stderr (por ejemplo, las pruebas que fallan); con 'Stop', PowerShell 5.1 cortaría
# el script en la primera línea sin mostrar el resto. El resultado se decide por $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
try {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { Write-Error 'Falló la revisión de tipos (tsc).'; exit 1 }
    npm test -- @args
    $codigo = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $codigo
