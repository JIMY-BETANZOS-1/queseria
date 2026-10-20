"""Base de demostración queseria_demo: limpia lo transaccional y carga una semana realista por la API.

SOLO corre contra la base "queseria_demo" (guardia al empezar, al conectar y antes de cada paso). Nunca escribe en
"queseria": solo la cuenta (en modo de solo lectura) antes y después, para probar que no cambió.

Uso (desde backend\\, con la base ya restaurada desde un dump):
    .\\.venv\\Scripts\\python.exe scripts\\demo\\cargar_demo.py --base queseria_demo --fase listar   # no cambia nada
    .\\.venv\\Scripts\\python.exe scripts\\demo\\cargar_demo.py --base queseria_demo --fase todo

Fases de "todo":
  1. Conteo de filas de "queseria" (solo lectura).
  2. Limpieza en UNA transacción: TRUNCATE ... RESTART IDENTITY CASCADE de lo transaccional (no dispara los triggers
     de fila, así que no hace falta desactivar ninguno) y DELETE de lo de prueba ("PRUEBA…"). Antes del COMMIT se
     comparan los conteos de lo conservado con lo esperado: si no coinciden, ROLLBACK.
  3. Carga por la API (TestClient en el mismo proceso): triggers, alertas y verificación de firma como en producción.
     Las entregas las registra Rosa Elena Condori Apaza con un celular de demostración cuya clave ECDSA P-256 genera
     este script (la del Realme vive en su Keystore). Juan Carlos y su celular no se tocan.
  4. Verificación con las vistas y conteo final de "queseria".

Artefacto de la demostración (aprobado solo para queseria_demo): para que el bloqueo rija el día de la demo, la
primera alteración de un productor se marca con calidad_en de hace 3 días (UPDATE directo, con su análisis); la base
crea la sanción y, con la segunda alteración (hecha hoy por la API), decide ella misma el bloqueo por reincidencia.
"""
import argparse
import base64
import math
import os
import random
import secrets
import sys
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DEMO = "queseria_demo"
BASE_REAL = "queseria"
LIMA = ZoneInfo("America/Lima")

# Lo transaccional: se vacía con TRUNCATE ... CASCADE
TRUNCAR = [
    "venta_detalle", "venta", "cliente", "baja_producto", "merma_leche", "lote_costo", "lote_leche",
    "movimiento_insumo", "lote_produccion", "liquidacion_detalle", "liquidacion_productor", "pago_acopiador",
    "gasto_operativo", "alerta_recoleccion", "analisis_calidad", "sancion_productor", "recoleccion",
    "codigo_activacion", "auditoria",
]
# Lo que se conserva y se cuenta antes del COMMIT
CONSERVAR = ["usuario", "dispositivo", "acopiador", "ruta", "ruta_acopiador", "productor", "configuracion",
             "precio_leche", "insumo", "receta", "receta_insumo", "categoria_gasto"]

JUAN_CARLOS = "Juan Carlos Mamani Quispe"
ROSA = "Rosa Elena Condori Apaza"
PATRON_PRUEBA = "PRUEBA%"
M_POR_GRADO = 111_320


class BaseNoPermitida(Exception):
    """Se intentó correr contra otra base que no es queseria_demo."""


class ConteoDistinto(Exception):
    """Lo conservado no coincide con lo esperado: la transacción se deshace."""


# ------------------------------------------------------------------ guardias (puras, con pruebas)
def verificar_base(pedida: str, actual: str | None = None) -> None:
    """Solo queseria_demo, escrita exacta; y, si ya hay conexión, current_database() tiene que ser esa misma."""
    if pedida != BASE_DEMO:
        raise BaseNoPermitida(f"Este script solo corre contra '{BASE_DEMO}' (se pidió '{pedida}')")
    if actual is not None and actual != BASE_DEMO:
        raise BaseNoPermitida(f"La conexión apunta a '{actual}', no a '{BASE_DEMO}': no se hace nada")


def revisar_alcance(alcance: set[str], permitidas: set[str]) -> None:
    """El TRUNCATE CASCADE no puede alcanzar ninguna tabla fuera de la lista de lo transaccional."""
    fuera = sorted(alcance - permitidas)
    if fuera:
        raise BaseNoPermitida(f"El TRUNCATE CASCADE alcanzaría tablas que se conservan: {', '.join(fuera)}")


