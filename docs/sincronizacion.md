# Sincronización offline (app móvil ⇄ API)

Contrato entre la app Android (acopiador y analista) y la API. Todas las rutas requieren el JWT
móvil (`POST /auth/pin/login`): de él salen el usuario, su rol y el celular (`dispositivo_id`).
Si el usuario o el celular se desactivan, la API responde 401.

Principios:
- **La base manda.** La API inserta y la base aplica las reglas con sus triggers: roles, alertas,
  sanciones y retención del pago.
- **Idempotente.** Reenviar un lote completo no duplica nada (`INSERT ... ON CONFLICT DO NOTHING`).
  Ante un corte de red, el celular reenvía todo lo que no tenga confirmado.
- **Un ítem rechazado no tumba el lote.** Cada ítem va en su propia transacción y recibe su resultado:
  `creado`, `duplicado` o `rechazado` + `motivo`.
- **La ubicación nunca rechaza.** Sin GPS o con datos raros, la recolección se guarda y el servidor crea las alertas.
- Las horas se envían en **ISO 8601 con zona horaria** (`2026-10-10T07:05:09.120Z` o `...-05:00`).

---

## 1. `POST /sync/push`: productores de campo y recolecciones

```json
{
  "productores": [
    {"uuid_cliente": "8f0c…", "nombre": "Juana Mamani", "documento": null, "celular": "951234567", "ruta_id": 3}
  ],
  "recolecciones": [
    {"id": "0b6f1c9e-…", "productor_uuid_cliente": "8f0c…", "litros": 23.5, "observacion": "Tarro azul",
     "registrada_en": "2026-10-10T07:05:09.120Z",
     "latitud": -15.614512, "longitud": -69.97231, "precision_m": 8.5, "origen_ubicacion": "gps",
     "ubicacion_simulada": false, "hora_gps": "2026-10-10T07:05:08.000Z", "hora_automatica": true,
     "hash_anterior": "e3b0…", "firma": "MEUCIQ…"}
  ]
}
```

**Orden:** primero se procesan los productores y luego las recolecciones. Una recolección puede
apuntar a un productor del mismo lote, o de un lote anterior, con `productor_uuid_cliente`, o a un
productor del servidor con `productor_id`. Debe ir uno de los dos, nunca ambos. Como máximo 500
productores y 500 recolecciones por lote.

**Productores**
- El `tipo` lo fija la API según el rol: acopiador → `de_ruta` (necesita `ruta_id`), analista →
  `externo` (necesita `documento` y `celular`, sin ruta).
- `creado_por` es el usuario del token. Los que da de alta un acopiador nacen **no aprobados**: su
  leche se recibe, pero el pago queda retenido hasta que el admin los apruebe.
- Si el `uuid_cliente` ya existe, la respuesta es `duplicado` y trae el `productor_id` y el `codigo` reales.

**Recolecciones**
- Lo pone el servidor, nunca el cliente: `registrado_por` (usuario del token), `dispositivo_id`
  (celular del token), `recibida_en` (hora del servidor) y la calidad. Nacen `normal` y sin revisar.
- Si el `id` ya existe y es del mismo usuario → `duplicado`. Si es de otro usuario → `rechazado`.
- Reglas de rol, aplicadas por el trigger: el acopiador solo registra productores `de_ruta` y el
  analista solo `externo`. Si no se cumplen → `rechazado` con el mensaje de la base.
- **Ubicación.** Se guarda tal cual cuando es válida. Si no:

  | Llega | Se guarda | Alerta (solo productores de ruta) |
  |---|---|---|
  | sin latitud o sin longitud, o fuera de rango | sin coordenadas, `origen='ninguna'` | `sin_ubicacion` |
  | coordenadas con `origen='ninguna'` | coordenadas, `origen='ultima_conocida'` | `ubicacion_imprecisa` |
  | coordenadas sin `origen_ubicacion` | `origen='gps'` | las normales |
  | `precision_m` negativa o > 999999.9 | `precision_m` nula | — |

  Además, la base crea `ubicacion_simulada`, `lejos_del_productor`, `velocidad_imposible`,
  `hora_inconsistente`, `litros_atipicos`, `posible_duplicado` y `productor_bloqueado`.
- **Productor bloqueado.** La recolección se guarda (la app solo avisa en rojo), la base crea la
  alerta `productor_bloqueado` y el pago queda retenido hasta que el admin la revise.

