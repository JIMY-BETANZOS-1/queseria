# Pendiente: historial "Últimos días" del acopiador

Estado: **propuesta, no implementada**. Se hará en el siguiente bloque, **con backend**.

## Situación actual
- `GET /acopiador/mi-dia` **no admite fecha**: `backend/app/routers/acopiador.py` toma
  `SELECT {HOY_LIMA}` y filtra `v_recoleccion_detalle` por `registrado_por` y esa fecha. No recibe
  parámetros.
- El celular conserva 7 días de recolecciones ya confirmadas (`MotorSync.DIAS_CONSERVAR_MS`) y todas las
  pendientes y rechazadas. Pero Room no guarda `estado_calidad` ni `revisada`, y no tiene lo registrado
  en otro celular ni antes de una reinstalación.

## Decisión
**No se hace una versión solo con datos locales.** Daría totales "según este celular" que pueden no
coincidir con los del servidor (reinstalación, anuladas, revisión del analista), y en campo dos cifras
distintas para el mismo día confunden más de lo que ayudan. Se hace directamente con backend:

`GET /acopiador/mi-dia?fecha=AAAA-MM-DD`
- `fecha` opcional; sin ella, hoy en hora de Lima (comportamiento actual, compatible con la app 0.5.0).
- Limitada a los últimos 14 días (`fecha` entre hoy − 13 y hoy); fuera de rango → 422 con mensaje claro.
- Misma consulta a `v_recoleccion_detalle`, mismo `MiDia` de respuesta. **No toca el esquema** ni
  duplica reglas: solo cambia el filtro de fecha.
- Prueba nueva en `backend/tests/test_sync_pull.py`: con fecha de ayer devuelve lo de ayer; fuera de
  rango, 422; otro rol, 403.

Requiere aprobación porque toca `backend/` (CLAUDE.md: una fase a la vez).

## Pantalla propuesta (B6b "Últimos días")
- Se entra desde B6 ("Ver días anteriores ›").
- Lista de los últimos 7 días, hoy arriba. Cada fila, grande y en negrita:
  **Vie 16 oct · 142.00 L · 8 entregas**, con marca "1 sin enviar" (ámbar) o "1 rechazada" (rojo) si
  el celular todavía tiene algo de ese día en la cola o rechazado.
- Tocar una fila abre B6 para esa fecha (`MiDiaPantalla` / `LineasMiDia` con un parámetro de fecha):
  lo del servidor más lo pendiente de Room de ese día, igual que hoy.
- Sin señal: se muestra "Sin conexión: no se pueden ver días anteriores" y lo pendiente de Room, sin
  inventar totales.
- Un solo pedido por fila al abrirla (no 7 pedidos al entrar); si se quiere el total de cada fila en la
  lista, mejor un endpoint de resumen por día (`/acopiador/ultimos-dias`) a decidir en ese bloque.
