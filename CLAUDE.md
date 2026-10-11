# Sistema de Acopio y Producción de Queso — Huata, Puno

Sistema para una quesería (quesos paria, pasteurizado y fresco; yogurt de temporada) que recolecta
leche en rutas rurales SIN internet. Idioma de la interfaz, mensajes y comentarios: español.

## Componentes y stack (no cambiar sin avisar)
| Carpeta    | Qué es                                   | Tecnología |
|------------|------------------------------------------|------------|
| `db/`      | Esquema, datos de prueba, pruebas SQL    | PostgreSQL 14+ |
| `backend/` | API REST + sincronización + PDFs         | Python 3.11, FastAPI, SQLAlchemy (solo consultas; sin migraciones que cambien reglas), psycopg, ReportLab |
| `web/`     | Panel del administrador                  | React + Vite + TypeScript, Recharts, Leaflet/OpenStreetMap |
| `mobile/`  | App Android única con 2 roles            | Kotlin, Jetpack Compose, Room, WorkManager, Android Keystore |

## Regla de oro
**La base de datos manda.** Todas las reglas de negocio (sanciones, bloqueo, precios, retención de pagos,
stock, saldos, cierre de lotes, alertas) viven en `db/schema.sql` como triggers/vistas/constraints.
El backend NO las duplica: inserta, consulta las vistas y traduce los errores de la base a mensajes claros.
Si una fase requiere cambiar el esquema: detente, explica el cambio y espera aprobación; luego corre
`db/tests/escenarios.sql` completo.

## Roles
- **admin** (web, correo + contraseña): gestiona todo.
- **acopiador** (móvil, PIN): solo registra recolecciones de productores de SU ruta (`de_ruta`), ve su día.
- **analista** (móvil, PIN): revisa recolecciones (por defecto normal; puede marcar alterado con análisis),
  registra productores `externo`.
- Móvil: el celular se vincula UNA vez con un código que genera el admin; después entra solo con PIN.
  Un solo celular activo por usuario.

## Reglas de negocio clave
- Precio de leche al productor: normal 1.70 S/L; sanción 0.70 S/L (el admin cambia precios con historial `precio_leche`).
- Leche alterada: se descarta. Se paga a precio normal por defecto (`pagar_leche_alterada=true`).
- Al marcarse alterada el día D (hora del servidor): sanción de precio D+1..D+7. Reincidencia (durante la
  sanción o hasta 7 días después) → BLOQUEO D+1..D+7 (la semana se reinicia). Después vuelve al precio normal.
- Productor bloqueado en la app del acopiador: aviso rojo "Productor bloqueado, no debe entregar leche".
  Si el acopiador confirma que la recibió, la registra igual; la base crea la alerta `productor_bloqueado`
  y retiene el pago hasta que el admin revise la alerta. La app NUNCA impide el registro.
- Alterada exige su análisis (ph/temperatura/grasa/densidad/antibióticos o foto).
- Solo se usa y se paga leche YA revisada por el analista. Leche de productor bloqueado, no aprobado
  (alta en campo) o con firma inválida: se registra pero su pago queda RETENIDO hasta decisión del admin.
- Productores se pagan por liquidación semanal; acopiadores por mes (base + comisión por litro normal).
- Ventas solo al contado. Un lote cerrado no se altera. Leche se maneja por jornada (perecible).
- GPS: SIEMPRE se guarda, NUNCA bloquea el registro. El servidor genera alertas.
- Quesos se calculan por UNIDAD; yogurt por KILO.
- Zona horaria de negocio: America/Lima. Moneda: soles (S/), 2 decimales.

## Offline-first (móvil)
- IDs de recolección = UUID generado en el celular. Sincronización idempotente
  (`INSERT ... ON CONFLICT DO NOTHING`). Pull incremental con `actualizado_en`.
- Productores creados en el campo llevan `uuid_cliente`; se suben ANTES que sus recolecciones.
- Cada recolección: hora del celular, GPS (+precisión, ubicación simulada, hora GPS, hora automática),
  firma con clave del Keystore y `hash_anterior` (cadena). Sin GPS se registra igual con `origen_ubicacion='ninguna'`.
- La API debe ejecutar `SET LOCAL app.usuario_id = '<id>'` en cada transacción (auditoría).

## Datos pendientes del cliente (usar valores de ejemplo, claramente marcados `-- EJEMPLO`)
Días de vida útil por queso, rendimiento por 100 L, insumos y costos reales, sueldos/comisión de acopiadores,
corte semanal de pago, rutas y productores reales. Todo se edita desde el panel admin; nada hardcodeado.

## Forma de trabajar
- Una fase a la vez; cada fase termina con pruebas que pasan y un resumen corto de qué quedó hecho.
- Entorno del desarrollador: Windows + PowerShell. Scripts de `db/` y raíz en PowerShell (`.ps1`).
- No inventes campos ni tablas: si falta algo en el esquema, pregunta.
- Secretos en `.env` (nunca en git). Incluye `.env.example`.
- Interfaz minimalista, clara, pensada para uso en campo (botones grandes en el móvil).