**Respuesta**

```json
{
  "productores":   [{"indice": 0, "uuid_cliente": "8f0c…", "estado": "creado", "motivo": null,
                     "productor_id": 120, "codigo": "P-0120"}],
  "recolecciones": [{"indice": 0, "id": "0b6f1c9e-…", "estado": "creado", "motivo": null,
                     "alertas": ["sin_ubicacion"]},
                    {"indice": 1, "id": "…", "estado": "rechazado",
                     "motivo": "Un acopiador solo registra productores de ruta", "alertas": []}],
  "servidor_ahora": "2026-10-10T07:10:00.000-05:00"
}
```

`alertas` lista las alertas que la base creó para esa recolección, para que el celular las muestre.
Un ítem mal formado (falta un campo o tiene un tipo inválido) se rechaza con un motivo como
`"Datos inválidos — litros: Campo obligatorio"`. Qué hace el celular según el estado:
- `creado` o `duplicado`: la marca como sincronizada.
- `rechazado`: la conserva y muestra el motivo.

---

## 2. Firma de cada recolección

El celular firma cada recolección con la clave privada del **Android Keystore**:
- Algoritmo: **ECDSA P-256 con SHA-256** (`Signature.getInstance("SHA256withECDSA")`).
- `firma` = la firma en DER (lo que devuelve `Signature.sign()`), en **base64 estándar** sin saltos
  de línea (`Base64.NO_WRAP`).
- `clave_publica`, que se envía una sola vez al vincular el celular (`/auth/dispositivo/activar`) =
  `publicKey.getEncoded()` (X.509 SubjectPublicKeyInfo, DER), en base64 estándar.

El servidor verifica con `dispositivo.clave_publica` del celular del token. **Si la firma falta o no
coincide, la recolección se guarda igual** y se crea la alerta `firma_invalida`, que retiene el pago
hasta que el admin la revise. El motivo queda en el detalle de la alerta.

### Cadena canónica `v1`

Son 14 campos separados por `|`, en este orden, codificados en UTF-8. **Se firma exactamente lo que
se envía en el JSON**: el servidor arma la cadena con los valores recibidos, antes de normalizar la ubicación.

| # | Campo | Formato |
|---|---|---|
| 1 | versión | literal `v1` |
| 2 | `id` | UUID en minúsculas con guiones |
| 3 | productor | `id:<productor_id>` o `uuid:<productor_uuid_cliente>` (UUID en minúsculas) |
| 4 | `litros` | 2 decimales, punto decimal, redondeo half-up: `23.50` |
| 5 | `registrada_en` | UTC, milisegundos truncados: `2026-10-10T07:05:09.120Z` |
| 6 | `latitud` | 6 decimales (half-up): `-15.614512` |
| 7 | `longitud` | 6 decimales (half-up): `-69.972310` |
| 8 | `precision_m` | 1 decimal (half-up): `8.5` |
| 9 | `origen_ubicacion` | `gps`, `ultima_conocida` o `ninguna` |
| 10 | `ubicacion_simulada` | `true` o `false` (si no se envía, cuenta como `false`) |
| 11 | `hora_gps` | igual que el campo 5 |
| 12 | `hora_automatica` | `true` o `false` |
| 13 | `observacion` | SHA-256 en hex minúsculas de su texto UTF-8 (exacto, **sin recortar espacios**) |
| 14 | `hash_anterior` | texto tal cual |

Cualquier campo nulo o ausente va como **cadena vacía**. Una observación vacía (`""`) también va vacía.

`hash_anterior` encadena los registros del mismo celular: es el **SHA-256 en hex minúsculas de la
`firma` (el texto base64, en ASCII) de la recolección anterior** de ese celular. En la primera
recolección va nulo o vacío.

**Ejemplo.** Es el mismo de la prueba `test_cadena_canonica_documentada`; Android debe producir esta
cadena exacta. Datos: `id=0b6f1c9e-3a52-4c1e-9d0a-5c3f6b2a7e11`, `productor_id=42`, `litros=23.5`,
`observacion="Tarro azul"`, `registrada_en=2026-10-10T07:05:09.120456Z`, `latitud=-15.6145123`,
`longitud=-69.97231`, `precision_m=8.46`, `origen=gps`, `simulada=false`, sin `hora_gps`,
`hora_automatica=true` y sin `hash_anterior`:

