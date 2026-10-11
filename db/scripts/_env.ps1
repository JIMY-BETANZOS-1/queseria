# Carga variables PG* desde el archivo .env de la raíz del proyecto.
# Uso: . "$PSScriptRoot\_env.ps1"

$script:Raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$archivoEnv = Join-Path $script:Raiz '.env'

if (-not (Test-Path $archivoEnv)) {
    Write-Error "No existe $archivoEnv. Copia .env.example a .env y completa los valores."
    exit 1
}

foreach ($linea in Get-Content $archivoEnv) {
    $l = $linea.Trim()
    if ($l -eq '' -or $l.StartsWith('#')) { continue }
    $i = $l.IndexOf('=')
    if ($i -lt 1) { continue }
    $nombre = $l.Substring(0, $i).Trim()
    $valor = $l.Substring($i + 1).Trim().Trim('"').Trim("'")
    Set-Item -Path "env:$nombre" -Value $valor
}

foreach ($v in 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD') {
    if (-not (Test-Path "env:$v")) {
        Write-Error "Falta $v en .env"
        exit 1
    }
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Error "No se encontró psql en el PATH. Agrega la carpeta bin de PostgreSQL al PATH."
    exit 1
}

$env:PGCLIENTENCODING = 'UTF8'
