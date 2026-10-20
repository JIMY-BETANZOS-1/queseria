# Backend: API REST (Python 3.11 + FastAPI)

API del sistema de acopio. **La base de datos manda**: las reglas de negocio están en `db/schema.sql`;
la API inserta, consulta las vistas y traduce los errores de la base a mensajes claros en español.

## Requisitos
- Python 3.11 (el script usa el lanzador `py`; si no hay 3.11 usa la versión instalada y avisa).
- PostgreSQL 14+ con `psql` en el PATH y la base creada con `db\scripts\crear-bd.ps1`.
- `.env` en la raíz del proyecto (copiar `.env.example`): variables `PG*`, `PGDATABASE` y `JWT_SECRET`.

## Correr
```powershell
.\backend\scripts\dev.ps1            # crea backend\.venv, instala dependencias y levanta en :8000
.\backend\scripts\dev.ps1 -Puerto 8080
```
Documentación interactiva: http://localhost:8000/docs · Estado: `GET /salud`.

## Probar
```powershell
.\backend\scripts\test.ps1           # recrea queseria_test (schema + seed) y corre pytest
.\backend\scripts\test.ps1 -k rutas  # argumentos extra van a pytest
```
Las pruebas usan el admin del seed (`db/seed.sql`) y crean sus propios usuarios, rutas y productores con
datos únicos, así que pueden repetirse sobre la misma base.