```
v1|0b6f1c9e-3a52-4c1e-9d0a-5c3f6b2a7e11|id:42|23.50|2026-10-10T07:05:09.120Z|-15.614512|-69.972310|8.5|gps|false||true|412e239b417a846a962cd5f1298859f8a08f3c43828820b957d8c62204ed9030|
```

Para evitar diferencias de redondeo, lo recomendable es que el celular guarde en Room los valores ya
formateados (2 o 6 decimales y la hora en milisegundos) y envíe en el JSON exactamente esos mismos valores.

En Kotlin:
```kotlin
val sig = Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey); update(cadena.toByteArray(Charsets.UTF_8)) }
val firma = Base64.encodeToString(sig.sign(), Base64.NO_WRAP)
val hashAnterior = sha256Hex(firmaAnterior.toByteArray(Charsets.US_ASCII))
```

Limitación: el servidor **no** comprueba la continuidad de la cadena, es decir, si faltan registros
intermedios. `hash_anterior` solo queda firmado y guardado como evidencia.

---

## 3. `POST /sync/calidad` (solo analista)

```json
{"revisiones": [
  {"recoleccion_id": "0b6f…"},
  {"recoleccion_id": "7a21…", "estado": "alterado", "ph": 6.1, "temperatura_c": 9.5, "grasa_pct": 3.2,
   "densidad": 1.028, "antibioticos_positivo": true}
]}
```

- `estado` por defecto es `normal`: confirma la revisión.
- `alterado` exige al menos una medición o la foto. Lo comprueba el trigger diferido al confirmar la
  transacción; si no hay nada → `rechazado` con el mensaje de la base y no se guarda nada de ese ítem.
- `calidad_por` = analista del token; `calidad_en` = **hora del servidor**. Al marcarse alterada, la
  base aplica la sanción (precio D+1..D+7, o bloqueo si reincide). La respuesta la devuelve en
  `sancion: {tipo, desde, hasta}`.
- Si ya estaba revisada → `duplicado` y **no se cambia**. Las correcciones las hace el admin.
  Recolección inexistente o anulada → `rechazado`.

**Alterada solo con foto:** primero se sube la foto (punto 4) y después se envía la revisión `alterado`.

## 4. `POST /analisis/{recoleccion_id}/foto` (analista o admin)

Multipart con el campo `archivo`. Solo JPEG, PNG o WebP: se comprueban los bytes del archivo, no el
content-type. Máximo `FOTO_MAX_MB` (5 MB por defecto); si se pasa → 413. Se guarda en
`backend/storage/analisis/` (fuera de git) y se hace upsert de `analisis_calidad.foto_url`, así que
puede subirse antes o después de la revisión. `GET /analisis/{recoleccion_id}/foto` devuelve la imagen.

## 5. `GET /sync/pull?desde=<timestamp>`

- La primera vez (o para resincronizar todo) se llama sin `desde`. Después se usa el
  **`siguiente_desde`** de la respuesta anterior. Es `now() − 2 min`, para no perder cambios de
  transacciones concurrentes; por eso pueden repetirse filas y el celular debe aplicarlas como
  **upsert por id**.
- Van **completos en cada pull**: `estados` y `precios` (no tienen `actualizado_en`), y las listas
  `*_ids_vigentes`. El celular **borra** lo que tenga y no esté en esas listas, por ejemplo cuando le
  quitan una ruta o un productor se desactiva.
- `estados` = filas de `v_productor_estado_hoy` **solo de productores con sanción hoy**. El que no
  aparece está normal. `bloqueado=true` → aviso rojo "Productor bloqueado, no debe entregar leche".

**Acopiador** (`rol: "acopiador"`)
- `rutas`: sus rutas vigentes (asignación abierta y ruta activa) que cambiaron.
- `productores`: los productores activos de esas rutas que cambiaron. Si la ruta se le asignó
  después de `desde`, llegan todos sus productores.
- `ruta_ids_vigentes`, `productor_ids_vigentes`, `estados`.
- `precios`: `{fecha, normal, sancion}` vigentes hoy.

