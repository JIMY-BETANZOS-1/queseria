# Regenera web\src\api\esquema.d.ts con los tipos de la API, a partir de su OpenAPI.
# No hace falta tener la API levantada: el OpenAPI se obtiene importando la app del backend
# (no abre conexión a la base). Correr cada vez que cambie un endpoint o un modelo del backend.
# Uso: .\web\scripts\tipos.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_node.ps1"
. "$PSScriptRoot\..\..\backend\scripts\_venv.ps1"

$json = Join-Path ([System.IO.Path]::GetTempPath()) 'queseria-openapi.json'
Push-Location $script:Backend
try {
    & $script:Python -c "import json, sys; from app.main import app; json.dump(app.openapi(), open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)" $json
    if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo obtener el OpenAPI del backend (¿existe .env con JWT_SECRET?).'; exit 1 }
} finally {
    Pop-Location
}

Push-Location $script:Web
try {
    & (Join-Path $script:Web 'node_modules\.bin\openapi-typescript.cmd') $json -o 'src/api/esquema.d.ts'
    if ($LASTEXITCODE -ne 0) { Write-Error 'Falló openapi-typescript.'; exit 1 }
} finally {
    Pop-Location
    Remove-Item $json -ErrorAction SilentlyContinue
}
Write-Host 'Tipos actualizados: web\src\api\esquema.d.ts' -ForegroundColor Green
