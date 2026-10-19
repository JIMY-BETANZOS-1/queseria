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

## Construir para producción
```powershell
$env:VITE_API_URL = 'https://api.ejemplo.pe'   # o en web\.env.local
npm run build                                  # en web\: tsc --noEmit + vite build -> web\dist\
```
Sin `VITE_API_URL` (o si no empieza con `http://` o `https://`) el build **falla** con un mensaje claro:
la dirección de la API es parte de la política de seguridad.

## Sesión del admin
- Token en `sessionStorage` (sobrevive a F5, se borra al cerrar la pestaña). Vence a los `JWT_MINUTOS_ADMIN`
  del `.env` menos 30 s; el panel se cierra solo a esa hora y muestra "Sesión hasta las HH:MM".
- Un 401 en cualquier pantalla cierra la sesión y lleva a Entrar con "Su sesión venció" y `?volver=` a la
  pantalla donde estaba (solo rutas internas: se rechazan `//`, `\`, `/\` y direcciones absolutas).
- "Salir" borra la sesión del navegador. El JWT no se revoca en el servidor: vence solo.

## Política de seguridad del contenido (CSP)
Solo en el build: `vite.config.ts` agrega al `index.html` una etiqueta
`<meta http-equiv="Content-Security-Policy">` con `default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
`connect-src` e `img-src` limitados a `'self'` y al origen de `VITE_API_URL`, `object-src 'none'`,
`base-uri 'none'` y `form-action 'self'`. En desarrollo no se pone porque Vite inyecta un script en línea.
Por eso el código no usa atributos `style` ni scripts en línea: todo va en `src/estilos.css`.

**Pendiente para el despliegue:** `frame-ancestors 'none'` (que nadie pueda mostrar el panel dentro de un
`<iframe>` ajeno) **solo vale como cabecera HTTP**: en `<meta>` el navegador lo ignora. El servidor que sirva
`web\dist\` debe enviar `Content-Security-Policy: frame-ancestors 'none'` (o `X-Frame-Options: DENY`).
Lo mismo conviene para la CSP completa, que como cabecera también protege antes de leer el HTML.
