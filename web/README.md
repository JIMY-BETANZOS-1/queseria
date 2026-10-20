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
fijadas a mano en `package.json`, así que no se pierde nada. **Pendiente:** al actualizar npm o Vitest,
probar sin esa línea (`npm install --dry-run`) y quitarla si ya no hace falta.

## Pantallas (Bloques W1 y W2)
| Pantalla | Qué permite |
|---|---|
| Entrar | Correo y contraseña del admin. |
| Acopiadores | Lista con su estado de acceso al celular; crear y editar (color, vehículo, sueldo, comisión); desactivar y reactivar; generar el código de activación (se muestra una sola vez); ver y desactivar celulares. |
| Analistas | Lo mismo, sin datos de acopiador. Aviso fijo: la app 0.7.0 todavía no tiene las pantallas del analista. |
| Rutas | Crear, editar, desactivar; asignar, cambiar o quitar el acopiador (fecha "Desde" entre el inicio de la asignación vigente y hoy en Lima) e historial de asignaciones. |
| Productores | Lista con las altas de campo pendientes primero; crear y editar (el tipo no se cambia); aprobar altas de campo; últimas 50 entregas con su estado de pago. |
| Alertas | Pendientes o todas, por tipo o por recolección; revisar con resolución obligatoria; marca "Retiene el pago". |
| Recolecciones del día | Un día en hora de Lima con resumen por persona y anular con motivo obligatorio. Cada alerta enlaza a su recolección. |
| Dashboard (W2) | Lo que requiere atención (con enlaces), la leche y el dinero del mes (flujo y resultado de la base) y un gráfico de los últimos 14 días en SVG, sin paquetes ni estilos en línea. |
| Calidad (W2) | Por revisar: el admin marca normales en lote o alterada con su análisis, mientras no exista la app del analista. |
| Leche de la jornada (W2) | Solo lectura por día: recolectada, descartada, por revisar, aprobada, en lotes, merma, disponible y costo por litro útil. |
| Pagos a productores (W2) | Por pagar, liquidar periodo (vista previa con lo que queda en espera), comprobante imprimible, marcar pagada y eliminar pendientes. |
| Pagos a acopiadores (W2) | Sueldo estimado del mes, registrar con ajustes, marcar pagado (registra el gasto "Sueldo acopiador"), editar o eliminar pendientes. |
| Gastos (W2) | Listar por rango con total por categoría y registrar (sin editar ni eliminar; "Sueldo acopiador" lo crea solo el pago mensual). |
| Configuración (W2) | Precio de la leche con historial (vigente y programado) y parámetros con cuándo se aplica cada uno. |

Todas las fechas y horas se muestran en hora de Lima, sin importar la zona horaria del PC.

## Lo que el panel no muestra (el backend no lo devuelve)
- **Quién revisó una alerta.** `GET /alertas` trae `revisada_por` solo como id, y no hay endpoint con los
  nombres de los administradores. El panel muestra el nombre solo si es el admin de la sesión; si no,
  "usuario n.º X".
- **Comprobante en PDF.** El de la liquidación se imprime con el navegador (el menú y los botones no salen); un PDF
  necesitaría ReportLab en el backend, que no está instalado.
- **Quién anuló una recolección y por qué.** La base guarda `anulada_por` y `motivo_anulacion`, pero
  `v_recoleccion_detalle` solo expone `anulada_en`: la fila anulada muestra solo la fecha. Propuesta en
  [`docs/pendiente-parche-002.md`](../docs/pendiente-parche-002.md).

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

## Verificaciones pendientes contra el backend real
Las pantallas de los pasos 5 a 9 ya se verificaron en el navegador y con el celular de pruebas. Queda:
- **Ciclo de activación con el celular de pruebas (paso 4, Acopiadores).** Ya verificado en el navegador:
  crear, 409 por DNI y por color repetidos, generar código, editar comisión, desactivar y reactivar. Falta,
  con el celular:
  1. activar en la app (B1) con el código que muestra la web y ver "Celular vinculado" y el modelo en la web;
  2. desactivar ese celular desde la web y comprobar que la app vuelve a "Vincular celular" sin perder lo que
     tenga sin enviar;
  3. generar otro código y reactivar el mismo celular;
  4. desactivar el acopiador de prueba ("PRUEBA W1 — Acopiador") al terminar: no se puede borrar.

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