`test.ps1` **recrea** `queseria_test` (llama a `db\scripts\crear-bd.ps1`). Si esa base ya existe y no se
quiere recrear, se puede correr pytest directo, desde `backend\`:
```powershell
.\.venv\Scripts\python.exe -m pytest
```

## Estructura
| Archivo | Qué hace |
|---|---|
| `app/main.py` | App, CORS (ver abajo), manejadores de error, routers, `/salud` |
| `app/config.py` | Configuración desde `.env` |
| `app/db.py` | Pool psycopg 3; `transaccion(usuario_id)` fija `app.usuario_id` (= `SET LOCAL`) para la auditoría |
| `app/errores.py` | Traduce errores de la base: trigger (`P0001`) y unique → 409; check, FK, not null, formato → 422 |
| `app/seguridad.py` | bcrypt (contraseña y PIN), JWT, códigos de activación (se guarda solo su HMAC) |
| `app/firma.py` | Cadena canónica v1 y verificación ECDSA P-256 de las recolecciones |
| `app/deps.py` | Usuario actual (revisa en cada petición que usuario y celular sigan activos) y roles |
| `app/routers/` | Endpoints por módulo; `app/esquemas/` modelos pydantic |

Errores siempre con el formato `{"codigo": "...", "mensaje": "..."}` (los de validación agregan `errores: [{campo, mensaje}]`).

**CORS** (para el panel web, Bloque W1): solo los orígenes de `CORS_ORIGENES` en `.env`, los métodos
`GET`, `POST`, `PUT`, `PATCH` y `DELETE`, y las cabeceras `Authorization` y `Content-Type`. Sin credenciales
(cookies): el token viaja en la cabecera `Authorization`.

## Endpoints
**Autenticación**
- `POST /auth/admin/login` — correo + contraseña → JWT (dura `JWT_MINUTOS_ADMIN` del `.env`, 30 min por
  defecto; la respuesta trae `expira_en_min`). 10 intentos fallidos desde la misma IP en 10 min → 429
  `demasiados_intentos`, que se revisa antes que la contraseña. El conteo vive en la memoria del proceso: se
  reinicia al reiniciar la API.
- `POST /auth/dispositivo/activar` — código + `device_uuid` + `clave_publica` + **`pin`** (el usuario crea su PIN
  de 4 dígitos) → vincula el celular (desactiva el anterior) y devuelve el JWT: no hace falta otro login.
  PIN mal formado o trivial (`pin_trivial`) → 422 y el código **no** se gasta. Reactivar el mismo celular
  reutiliza su fila de `dispositivo` (mismo id) y reemplaza el PIN: así se recupera un PIN olvidado.
- `POST /auth/pin/login` — `device_uuid` + PIN de 4 dígitos → JWT (12 h). 5 PIN incorrectos → bloqueo de 15 min (423).
  Una entrada mal formada (422) no cuenta como intento. Sin PIN propio (puesto por el admin antes del Bloque 6)
  → 401 `debe_reactivar`, tampoco cuenta. `debe_cambiar_pin` siempre es `false` (se mantiene por compatibilidad).
- `POST /auth/pin/cambiar` — (móvil, sin pantalla en la app) PIN actual + nuevo; 422 `pin_repetido` / `pin_trivial`
  antes de verificar el actual.
- PIN trivial (`seguridad.pin_trivial`): todos iguales, secuencias, XYXY, XXYY y los últimos 4 del DNI o celular.

**Móvil** (contrato completo y cadena firmada en [`docs/sincronizacion.md`](../docs/sincronizacion.md))
- `POST /sync/push` — (acopiador, analista) productores de campo + recolecciones; resultado por ítem `creado|duplicado|rechazado`.
- `POST /sync/calidad` — (analista) revisiones: normal o alterado con análisis.
- `GET /sync/pull?desde=` — (acopiador, analista) cambios incrementales + estado de sanción y precios completos.
- `GET /acopiador/mi-dia` — (acopiador) litros y recolecciones de hoy.
- `GET /acopiador/ultimos-dias` — (acopiador) lo mismo para hoy y los 6 días anteriores, un elemento por día (hoy primero, incluidos los días sin entregas).
- `POST /analisis/{recoleccion_id}/foto` — (analista, admin) foto JPEG/PNG/WebP (máx. `FOTO_MAX_MB`); `GET` la devuelve.

**Admin** (todo requiere rol admin)
- Rutas: `GET/POST /rutas`, `GET/PATCH /rutas/{id}`, `PUT/DELETE /rutas/{id}/acopiador`, `GET /rutas/{id}/asignaciones`.
  Reasignar cierra la asignación vigente (`vigente_hasta = desde`) y abre la nueva desde esa fecha.
- Acopiadores: `GET/POST /acopiadores`, `GET/PATCH /acopiadores/{id}` (usuario + color, vehículo, sueldo, comisión). Sin PIN:
  nacen "pendientes de activar" (`pin_pendiente`).
- Analistas: `GET/POST /analistas`, `GET/PATCH /analistas/{id}`.
- Acceso móvil: `POST /usuarios/{id}/codigo-activacion` (un solo uso, se muestra una vez, vence en
  `CODIGO_ACTIVACION_MINUTOS` = 60; también sirve para recuperar un PIN olvidado o bloqueado),
  `GET /usuarios/{id}/dispositivos`, `POST /dispositivos/{id}/desactivar`.
- Productores: `GET /productores` (`v_productor_resumen`; filtros `tipo`, `ruta_id`, `pendiente`, `q`, `incluir_inactivos`),
  `GET /productores/observados` (`v_productor_observado`), `POST /productores`, `GET/PATCH /productores/{id}`,
  `POST /productores/{id}/aprobar`, `GET /productores/{id}/recolecciones` (`v_recoleccion_detalle`).
- Recolecciones: `GET /recolecciones` (`v_recoleccion_detalle`; filtros `desde`, `hasta`, `ruta_id`, `productor_id`,
  `registrado_por`, `incluir_anuladas`, `limit`, `offset`), `POST /recolecciones/{id}/anular` (`motivo`; nunca se borra).
- Alertas: `GET /alertas` (pendientes; `todas`, `tipo`, `recoleccion_id`), `POST /alertas/{id}/revisar` (`resolucion`).
  Revisar `productor_bloqueado` o `firma_invalida` libera la retención del pago (lo decide `v_recoleccion_pago`).
- Precio de la leche: `GET /precios-leche` (historial), `POST /precios-leche` (nueva vigencia; no se edita ni borra).
- Configuración: `GET /configuracion`, `PUT /configuracion/{clave}` (el valor conserva el formato del actual:
  entero, número, true/false, color).