**Analista** (`rol: "analista"`)
- `sin_revisar`: lista completa de `v_recoleccion_sin_revisar` (su lista de trabajo).
- `recolecciones_hoy`: recolecciones de hoy (hora de Lima) que cambiaron, con `revisada` y `anulada`.
- `productores` (externos que cambiaron), `productor_ids_vigentes` y `estados` (todos los productores sancionados).

## 6. `GET /acopiador/mi-dia` (solo acopiador)

`{fecha, total_litros, n_recolecciones, recolecciones: [...]}` de lo que el servidor ya recibió hoy
(hora de Lima). Las anuladas aparecen en la lista con `anulada_en`, pero no suman. Lo que aún no se
sincronizó lo suma el celular desde Room.

## 6b. `GET /acopiador/ultimos-dias` (solo acopiador, Bloque 7)

Lista de `MiDia` (el mismo objeto de la sección 6), **un elemento por día de hoy−6 a hoy, hoy primero**,
incluidos los días sin entregas (`total_litros` 0, `recolecciones` vacía). Un día = fecha en hora de Lima
(`fecha` de `v_recoleccion_detalle`, la misma regla que `mi-dia`); el elemento de hoy es idéntico a lo que
devuelve `mi-dia`. Solo las recolecciones que registró el acopiador autenticado (`registrado_por`). Sin
parámetros: el límite de 7 días es la constante `DIAS_HISTORIAL` en `backend/app/routers/acopiador.py` (y
la misma en `MiDia.DIAS_HISTORIAL` de la app). Otro rol → 403; sin token → 401. No toca el esquema.

Por qué un solo endpoint con las filas, y no `mi-dia?fecha=` o un resumen por día: la lista de B6b
necesita el total de cada día y su detalle las filas; así basta **una consulta y una llamada**, sin
parámetros que validar, y con señal intermitente el detalle se arma con lo ya recibido (unas 200 filas
como mucho). `mi-dia` no cambió: B3 lo sigue usando para rehidratar el día.

El celular junta cada día con lo de Room igual que en B6, descartando por UUID lo pendiente que el
servidor ya tiene. Sin red no arma totales de días anteriores (ver `docs/pendientes-historial.md`).

## 7. Admin (relacionado)

- `GET /alertas`: pendientes, con datos de la recolección y `recoleccion_retenida`. Filtros `todas`,
  `tipo`, `recoleccion_id`.
- `POST /alertas/{id}/revisar` `{resolucion}`: marca la alerta como revisada. Si era
  `productor_bloqueado` o `firma_invalida`, se libera la retención (`v_recoleccion_pago`). Ya revisada → 409.
- `POST /recolecciones/{id}/anular` `{motivo}`: nunca se borra. La base levanta la sanción que la
  recolección originó. Ya anulada → 409.

## Observaciones del esquema (sin cambios, para revisar más adelante)

1. **Ruta propia del acopiador.** `fn_validar_recoleccion` exige que el productor sea `de_ruta`, pero
   no que su ruta esté asignada al acopiador que registra. Por decisión, el backend no lo valida:
   rechazarlo offline perdería leche real, por ejemplo cuando una ruta se reasigna a mitad del día. Si
   se quiere controlar, la forma correcta es una alerta nueva en el esquema (`fuera_de_ruta`).
2. **Anular una recolección ya liquidada.** El esquema no lo impide, ni siquiera si la liquidación
   está pagada. El backend tampoco lo impide (la regla debe vivir en la base).

## Observaciones de la app Android (Fase 3A)

Huecos del contrato encontrados al implementar el móvil. El backend no se cambió; la app sigue al backend.

3. **Ingreso sin red (decidido por el cliente).** `POST /auth/pin/login` exige red. La app guarda,
   tras cada login exitoso en el servidor, un hash PBKDF2 del PIN (cifrado con una clave del Keystore)
   y sin red valida contra él. Bloqueo local: 5 intentos → 15 min, copiando los valores por defecto de
   `PIN_MAX_INTENTOS` / `PIN_BLOQUEO_MIN`. **La API no expone esos valores**: si el admin los cambia
   en `.env`, el celular no se entera. La primera vez se necesita red.
4. **"Definir PIN" al activar — RESUELTO en el Bloque 6.** El usuario crea su PIN de 4 dígitos en la
   activación (`POST /auth/dispositivo/activar` recibe `pin` y devuelve el token); el admin ya no define
   PIN inicial. `debe_cambiar_pin` siempre es `false` y la app ya no tiene cambio de PIN.