def comparar_conteos(esperado: dict[str, int], real: dict[str, int]) -> None:
    distintos = {t: (esperado[t], real.get(t)) for t in esperado if real.get(t) != esperado[t]}
    if distintos:
        detalle = ", ".join(f"{t}: esperado {e}, hay {r}" for t, (e, r) in distintos.items())
        raise ConteoDistinto(f"Lo conservado no coincide ({detalle}): ROLLBACK")


def alrededor(lat: float, lon: float, rng: random.Random, radio_m: float = 25) -> tuple[float, float]:
    """Un punto al azar a no más de radio_m de (lat, lon)."""
    angulo = rng.uniform(0, 2 * math.pi)
    d = rng.uniform(0, radio_m)
    return (lat + d * math.cos(angulo) / M_POR_GRADO,
            lon + d * math.sin(angulo) / (M_POR_GRADO * math.cos(math.radians(lat))))


def a_metros(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia aproximada (plana) entre dos puntos cercanos, en metros."""
    dy = (lat2 - lat1) * M_POR_GRADO
    dx = (lon2 - lon1) * M_POR_GRADO * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


# ------------------------------------------------------------------ conexión
def _conninfo(base: str, solo_lectura: bool = False) -> str:
    from psycopg.conninfo import make_conninfo

    from app.config import config

    opciones = "-c TimeZone=America/Lima" + (" -c default_transaction_read_only=on" if solo_lectura else "")
    return make_conninfo(config().conninfo, dbname=base, application_name="queseria-demo", options=opciones)


def conectar(base: str, solo_lectura: bool = False):
    import psycopg
    from psycopg.rows import dict_row

    # autocommit: cada "with conn.transaction()" es una transacción real que se confirma al salir. Sin esto, el
    # TRUNCATE quedaría abierto y bloquearía a la API (otras conexiones) durante la carga.
    return psycopg.connect(_conninfo(base, solo_lectura), row_factory=dict_row, autocommit=True)


def base_actual(conn) -> str:
    return conn.execute("SELECT current_database() AS b").fetchone()["b"]


def contar_tablas(conn) -> dict[str, int]:
    tablas = [f["table_name"] for f in conn.execute("""
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name
    """).fetchall()]
    from psycopg import sql
    return {t: conn.execute(sql.SQL("SELECT COUNT(*) AS n FROM {}").format(sql.Identifier(t))).fetchone()["n"]
            for t in tablas}


def alcance_truncate(conn, tablas: list[str]) -> set[str]:
    """Todas las tablas que alcanzaría TRUNCATE ... CASCADE: las pedidas y las que las referencian, recursivamente."""
    filas = conn.execute("""
        WITH RECURSIVE alc(oid) AS (
          SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = ANY(%s)
          UNION
          SELECT k.conrelid FROM pg_constraint k JOIN alc ON k.confrelid = alc.oid WHERE k.contype = 'f'
        )
        SELECT c.relname FROM alc JOIN pg_class c ON c.oid = alc.oid
    """, (tablas,)).fetchall()
    return {f["relname"] for f in filas}


# ------------------------------------------------------------------ fase de lectura
def de_prueba(conn) -> dict[str, list[dict]]:
    p = {"patron": PATRON_PRUEBA}
    rutas = conn.execute("SELECT id, nombre FROM ruta WHERE nombre ILIKE %(patron)s ORDER BY id", p).fetchall()
    ids_rutas = [r["id"] for r in rutas]
    return {
        "usuarios": conn.execute("SELECT id, rol::text AS rol, nombre_completo FROM usuario "
                                 "WHERE nombre_completo ILIKE %(patron)s ORDER BY id", p).fetchall(),
        "rutas": rutas,
        "productores": conn.execute("SELECT id, nombre FROM productor WHERE nombre ILIKE %(patron)s "
                                    "OR ruta_id = ANY(%(rutas)s) ORDER BY id", {**p, "rutas": ids_rutas}).fetchall(),
        "insumos": conn.execute("SELECT id, nombre FROM insumo WHERE nombre ILIKE %(patron)s ORDER BY id", p).fetchall(),
        "recetas": conn.execute("SELECT id, nombre FROM receta WHERE nombre ILIKE %(patron)s ORDER BY id", p).fetchall(),
    }


def juan_carlos(conn) -> dict:
    filas = conn.execute("""
        SELECT u.id AS usuario_id, d.id AS dispositivo_id, md5(COALESCE(d.clave_publica, '')) AS huella
          FROM usuario u JOIN dispositivo d ON d.usuario_id = u.id AND d.activo
         WHERE u.nombre_completo = %s AND u.rol = 'acopiador' AND u.activo
    """, (JUAN_CARLOS,)).fetchall()
    if len(filas) != 1:
        raise BaseNoPermitida(f"Se esperaba exactamente un {JUAN_CARLOS} con celular activo; hay {len(filas)}")
    return filas[0]


def listar(conn) -> dict:
    verificar_base(BASE_DEMO, base_actual(conn))
    alcance = alcance_truncate(conn, TRUNCAR)
    revisar_alcance(alcance, set(TRUNCAR))
    conteos = contar_tablas(conn)
    print("TRUNCATE ... CASCADE alcanzaría (filas actuales):")
    for t in sorted(alcance):
        print(f"  - {t}: {conteos.get(t, 0)}")
    prueba = de_prueba(conn)
    print("De prueba (se borran):")
    for clave, filas in prueba.items():
        print(f"  {clave}: " + (", ".join(f"{f['id']} {f.get('nombre') or f.get('nombre_completo')}" for f in filas) or "ninguno"))
    jc = juan_carlos(conn)
    print(f"Se conserva {JUAN_CARLOS} (usuario {jc['usuario_id']}) con su celular activo (dispositivo {jc['dispositivo_id']}).")
    return {"conteos": conteos, "prueba": prueba, "juan_carlos": jc}


# ------------------------------------------------------------------ fase de limpieza
def limpiar(conn) -> None:
    """Una sola transacción; ROLLBACK si algo no cuadra."""
    from psycopg import sql

    with conn.transaction():
        verificar_base(BASE_DEMO, base_actual(conn))
        info = listar(conn)
        admin = conn.execute("SELECT id FROM usuario WHERE rol = 'admin' AND activo ORDER BY id LIMIT 1").fetchone()["id"]
        conn.execute("SELECT set_config('app.usuario_id', %s, true)", (str(admin),))
        p = info["prueba"]
        ids = {k: [f["id"] for f in v] for k, v in p.items()}
        antes = info["conteos"]
        borra_ra = conn.execute("SELECT COUNT(*) AS n FROM ruta_acopiador WHERE ruta_id = ANY(%s) OR acopiador_id = ANY(%s)",
                                (ids["rutas"], ids["usuarios"])).fetchone()["n"]
        borra_ri = conn.execute("SELECT COUNT(*) AS n FROM receta_insumo WHERE receta_id = ANY(%s) OR insumo_id = ANY(%s)",
                                (ids["recetas"], ids["insumos"])).fetchone()["n"]
        acop_prueba = conn.execute("SELECT COUNT(*) AS n FROM acopiador WHERE usuario_id = ANY(%s)",
                                   (ids["usuarios"],)).fetchone()["n"]
        disp_prueba = conn.execute("SELECT COUNT(*) AS n FROM dispositivo WHERE usuario_id = ANY(%s)",
                                   (ids["usuarios"],)).fetchone()["n"]
        esperado = {
            "usuario": antes["usuario"] - len(ids["usuarios"]),
            "dispositivo": antes["dispositivo"] - disp_prueba,
            "acopiador": antes["acopiador"] - acop_prueba,
            "ruta": antes["ruta"] - len(ids["rutas"]),
            "ruta_acopiador": antes["ruta_acopiador"] - borra_ra,
            "productor": antes["productor"] - len(ids["productores"]),
            "insumo": antes["insumo"] - len(ids["insumos"]),
            "receta": antes["receta"] - len(ids["recetas"]),
            "receta_insumo": antes["receta_insumo"] - borra_ri,
            **{t: antes[t] for t in ("configuracion", "precio_leche", "categoria_gasto")},
        }

        verificar_base(BASE_DEMO, base_actual(conn))
        conn.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(
            sql.SQL(", ").join(sql.Identifier(t) for t in TRUNCAR)))
        conn.execute("DELETE FROM ruta_acopiador WHERE ruta_id = ANY(%s) OR acopiador_id = ANY(%s)", (ids["rutas"], ids["usuarios"]))
        conn.execute("DELETE FROM productor WHERE id = ANY(%s)", (ids["productores"],))
        conn.execute("DELETE FROM ruta WHERE id = ANY(%s)", (ids["rutas"],))
        conn.execute("DELETE FROM receta WHERE id = ANY(%s)", (ids["recetas"],))
        conn.execute("DELETE FROM insumo WHERE id = ANY(%s)", (ids["insumos"],))
        conn.execute("DELETE FROM usuario WHERE id = ANY(%s)", (ids["usuarios"],))

        despues = contar_tablas(conn)
        comparar_conteos(esperado, despues)
        jc = juan_carlos(conn)
        if (jc["dispositivo_id"], jc["huella"]) != (info["juan_carlos"]["dispositivo_id"], info["juan_carlos"]["huella"]):
            raise ConteoDistinto(f"El celular de {JUAN_CARLOS} cambió: ROLLBACK")
        vacias = [t for t in TRUNCAR if despues[t] != 0 and t != "auditoria"]
        if vacias:
            raise ConteoDistinto(f"Quedaron filas en {', '.join(vacias)}: ROLLBACK")
        print("Limpieza: conteos de lo conservado correctos; COMMIT.")


# ------------------------------------------------------------------ fase de carga (por la API)
class Movil:
    """Celular de demostración: clave ECDSA P-256 propia y cadena de firmas (hash_anterior)."""

    def __init__(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        self.privada = ec.generate_private_key(ec.SECP256R1())
        self.publica = base64.b64encode(self.privada.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).decode()
        self.ultima_firma: str | None = None
        self.token: str | None = None

    def firmar(self, item: dict) -> dict:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec

        from app.esquemas.sync import RecoleccionPush
        from app.firma import cadena_canonica

        item = {**item, "hash_anterior": self.ultima_firma}
        cadena = cadena_canonica(RecoleccionPush.model_validate(item))
        firma = base64.b64encode(self.privada.sign(cadena.encode(), ec.ECDSA(hashes.SHA256()))).decode()
        self.ultima_firma = firma
        return {**item, "firma": firma}


def _ok(r, esperado=(200, 201)):
    if r.status_code not in esperado:
        raise RuntimeError(f"{r.request.method} {r.request.url.path} → {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else None


def _pin_valido(dni: str, celular: str) -> str:
    from app import seguridad
    while True:
        pin = f"{secrets.randbelow(10_000):04d}"
        if seguridad.pin_trivial(pin, dni, celular) is None:
            return pin


def cargar(client, conn, rng: random.Random) -> dict:
    """Una semana de trabajo de la Ruta 3 (Rosa Elena), con las situaciones de la demo."""
    from app import seguridad

    verificar_base(BASE_DEMO, base_actual(conn))
    hoy = conn.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"]
    admin_id = conn.execute("SELECT id FROM usuario WHERE rol = 'admin' AND activo ORDER BY id LIMIT 1").fetchone()["id"]
    adm = {"Authorization": f"Bearer {seguridad.crear_token(admin_id, 'admin', 120)}"}   # no se imprime
    salud = _ok(client.get("/salud"))
    verificar_base(BASE_DEMO, salud["base"])

    rosa = conn.execute("""SELECT u.id, u.dni, u.celular FROM usuario u WHERE u.nombre_completo = %s AND u.rol = 'acopiador'""",
                        (ROSA,)).fetchone()
    if rosa is None:
        raise RuntimeError(f"No está {ROSA} en la base")
    ruta = conn.execute("""SELECT r.id, r.nombre FROM ruta r JOIN ruta_acopiador ra ON ra.ruta_id = r.id
                            WHERE ra.acopiador_id = %s AND ra.vigente_hasta IS NULL AND r.activa ORDER BY r.id LIMIT 1""",
                        (rosa["id"],)).fetchone()
    productores = conn.execute("""SELECT id, nombre, latitud_ref::float AS lat, longitud_ref::float AS lon
                                    FROM productor WHERE ruta_id = %s AND activo AND aprobado AND latitud_ref IS NOT NULL
                                   ORDER BY id""", (ruta["id"],)).fetchall()
    if len(productores) < 4:
        raise RuntimeError(f"La ruta {ruta['nombre']} necesita al menos 4 productores con referencia GPS")

    # Celular de demostración para Rosa Elena (código del admin + clave propia + PIN al azar que no se muestra)
    movil = Movil()
    codigo = _ok(client.post(f"/usuarios/{rosa['id']}/codigo-activacion", headers=adm))["codigo"]
    act = _ok(client.post("/auth/dispositivo/activar", json={
        "codigo": codigo, "device_uuid": str(uuid.uuid4()), "clave_publica": movil.publica, "modelo": "Celular de demostración",
        "pin": _pin_valido(rosa["dni"], rosa["celular"])}))
    movil.token = act["access_token"]
    mov = {"Authorization": f"Bearer {movil.token}"}

    # Compra inicial de insumos (9 días antes) para la producción de la semana
    insumos = {f["nombre"]: f["insumo_id"] for f in _ok(client.get("/insumos", headers=adm))}
    compras = {"Cuajo líquido": (1500, 0.08), "Cloruro de calcio": (3000, 0.015), "Sal": (40, 1.5),
               "Cultivo láctico mesófilo": (300, 0.9), "Cultivo para yogurt": (200, 1.2), "Azúcar": (60, 3.8),
               "Envase de yogurt 1 kg": (300, 0.8), "Bolsa para queso": (800, 0.15)}
    for nombre, (cantidad, costo) in compras.items():
        if nombre in insumos:
            _ok(client.post(f"/insumos/{insumos[nombre]}/ingresos", headers=adm, json={
                "cantidad": cantidad, "costo_unitario": costo, "fecha": str(hoy - timedelta(days=9)),
                "nota": "Compra inicial de la semana"}))

    # Entregas: 8 días (hoy-7 … hoy), una por productor y día, alrededor de su referencia GPS
    base_litros = {p["id"]: rng.uniform(12, 38) for p in productores}
    entregas: dict[date, list[dict]] = {}
    lejos = productores[0]
    simulada = productores[3]
    sin_gps = productores[-1]
    for n in range(7, -1, -1):
        dia = hoy - timedelta(days=n)
        hora = datetime.combine(dia, time(6, 0), LIMA)
        items = []
        for p in productores:
            hora += timedelta(minutes=rng.randint(14, 22))
            lat, lon = alrededor(p["lat"], p["lon"], rng)
            extra = {"precision_m": round(rng.uniform(4, 12), 1), "origen_ubicacion": "gps", "ubicacion_simulada": False}
            if dia == hoy and p is lejos:                 # una entrega a ~500 m de su referencia
                lat = p["lat"] + 500 / M_POR_GRADO
            if dia == hoy - timedelta(days=1) and p is simulada:
                extra["ubicacion_simulada"] = True
            if dia == hoy - timedelta(days=2) and p is sin_gps:
                lat = lon = None
                extra = {"precision_m": None, "origen_ubicacion": "ninguna", "ubicacion_simulada": False}
            hora_utc = hora.astimezone(timezone.utc).isoformat()
            item = {"id": str(uuid.uuid4()), "productor_id": p["id"],
                    "litros": round(base_litros[p["id"]] * rng.uniform(0.9, 1.1), 2),
                    "registrada_en": hora_utc, "hora_gps": hora_utc if lat is not None else None,
                    "hora_automatica": True,
                    "latitud": None if lat is None else round(lat, 6), "longitud": None if lon is None else round(lon, 6),
                    **extra}
            items.append(movil.firmar(item))
        entregas[dia] = items

    # Alta de campo pendiente (hoy), con su entrega: queda retenida hasta que el admin la apruebe
    alta = {"uuid_cliente": str(uuid.uuid4()), "nombre": "Saturnina Ccori Huanca", "ruta_id": ruta["id"]}
    hora_alta = datetime.combine(hoy, time(8, 10), LIMA).astimezone(timezone.utc).isoformat()
    ref = productores[2]
    lat, lon = alrededor(ref["lat"] + 0.0012, ref["lon"] + 0.0010, rng)
    entrega_alta = movil.firmar({"id": str(uuid.uuid4()), "productor_uuid_cliente": alta["uuid_cliente"], "litros": 9.5,
                                 "registrada_en": hora_alta, "hora_gps": hora_alta, "hora_automatica": True,
                                 "latitud": round(lat, 6), "longitud": round(lon, 6), "precision_m": 6.0,
                                 "origen_ubicacion": "gps", "ubicacion_simulada": False})

    for dia in sorted(entregas):
        cuerpo = {"productores": [alta] if dia == hoy else [],
                  "recolecciones": entregas[dia] + ([entrega_alta] if dia == hoy else [])}
        resultado = _ok(client.post("/sync/push", headers=mov, json=cuerpo))
        rechazadas = [x for x in resultado["recolecciones"] if x["estado"] not in ("creado", "duplicado")]
        if rechazadas:
            raise RuntimeError(f"Entregas rechazadas el {dia}: {rechazadas}")

    # Calidad: todo normal, salvo dos productores (sanción de precio y bloqueo por reincidencia)
    sancion = productores[1]
    bloqueo = productores[2]
    ayer = hoy - timedelta(days=1)
    hace4 = hoy - timedelta(days=4)
    alteradas = {(sancion["id"], ayer), (bloqueo["id"], hace4), (bloqueo["id"], ayer)}
    for dia, items in entregas.items():
        for it in items:
            if (it["productor_id"], dia) in alteradas:
                continue
            _ok(client.post(f"/recolecciones/{it['id']}/calidad", headers=adm, json={}))
    _ok(client.post(f"/recolecciones/{entrega_alta['id']}/calidad", headers=adm, json={}))

    # Artefacto aprobado solo para queseria_demo: primera alteración del productor del bloqueo hace 3 días
    primera = next(it for it in entregas[hace4] if it["productor_id"] == bloqueo["id"])
    verificar_base(BASE_DEMO, base_actual(conn))
    with conn.transaction():
        conn.execute("SELECT set_config('app.usuario_id', %s, true)", (str(admin_id),))
        conn.execute("INSERT INTO analisis_calidad (recoleccion_id, ph, temperatura_c, antibioticos_positivo) "
                     "VALUES (%s, 6.2, 9.5, false)", (primera["id"],))
        conn.execute("""UPDATE recoleccion SET estado_calidad = 'alterado', calidad_por = %s,
                               calidad_en = (((now() AT TIME ZONE 'America/Lima')::date - 3) + time '09:00') AT TIME ZONE 'America/Lima'
                         WHERE id = %s""", (admin_id, primera["id"]))
    # Hoy, por la API: la base crea la sanción de precio (D+1…D+7) y, por reincidencia, el bloqueo
    for prod in (sancion, bloqueo):
        it = next(i for i in entregas[ayer] if i["productor_id"] == prod["id"])
        _ok(client.post(f"/recolecciones/{it['id']}/calidad", headers=adm,
                        json={"estado": "alterado", "ph": 6.3, "temperatura_c": 10.5, "densidad": 1.026,
                              "antibioticos_positivo": False}))

    # Producción diaria con toda la leche aprobada hasta ayer (si no, mañana, el día de la demo, quedaría "sin
    # destino" por dias_max_leche); la de hoy queda disponible para "Producir"
    recetas = {r["nombre"]: r for r in _ok(client.get("/recetas", headers=adm))}
    turno = ["Queso paria", "Queso pasteurizado", "Queso paria", "Yogurt", "Queso paria", "Queso pasteurizado"]
    lotes = []
    for n, dia in enumerate(sorted(d for d in entregas if d < hoy)):
        jornada = conn.execute("SELECT litros_disponibles::float AS l FROM v_leche_jornada WHERE fecha = %s", (dia,)).fetchone()
        receta = recetas.get(turno[n % len(turno)]) or recetas["Queso paria"]
        litros = round(jornada["l"], 2) if jornada else 0
        if litros <= 0:
            continue
        teorico = litros / receta["litros_base"] * (receta["rendimiento_base"] or 10)
        lotes.append(_ok(client.post("/produccion", headers=adm, json={
            "receta_id": receta["id"], "fecha_leche": str(dia), "litros": litros,
            "cantidad_producida": round(teorico * rng.uniform(0.94, 1.0), 0 if receta["unidad_venta"] == "unidad" else 1),
            "fecha_produccion": str(dia)})))

    # Ventas al contado de los lotes más antiguos
    clientes = [_ok(client.post("/clientes", headers=adm, json={"nombre": n})) for n in
                ("Bodega San Martín", "Minimarket Lucía", "Restaurante El Lago")]
    ventas = 0
    for k, lote in enumerate(lotes[:4]):
        cant = max(1, math.floor(lote["cantidad_producida"] * 0.6))
        precio = recetas[lote["receta"]]["precio_venta"] or 20
        _ok(client.post("/ventas", headers=adm, json={
            "cliente_id": clientes[k % len(clientes)]["id"], "lote_id": lote["lote_id"], "cantidad": cant,
            "precio_unitario": precio, "fecha": str(date.fromisoformat(str(lote["fecha_produccion"])) + timedelta(days=2))}))
        ventas += 1

    # Liquidación de la semana anterior (lunes a domingo), pagada
    lunes = hoy - timedelta(days=hoy.weekday() + 7)
    domingo = lunes + timedelta(days=6)
    liquidadas = _ok(client.post("/liquidaciones/lote", headers=adm, json={"desde": str(lunes), "hasta": str(domingo)}))
    for liq in liquidadas:
        _ok(client.post(f"/liquidaciones/{liq['liquidacion_id']}/pagar", headers=adm))

    # Gastos del mes
    categorias = {c["nombre"]: c["id"] for c in _ok(client.get("/categorias-gasto", headers=adm))}
    _ok(client.post("/gastos", headers=adm, json={"categoria_id": categorias["Combustible"], "monto": 45,
                                                   "descripcion": "Gasolina de la ruta", "acopiador_id": rosa["id"],
                                                   "fecha": str(hoy - timedelta(days=3))}))
    _ok(client.post("/gastos", headers=adm, json={"categoria_id": categorias["Servicios (luz, agua)"], "monto": 120,
                                                   "descripcion": "Luz de la planta", "fecha": str(hoy - timedelta(days=5))}))

    return {"hoy": hoy, "ruta": ruta["nombre"], "productores": [p["nombre"] for p in productores],
            "sancion": sancion["nombre"], "bloqueo": bloqueo["nombre"], "lejos": lejos["nombre"],
            "simulada": simulada["nombre"], "sin_gps": sin_gps["nombre"], "alta": alta["nombre"],
            "lotes": [l["codigo"] for l in lotes], "ventas": ventas, "liquidaciones": len(liquidadas),
            "periodo": (lunes, domingo)}


# ------------------------------------------------------------------ verificación con las vistas
def verificar(conn, carga: dict) -> list[str]:
    verificar_base(BASE_DEMO, base_actual(conn))
    fallas: list[str] = []
    q = lambda s, *a: conn.execute(s, a).fetchall()  # noqa: E731

    obs = {(f["nombre"], f["tipo"]) for f in q("""
        SELECT p.nombre, s.tipo::text AS tipo FROM sancion_productor s JOIN productor p ON p.id = s.productor_id
         WHERE s.levantada_en IS NULL AND s.desde = (now() AT TIME ZONE 'America/Lima')::date + 1""")}
    if (carga["sancion"], "precio") not in obs:
        fallas.append(f"Falta la sanción de precio de {carga['sancion']} desde mañana")
    if (carga["bloqueo"], "bloqueo") not in obs:
        fallas.append(f"Falta el bloqueo de {carga['bloqueo']} desde mañana")
    alertas = {f["tipo"]: f["n"] for f in q("SELECT tipo::text AS tipo, COUNT(*) AS n FROM alerta_recoleccion "
                                            "WHERE revisada_en IS NULL GROUP BY tipo")}
    for tipo in ("lejos_del_productor", "ubicacion_simulada", "sin_ubicacion"):
        if alertas.get(tipo, 0) < 1:
            fallas.append(f"Falta la alerta {tipo}")
    for tipo in ("firma_invalida", "hora_inconsistente"):
        if alertas.get(tipo, 0) > 0:
            fallas.append(f"No debería haber alertas {tipo} ({alertas[tipo]})")
    if q("SELECT 1 FROM v_recoleccion_sin_revisar"):
        fallas.append("Calidad debería quedar vacía")
    # Como se verá mañana (día de la demo): leche con disponible y más días que dias_max_leche
    if q("""SELECT 1 FROM v_leche_jornada WHERE litros_disponibles > 0
             AND (now() AT TIME ZONE 'America/Lima')::date + 1 - fecha
                 > (SELECT valor::int FROM configuracion WHERE clave = 'dias_max_leche')"""):
        fallas.append("Mañana habría leche sin destino")
    if not q("SELECT 1 FROM v_liquidacion_productor WHERE estado = 'pagado'"):
        fallas.append("Falta la liquidación pagada")
    if not q("SELECT 1 FROM v_lote_disponible WHERE NOT vencido"):
        fallas.append("Falta un lote con saldo para vender")
    if not q("SELECT 1 FROM productor WHERE NOT aprobado AND activo"):
        fallas.append("Falta el alta de campo pendiente")
    print("Alertas pendientes por tipo:", dict(sorted(alertas.items())))
    for f in q("SELECT mes, ingresos, egreso_leche, egreso_insumos, saldo_caja FROM v_flujo_mensual ORDER BY mes"):
        print(f"Flujo {f['mes']}: ingresos {f['ingresos']}, leche {f['egreso_leche']}, insumos {f['egreso_insumos']}, "
              f"saldo {f['saldo_caja']}")
    return fallas


# ------------------------------------------------------------------ principal
def main(argv: list[str] | None = None, conectar_fn=None) -> int:
    parser = argparse.ArgumentParser(description="Carga la base de demostración queseria_demo")
    parser.add_argument("--base", required=True)
    parser.add_argument("--fase", choices=("listar", "todo"), default="listar")
    parser.add_argument("--semilla", type=int, default=2110)
    args = parser.parse_args(argv)
    try:
        verificar_base(args.base)                  # antes de abrir cualquier conexión
    except BaseNoPermitida as e:
        print(f"ALTO: {e}", file=sys.stderr)
        return 2
    conectar_fn = conectar_fn or conectar
    os.environ["PGDATABASE"] = BASE_DEMO           # la app (TestClient) se conecta a la demo

    try:
        with conectar_fn(BASE_DEMO) as conn:
            verificar_base(BASE_DEMO, base_actual(conn))
            if args.fase == "listar":
                listar(conn)
                return 0
            with conectar_fn(BASE_REAL, True) as real:
                antes_real = contar_tablas(real)
            limpiar(conn)
            from fastapi.testclient import TestClient

            from app.config import config
            config.cache_clear()
            from app.main import app
            with TestClient(app) as client:
                carga = cargar(client, conn, random.Random(args.semilla))
            fallas = verificar(conn, carga)
            with conectar_fn(BASE_REAL, True) as real:
                despues_real = contar_tablas(real)
            if despues_real != antes_real:
                fallas.append("¡La base queseria cambió durante la carga!")
            else:
                print(f"queseria sin cambios: {sum(antes_real.values())} filas en {len(antes_real)} tablas, antes y después.")
            print("Resumen:", {k: v for k, v in carga.items() if k != "hoy"})
            if fallas:
                print("VERIFICACIÓN CON FALLAS:\n  - " + "\n  - ".join(fallas), file=sys.stderr)
                return 1
            print("Verificación con las vistas: correcta.")
            return 0
    except (BaseNoPermitida, ConteoDistinto) as e:
        print(f"ALTO: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # backend\ para importar app
    sys.exit(main())
