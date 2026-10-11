# Crea backend\.venv si no existe e instala requirements.txt cuando cambia.
# Uso: . "$PSScriptRoot\_venv.ps1"   -> deja $script:Python apuntando al python del entorno
$script:Backend = Resolve-Path (Join-Path $PSScriptRoot '..')
$venv = Join-Path $script:Backend '.venv'
$script:Python = Join-Path $venv 'Scripts\python.exe'
$requisitos = Join-Path $script:Backend 'requirements.txt'
$marca = Join-Path $venv '.requirements.sha256'

if (-not (Test-Path $script:Python)) {
    $versiones = (py -0p 2>$null) -join "`n"
    if ($versiones -match '3\.11') { $selector = '-3.11' }
    else {
        $selector = '-3'
        Write-Warning 'No se encontró Python 3.11 (versión del proyecto); se usa la versión instalada por defecto.'
    }
    Write-Host "Creando entorno virtual en $venv ..." -ForegroundColor Cyan
    py $selector -m venv $venv
    if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo crear el entorno virtual.'; exit 1 }
}

$hash = (Get-FileHash $requisitos -Algorithm SHA256).Hash
if (-not (Test-Path $marca) -or (Get-Content $marca) -ne $hash) {
    Write-Host 'Instalando dependencias ...' -ForegroundColor Cyan
    & $script:Python -m pip install --disable-pip-version-check -q -r $requisitos
    if ($LASTEXITCODE -ne 0) { Write-Error 'Falló la instalación de dependencias.'; exit 1 }
    Set-Content -Path $marca -Value $hash -Encoding ascii
}