5. **Token vencido sin red.** El JWT móvil dura `JWT_MINUTOS_MOVIL` (12 h). La sincronización en segundo
   plano no puede renovarlo sin el PIN: si vence, lo pendiente espera a que el acopiador ingrese con PIN
   y señal. Nada se pierde (sigue en Room).
6. **401 con códigos distintos.** `POST /auth/pin/login` devuelve `codigo: "pin_incorrecto"` cuando el
   PIN no coincide (la app cuenta el intento en el bloqueo local y muestra el mensaje del servidor) y
   `codigo: "dispositivo_no_vinculado"` cuando el celular fue desactivado (la app no cuenta el intento;
   la pantalla puede ofrecer "vincular de nuevo"). Actualizado en la Fase 3B.
7. **Revinculación y firmas pendientes.** Si el celular se vuelve a vincular, la app **reutiliza** la
   clave del Keystore: las recolecciones pendientes firmadas antes siguen validando. Si se reinstala la
   app, la clave y el `device_uuid` se pierden (y con ellos lo no sincronizado).
8. **Rol analista.** El mismo APK lo puede activar un analista, pero las Fases 3A/3B solo implementan al
   acopiador: el pull del analista se rechaza en el celular con "Esta versión de la app es solo para acopiadores".
9. **Varias recolecciones por productor y día (Fase 3B).** No hay límite: ni `db/schema.sql` (no existe
   un UNIQUE por productor y fecha en `recoleccion`) ni este contrato lo imponen, y el push acepta
   varias. Cada entrega lleva su propio UUID de cliente y suma al total del día. Consecuencia para la
   app: como una segunda entrega es legítima, **nadie aguas abajo puede distinguir un doble toque de
   una entrega real** (`ON CONFLICT DO NOTHING` solo deduplica por UUID, y dos toques generan dos UUID),
   así que la protección contra el doble toque tiene que vivir en la pantalla B4.
10. **Rehidratar el estado del día en un celular limpio (Fase 3B).** Tras reinstalar o revincular, Room
    queda vacía y B3 muestra "Pendiente" para productores que sí entregaron hoy, porque el estado del
    día se calcula solo con la base local. Qué ofrece el servidor hoy, sin cambiar nada:
    - `GET /sync/pull` **no** devuelve recolecciones al acopiador: solo `rutas`, `productores`,
      `ruta_ids_vigentes`, `productor_ids_vigentes`, `estados` y `precios`. El rol **analista** sí
      recibe `recolecciones_hoy`; el acopiador no. Esa asimetría es la causa del hueco.
    - `GET /acopiador/mi-dia` **sí** devuelve lo necesario: una fila por recolección de hoy con
      `recoleccion_id` (el mismo UUID que generó el celular), `productor_id`, `productor`,
      `productor_codigo`, `litros` y `anulada_en`, filtradas por `registrado_por = <acopiador>` y la
      fecha de Lima. Agrupando por `productor_id` y descartando las anuladas se reconstruye
      exactamente lo que B3 muestra (total del día y número de entregas).

    Conclusión: **no hace falta tocar el backend**. Resuelto así en la app: B3 consulta mi-día al
    abrirse y después de cada sincronización (cuando cambia `ultimo_sync_ms`), y fusiona en memoria lo
    que devuelve con lo de Room, descartando por UUID las recolecciones que ya tiene y las anuladas
    (`RehidratarDia.fusionar`). No se guarda nada nuevo: ninguna migración de Room. **B6 ya estaba
    cubierta**: `MiDia.obtener()` llama a mi-día y le suma lo pendiente de Room.

    Límites que quedan: necesita red en ese momento (si la app se cierra, se vuelve a preguntar al
    abrir; en un celular limpio y sin señal no hay nada que rehidratar, y B3 avisa que puede faltar lo
    de hoy); solo cubre HOY (los días anteriores ya se pueden **consultar** en B6b, sección 6b, pero
    eso no cambia el estado de B3, que es por jornada); y solo lo que registró ESE acopiador, así que si a un productor le
    recibió leche otro acopiador (ruta reasignada a mitad del día) B3 lo seguirá mostrando como
    pendiente. Tampoco se enteran las filas locales de una anulación hecha en el servidor: una
    recolección anulada que este celular registró sigue sumando en B3 hasta el próximo día.

    Lo que **no** conviene: volcar las filas de mi-dia en la tabla local `recoleccion`. Esa tabla es la
    cola de envío y su parte firmada tiene columnas obligatorias que mi-dia no devuelve (`firma`,
    `origen_ubicacion`); rellenarlas a mano ensuciaría la cadena de firmas (`ultima_firma`).
