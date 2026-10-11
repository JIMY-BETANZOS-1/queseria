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
