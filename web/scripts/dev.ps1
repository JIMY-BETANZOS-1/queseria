# Levanta el panel web en modo desarrollo: http://localhost:5173
# Uso: .\web\scripts\dev.ps1
# La API se levanta aparte con .\backend\scripts\dev.ps1 (127.0.0.1:8000).
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_node.ps1"

if (-not (Test-Path (Join-Path $script:Web '.env.local'))) {
    Write-Warning 'No existe web\.env.local: se usa VITE_API_URL=http://127.0.0.1:8000. Ver web\.env.example.'
}

Push-Location $script:Web
# Vite puede escribir avisos en stderr; con 'Stop', PowerShell 5.1 detendría el servidor
$ErrorActionPreference = 'Continue'
try {
    npm run dev
} finally {
    Pop-Location
}
