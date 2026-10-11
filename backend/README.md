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
Las pruebas usan los datos del seed (`admin@queseria.test` / `Admin2026!`) y crean sus propios usuarios,
rutas y productores con datos únicos.

## Estructura
| Archivo | Qué hace |
|---|---|
| `app/main.py` | App, CORS, manejadores de error, routers, `/salud` |
| `app/config.py` | Configuración desde `.env` |
| `app/db.py` | Pool psycopg 3; `transaccion(usuario_id)` fija `app.usuario_id` (= `SET LOCAL`) para la auditoría |
| `app/errores.py` | Traduce errores de la base: trigger (`P0001`) y unique → 409; check, FK, not null, formato → 422 |
| `app/seguridad.py` | bcrypt (contraseña y PIN), JWT, códigos de activación (se guarda solo su HMAC) |
| `app/deps.py` | Usuario actual (revisa en cada petición que usuario y celular sigan activos) y roles |
| `app/routers/` | Endpoints por módulo; `app/esquemas/` modelos pydantic |

Errores siempre con el formato `{"codigo": "...", "mensaje": "..."}` (los de validación agregan `errores: [{campo, mensaje}]`).

## Endpoints
**Autenticación**
- `POST /auth/admin/login` — correo + contraseña → JWT (30 min).
- `POST /auth/dispositivo/activar` — código + `device_uuid` + `clave_publica` → vincula el celular (desactiva el anterior).
- `POST /auth/pin/login` — `device_uuid` + PIN → JWT (12 h). 5 PIN incorrectos → bloqueo de 15 min (423).
  `debe_cambiar_pin` = el PIN lo puso el admin.
- `POST /auth/pin/cambiar` — (móvil) PIN actual + nuevo.

**Admin** (todo requiere rol admin)
- Rutas: `GET/POST /rutas`, `GET/PATCH /rutas/{id}`, `PUT/DELETE /rutas/{id}/acopiador`, `GET /rutas/{id}/asignaciones`.
  Reasignar cierra la asignación vigente (`vigente_hasta = desde`) y abre la nueva desde esa fecha.
- Acopiadores: `GET/POST /acopiadores`, `GET/PATCH /acopiadores/{id}` (usuario + color, vehículo, sueldo, comisión; PIN inicial).
- Analistas: `GET/POST /analistas`, `GET/PATCH /analistas/{id}`.
- Acceso móvil: `POST /usuarios/{id}/codigo-activacion` (el código se muestra una vez, vence en 24 h),
  `POST /usuarios/{id}/pin` (restablecer y desbloquear), `GET /usuarios/{id}/dispositivos`, `POST /dispositivos/{id}/desactivar`.
- Productores: `GET /productores` (`v_productor_resumen`; filtros `tipo`, `ruta_id`, `pendiente`, `q`, `incluir_inactivos`),
  `GET /productores/observados` (`v_productor_observado`), `POST /productores`, `GET/PATCH /productores/{id}`,
  `POST /productores/{id}/aprobar`, `GET /productores/{id}/recolecciones` (`v_recoleccion_detalle`).
- Recolecciones: `GET /recolecciones` (`v_recoleccion_detalle`; filtros `desde`, `hasta`, `ruta_id`, `productor_id`,
  `registrado_por`, `incluir_anuladas`, `limit`, `offset`).
- Precio de la leche: `GET /precios-leche` (historial), `POST /precios-leche` (nueva vigencia; no se edita ni borra).
- Configuración: `GET /configuracion`, `PUT /configuracion/{clave}` (el valor conserva el formato del actual:
  entero, número, true/false, color).