11. **`BaseLocalTest` (instrumentado) sin correr desde la Fase 3B.** Es el único test que ejercita la
    consulta `observarProductores` contra SQLite real (junta productor + ruta + sanción + lo registrado
    hoy, incluidas varias entregas del mismo día). El celular de pruebas es un Xiaomi con HyperOS que
    rechaza la instalación por USB (`INSTALL_FAILED_USER_RESTRICTED`) mientras no se active
    "Depuración USB (ajustes de seguridad)", así que **queda pendiente**. Mientras tanto, el SQL está
    validado por KSP en cada compilación (Room comprueba las consultas y sus columnas) y la lógica de
    las pantallas por las 49 pruebas unitarias. Pendiente: correrlo con el celular habilitado.

## Pendientes antes de producción

Lo que falta antes de entregar celulares a los acopiadores de verdad. Nada de esto bloquea la Fase 3:
son decisiones del cliente o cambios de `backend/` y `db/` que necesitan su aprobación.

**(C) Cambio de PIN obligatorio sin señal — OBSOLETO desde el Bloque 6.** Se había resuelto en la Fase 3C
con la "opción C" (con red el cambio era ineludible; sin red se entraba a B3 con un aviso). Desde el
Bloque 6 el usuario crea su propio PIN al activar, así que no hay PIN del admin que cambiar: B2b, la
opción C, `Rumbo.exigeCambioDePin` y `Autenticador.cambiarPin` se quitaron (app 0.6.0). Un PIN olvidado
se recupera reactivando con un código nuevo. Un usuario que todavía tenga un PIN puesto por el admin
(`pin_actualizado_en` NULL) recibe 401 `debe_reactivar` con señal; sin señal sigue entrando con su
verificador local, así que nunca se bloquea el registro de leche.

**(A) Lista negra de PIN triviales — RESUELTO en el Bloque 6.** `seguridad.pin_trivial` (backend) rechaza
204 de las 10 000 combinaciones (todos iguales, secuencias de subida o bajada, XYXY, XXYY) y los últimos 4
dígitos del DNI o celular del usuario, con 422 `pin_trivial`. Se aplica al CREAR el PIN —en la activación
y en `POST /auth/pin/cambiar`— nunca al ingresar. `POST /usuarios/{id}/pin` y `pin_inicial` ya no
existen. La app avisa antes con las mismas reglas (`ReglasPin.kt`), pero decide el servidor.

**(B) `pin_nuevo` distinto de `pin_actual` — RESUELTO en el Bloque 6.** `POST /auth/pin/cambiar` responde
422 `pin_repetido` (y 422 `pin_trivial`) **antes** de verificar el PIN actual, así que no gasta intento.
El endpoint queda en el backend, sin pantalla en la app.

**(D) Seed que ejercite la activación — PARCIAL.** Ya no hay cambio obligatorio que probar (ver (C)).
`db/seed.sql` sigue dando el PIN `1234` (trivial) a los tres usuarios móviles con `pin_actualizado_en =
now()`: siguen entrando, porque el login no revisa trivialidad. Falta, si se quiere, un usuario del seed
**pendiente de activar** (`pin_hash` NULL) para probar B1 sin crear uno a mano; es un cambio en `db/` que
necesita aprobación.

**(E) PIN inicial del admin — RESUELTO de otra forma en el Bloque 6.** El admin ya no define ningún PIN:
el usuario nace "pendiente de activar" (`pin_hash` NULL, migración `db/migraciones/2026-10-bloque6-pin-null.sql`,
y `pin_pendiente` en los listados) y el admin solo genera el código de activación (8 caracteres, un solo
uso, `CODIGO_ACTIVACION_MINUTOS` = 60, se muestra una vez y en la base queda su HMAC; máximo 10 códigos
inválidos por IP en 10 min → 429). Con ese código el usuario crea su PIN. El mismo código sirve para
recuperar un PIN olvidado o bloqueado.

