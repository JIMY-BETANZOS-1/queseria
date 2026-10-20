# Sistema de Acopio y Producción de Queso — Huata, Puno

Acopio de leche en rutas rurales sin internet, producción de quesos/yogurt, ventas y pagos.
Ver `CLAUDE.md` para reglas de negocio y stack.

## Estructura
| Carpeta    | Contenido |
|------------|-----------|
| `db/`      | `schema.sql`, `tests/escenarios.sql`, `scripts/` (PowerShell) |
| `backend/` | API REST (FastAPI) |
| `web/`     | Panel del administrador (React + Vite) |
| `mobile/`  | App Android (acopiador y analista) |
| `docs/`    | Documentación |

## Base de datos
Requisitos: PostgreSQL 14+ con `psql` en el PATH.

```powershell
Copy-Item .env.example .env      # y edita la contraseña
.\db\scripts\crear-bd.ps1        # borra y crea la base queseria
.\db\scripts\correr-pruebas.ps1  # crea queseria_test y ejecuta los escenarios
```
**Cuidado:** `crear-bd.ps1` **borra** la base `queseria` y la vuelve a crear con el seed. No lo corras sobre
una base que ya tiene datos de trabajo; lo mismo vale para `backend\scripts\test.ps1`, que recrea
`queseria_test` llamando a ese script.

## Correr en local
1. API: `.\backend\scripts\dev.ps1` (http://127.0.0.1:8000, documentación en `/docs`). Detalle en
   [`backend/README.md`](backend/README.md).
2. Panel del administrador: `.\web\scripts\dev.ps1` (http://localhost:5173). La primera vez hay que instalar
   sus dependencias a mano; detalle en [`web/README.md`](web/README.md).
3. App de campo: ver `mobile/`.

El panel web reemplaza el uso diario de `/docs` para el admin: usuarios móviles y sus celulares, rutas,
productores y altas de campo, alertas y recolecciones del día (Bloque W1). Lo que todavía no tiene se sigue
haciendo por `/docs`; el estado por pantalla está en [`docs/pantallas.md`](docs/pantallas.md).
