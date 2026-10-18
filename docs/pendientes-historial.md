# Historial "Últimos días" del acopiador

Estado: **implementado en el Bloque 7** (backend `GET /acopiador/ultimos-dias`, app 0.7.0). Probado en
el Realme con la 0.7.0: lista de 7 días, detalle de un día, sin señal y vuelta de la señal.

## Situación anterior
- `GET /acopiador/mi-dia` **no admite fecha**: solo hoy (`HOY_LIMA`), filtrado por `registrado_por`.
- El celular conserva 7 días de recolecciones ya confirmadas (`MotorSync.DIAS_CONSERVAR_MS`) y todas las
  pendientes y rechazadas. Pero Room no guarda `estado_calidad` ni `revisada`, y no tiene lo registrado
  en otro celular ni antes de una reinstalación.

## Decisiones
- **No hay totales armados solo con datos locales.** Darían cifras "según este celular" que pueden no
  coincidir con las del servidor (reinstalación, anuladas, revisión del analista), y en campo dos cifras
  distintas para el mismo día confunden más de lo que ayudan. Por eso se hizo con backend.
- **Un solo endpoint, `GET /acopiador/ultimos-dias`**, y no `mi-dia?fecha=` (la propuesta inicial). La
  lista necesita el total de cada día: con `mi-dia?fecha=` harían falta 7 llamadas o una lista sin
  totales, y un resumen por día obligaba a un segundo endpoint para el detalle. Este devuelve los 7 días
  con sus filas en **una consulta y una llamada**, sin parámetros que validar. `mi-dia` no cambió.
  Contrato en `docs/sincronizacion.md`, sección 6b.
- **Límite: 7 días fijos** (hoy y los 6 anteriores). Cubren la semana de liquidación y coinciden con lo
  que Room conserva de lo ya enviado. Si el cliente pide más, se sube `DIAS_HISTORIAL` (backend y app).
- **Un día = fecha en hora de Lima**, igual que `mi-dia`: las 23:30 de Lima son del día anterior aunque
  en UTC ya sea el siguiente.
- **Sin migración de Room**: el celular junta lo del servidor con lo que ya tenía (`MiDia.armarDia`).
- **Deduplicación por UUID**: lo pendiente en Room que el servidor ya tiene (la respuesta del envío se
  perdió) no se cuenta dos veces. También se aplica a "Mi día" de hoy.
- **Acceso solo desde B6** ("Ver días anteriores ›"). B3 no se tocó: ya está cargada y su tarjeta HOY
  abre B6.

## Pantallas (B6b "Últimos días" y detalle)
- Lista de 7 días, hoy arriba y resaltado. Cada fila: **"Hoy"** o **"vie 16 oct"** y, en grande,
  **"142.00 L · 8 entregas"** o "Sin entregas", con las marcas "N sin enviar" (ámbar) y "N rechazada(s)"
  (rojo) que salen de Room.
- Tocar "Hoy" abre B6 en vivo. Otro día abre el mismo detalle de B6, titulado "Día anterior"
  (`MiDiaPantalla` con fecha, `LineasMiDia`). Atrás: día anterior → B6b → B6 → B3.
- **Sin señal**:
  - B6b: aviso arriba; los días anteriores dicen "Sin conexión" en lugar del total (hoy conserva el del
    celular) y las marcas de lo pendiente siguen a la vista.
  - Detalle de un día anterior: solo lo sin enviar y lo rechazado de ese día, sin total, con el aviso
    "Sin conexión: solo se ve lo que este celular aún no envió. El total del día está en el servidor."
  - Sin sesión vigente (401) se trata igual que sin red: no rompe ni pide el PIN ahí.
- Si a medianoche el día abierto sale de la ventana de 7, se dice ("Ese día ya no está entre los últimos
  7 días.") en vez de mostrar otro.

## Pruebas
- Backend: `test_ultimos_dias` en `backend/tests/test_sync_pull.py`.
- App: `ArmarDiaTest`, `LineasUltimosDiasTest`, y los casos nuevos en `LineasMiDiaTest` y `RumboTest`.

> 2026-10-18: limpieza de datos de prueba, borrados P-0018 y P-0019 (altas de campo del 15-oct) con sus 2 recolecciones y 2 alertas.