**(F) Límites 2 y 3 de la rehidratación de B3** (ver el ítem 10 de este documento). Además de necesitar
red en ese momento: **(2) solo cubre HOY** — un celular reinstalado no recupera el estado de días
anteriores, que solo vive en el servidor (desde el Bloque 7 el acopiador **ve** los totales de los
últimos 7 días en B6b con `GET /acopiador/ultimos-dias`; lo que sigue sin existir es rehidratar B3 con
días anteriores, que no hace falta porque B3 es solo de hoy); y **(3) solo lo que registró ESE acopiador** — si a un productor
le recibió leche otro acopiador (ruta reasignada a mitad del día), B3 lo seguirá mostrando como
pendiente y puede recibirle leche dos veces el mismo día sin aviso. De ahí sale también que una
recolección anulada en el servidor que este celular registró siga sumando en B3 hasta el día siguiente.
Si alguno de los dos molesta en campo, lo correcto es ampliar `GET /acopiador/mi-dia` (un parámetro de
fecha, o incluir lo de toda la ruta y no solo lo propio), no parchearlo en el celular.

**(G) Celular con fecha y hora automáticas en producción.** `hora_automatica` se firma y viaja en cada
recolección, pero **nunca bloquea el registro**. Con la hora puesta a mano y mal, la recolección cae en
otra jornada: B3 y B6 muestran totales que no son los del día y la liquidación semanal puede cargar la
leche a la semana equivocada. El servidor solo lo delata con la alerta `hora_inconsistente`, que el admin
tiene que revisar. Procedimiento de entrega del celular: activar "Fecha y hora automáticas" y "Zona
horaria automática" (America/Lima), y dejarlo verificado por escrito.

**(H) Reasignar la leche de un alta de productor rechazada.** Si el servidor rechaza el alta hecha en el
campo (por ejemplo, DNI repetido), sus recolecciones se rechazan también —el push responde "El productor
no está registrado"— y hoy **no hay forma de apuntarlas al productor correcto**: el productor es el campo
3 de la cadena canónica firmada (`uuid:<productor_uuid_cliente>`), así que cambiarlo invalida la firma y,
al refirmar, rompe el `hash_anterior` de los registros siguientes de ese celular. La app hace lo único
seguro: dejarlas a la vista en B7, dentro de la tarjeta de su alta rechazada, con litros, hora y motivo,
para que el acopiador lo reporte y el admin lo registre. Desde la 0.5.0 el acopiador puede marcar
"Ya avisé" (`meta.avisos_vistos`): la tarjeta pasa a "ya avisadas" y deja de contar como rechazo
pendiente, pero las filas siguen en Room como RECHAZADO, sin cambios. La solución de fondo exige
decidir dónde vive la reasignación (el admin web sobre la recolección rechazada, o un alta corregida
reenviada con el mismo `uuid_cliente`) y toca backend y esquema.

**(I) DNI repetido de un productor externo que el celular no conoce.** El aviso de B5 ("¿Es este
productor?") compara el DNI solo contra los productores que hay en el celular (`productoresLocales`):
los de las rutas del acopiador, que es lo único que baja el pull. Los productores `externo` que registra
el analista en planta no bajan nunca, así que si el acopiador da de alta a uno de ellos con su DNI, el
celular no avisa nada, el alta se envía y el servidor la rechaza por el UNIQUE de `documento`, con su
leche retenida por arrastre (ver (H)). Opciones, todas con backend: una consulta puntual de DNI cuando
hay señal (`GET` que diga solo si existe y de qué tipo, sin exponer datos de otros), o que el servidor
acepte el alta como "coincide con un productor existente" y lo resuelva el admin. Sin señal seguirá sin
poder detectarse, así que la regla de "nunca impedir el registro" se mantiene.

**(J) Longitud del PIN fija en 4 dígitos — RESUELTO en el Bloque 6.** `PATRON_PIN = r"^[0-9]{4}$"` en el
backend y `ReglasPin.LARGO = 4` en el móvil. B2 se verifica solo al 4.º dígito, sin OK, y una entrada
mal formada (3, 5 o 6 dígitos) da 422 sin contar como intento. Un usuario con un PIN viejo de 5 o 6 dígitos
no puede teclearlo: usa "¿Olvidó su PIN? Tengo un código nuevo" y crea uno de 4 al reactivar, sin perder
lo que tenga sin enviar (probado en el Realme, app 0.6.0).
