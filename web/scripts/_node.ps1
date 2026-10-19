# Comprueba Node y que las dependencias de web\ estén instaladas y al día con package-lock.json.
# NO instala nada: si faltan o están desactualizadas, se detiene e indica el comando (npm ci) para que
# lo ejecute quien corresponda.
# Uso: . "$PSScriptRoot\_node.ps1"   -> deja $script:Web apuntando a la carpeta web\
$script:Web = Resolve-Path (Join-Path $PSScriptRoot '..')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'No se encontró Node.js en el PATH. Se necesita Node 22.12 o superior.'
    exit 1
}
$versionNode = [version]((node --version).TrimStart('v'))
if ($versionNode -lt [version]'22.12.0') {
    Write-Error "Node $versionNode es muy antiguo para Vite 8. Se necesita Node 22.12 o superior."
    exit 1
}

$lock = Join-Path $script:Web 'package-lock.json'
$instalado = Join-Path $script:Web 'node_modules\.package-lock.json'   # lo escribe npm al instalar
if (-not (Test-Path $instalado)) {
    Write-Error "Faltan las dependencias de web\. Ejecute en $($script:Web):  npm ci"
    exit 1
}
if ((Test-Path $lock) -and (Get-Item $lock).LastWriteTimeUtc -gt (Get-Item $instalado).LastWriteTimeUtc) {
    Write-Error "package-lock.json cambió desde la última instalación. Ejecute en $($script:Web):  npm ci"
    exit 1
}
