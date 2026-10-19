# Web: panel del administrador (React + Vite + TypeScript)

Reemplaza el uso de `/docs` (Swagger) para el trabajo diario del admin. Llama directo a la API del
backend; las reglas de negocio las aplica la base (ver `CLAUDE.md`).

## Requisitos
- Node.js **22.12 o superior** (Vite 8). npm 10.
- La API corriendo: `.\backend\scripts\dev.ps1` (127.0.0.1:8000).
- El origen del panel, `http://localhost:5173`, en `CORS_ORIGENES` del `.env` de la raíz (ya viene así en `.env.example`).

## Instalar dependencias
Versiones exactas en `package.json` y `package-lock.json`. Los scripts **no instalan nada**: si faltan las
dependencias o cambió `package-lock.json`, se detienen y piden ejecutar a mano, en `web\`:
```powershell
npm ci --ignore-scripts
```
`web\.npmrc` fija `legacy-peer-deps=true`: npm 10.9 se cae (`Cannot read properties of null (reading
'edgesOut')`) al resolver las dependencias peer opcionales de Vitest 5. Las peer que usa el proyecto están
fijadas a mano en `package.json`, así que no se pierde nada.

## Correr y probar
```powershell
Copy-Item web\.env.example web\.env.local   # opcional: VITE_API_URL (por defecto http://127.0.0.1:8000)
.\web\scripts\dev.ps1     # http://localhost:5173 (puerto fijo: si está ocupado, falla)
.\web\scripts\test.ps1    # tsc --noEmit + Vitest (no necesita la API ni la base)
.\web\scripts\tipos.ps1   # regenera src\api\esquema.d.ts desde el OpenAPI del backend
```
`tipos.ps1` no necesita la API levantada: importa la app del backend para obtener su OpenAPI (sin conectarse
a la base). Se corre cada vez que cambia un endpoint o un modelo del backend; `esquema.d.ts` se commitea y
así `tsc` avisa si la web usa un campo que la API ya no tiene.

`VITE_API_URL` no es secreto: todo lo `VITE_*` queda dentro del JavaScript que recibe el navegador.
