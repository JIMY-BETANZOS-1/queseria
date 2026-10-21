"""Datos de demostración en la propia base "queseria": limpia lo transaccional y carga ~8 días realistas por la API.

TODOS los datos de "queseria" son ficticios y el dueño autorizó borrarlos y volver a cargarlos en ella misma (no se
crean otras bases). Guardia: solo corre contra "queseria", y solo si se pasa --confirmo-datos-ficticios y --dump con
un respaldo de pg_dump (formato custom, -Fc) de esa misma base hecho en los últimos 10 minutos. Para deshacer:
pg_restore --clean --if-exists --single-transaction de ese respaldo.

Uso (desde backend\\, ver los comandos completos en el reporte de la etapa):
    .\\.venv\\Scripts\\python.exe scripts\\demo\\cargar_demo.py --base queseria --confirmo-datos-ficticios ^
        --dump ..\\respaldos\\queseria-AAAAMMDD-HHMM.dump --fase listar      # no cambia nada (solo lectura)
    ... --fase todo

Fases de "todo":
  1. Revisión previa (antes de tocar nada): Juan Carlos con UN celular activo, rutas y productores esperados, hora.
  2. Limpieza en UNA transacción: TRUNCATE ... RESTART IDENTITY CASCADE de lo transaccional (no dispara los triggers
     de fila) y DELETE de lo de prueba ("PRUEBA…"). Antes del COMMIT se comparan los conteos de lo conservado con lo
     esperado y la huella del celular de Juan Carlos: si algo no cuadra, ROLLBACK.
  3. Carga por la API (TestClient en el mismo proceso): triggers, alertas y verificación de firma como en producción.
     Rosa Elena (acopiadora) y Edwin (analista) reciben un celular de demostración vinculado con código del admin y
     clave ECDSA P-256 generada aquí (su PIN cambia por uno al azar que no se muestra). Juan Carlos y su Realme no se
     tocan: sus entregas solo pueden venir del Realme, por eso la Ruta 1 no tiene historial.
  4. Verificación con las vistas y resumen con nombres y cifras.

Escenario ("opción B"): la Ruta 2 (de Juan Carlos) la cubre Rosa Elena 4 días (hoy-4 … hoy-1, PUT /rutas/{id}/acopiador)
y vuelve a Juan Carlos desde hoy. En esa cobertura Cirilo Ticona Larico entrega leche alterada ayer (sanción de precio
desde mañana) y Gregoria Calsin Quispe reincide (bloqueo desde mañana). La entrega en vivo de mañana la hace Juan
Carlos con Mario Quispe Mamani (Ruta 1, productor normal).

Sin endpoint en la API (se insertan por SQL con app.usuario_id del admin; los triggers de la base validan igual):
  * la primera alteración de Gregoria con calidad_en de hace 3 días (si no, la base no puede ver reincidencia hoy);
  * el lote en proceso (POST /produccion crea y cierra en un paso);
  * la baja de producto (no hay POST de bajas).
"""
import argparse
import base64
import math
import os
import random
import re
import secrets
import shutil
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = "queseria"
BANDERA = "--confirmo-datos-ficticios"
MAX_EDAD_DUMP = timedelta(minutes=10)
FIRMA_PG_DUMP = b"PGDMP"                 # cabecera del formato custom de pg_dump (-Fc), el que acepta pg_restore
LIMA = ZoneInfo("America/Lima")
HORA_MINIMA = time(9, 0)                 # las entregas de hoy terminan antes de las 09:00: nunca quedan "del futuro"

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
EDWIN = "Edwin Ramiro Huanca Ticona"
MARIO = "Mario Quispe Mamani"
CIRILO = "Cirilo Ticona Larico"
GREGORIA = "Gregoria Calsin Quispe"
PATRON_PRUEBA = "PRUEBA%"
DIAS_COBERTURA = 4
M_POR_GRADO = 111_320
PLANTA = (-15.6105, -69.9705)           # EJEMPLO: ubicación de la planta (entregas de externos)

# Producción diaria típica (L) por productor; el resto, al azar entre 12 y 38 -- EJEMPLO
LITROS_TIPICOS = {
    "Hilario Cahui Mamani": 28, "Martha Vilca Turpo": 16, "Benedicto Anccori Sucasaca": 40,
    "Sabina Machaca Ccopa": 11, "Florencio Laura Chura": 24, "Paulina Mamani Chambi": 25, CIRILO: 10,
    GREGORIA: 35, "Valentín Huarachi Cutipa": 20, "Lucía Pacompía Yucra": 14,
    "Agropecuaria Los Andes Huata S.R.L.": 120, "Nicolás Ccallo Mamani": 45,
}


class BaseNoPermitida(Exception):
    """Base, bandera o respaldo que no cumplen la guardia: no se hace nada."""


class ConteoDistinto(Exception):
    """Lo conservado no coincide con lo esperado: la transacción se deshace."""


@dataclass(frozen=True)
class Dump:
    """Lo que se sabe del archivo de respaldo (lo arma inspeccionar_dump; las pruebas lo construyen a mano)."""
    ruta: str
    existe: bool
    tamano: int = 0
    modificado: datetime | None = None   # con zona horaria
    cabecera: bytes = b""
    base: str | None = None              # "dbname" que declara pg_restore --list


# ------------------------------------------------------------------ guardias (puras, con pruebas)
def verificar_base(pedida: str, actual: str | None = None) -> None:
    """Solo "queseria", escrita exacta; y, si ya hay conexión, current_database() tiene que ser esa misma."""
    if pedida != BASE:
        raise BaseNoPermitida(f"Este script solo corre contra '{BASE}' (se pidió '{pedida}')")
    if actual is not None and actual != BASE:
        raise BaseNoPermitida(f"La conexión apunta a '{actual}', no a '{BASE}': no se hace nada")


def revisar_permiso(confirmo: bool, dump: Dump | None, ahora: datetime) -> None:
    """Bandera explícita y un respaldo -Fc de "queseria" con no más de 10 minutos."""
    if not confirmo:
        raise BaseNoPermitida(f"Falta la bandera {BANDERA}: este script borra y vuelve a cargar '{BASE}'")
    if dump is None:
        raise BaseNoPermitida("Falta --dump con el respaldo de pg_dump hecho justo antes")
    if not dump.existe:
        raise BaseNoPermitida(f"No existe el respaldo {dump.ruta}")
    if dump.tamano <= 0:
        raise BaseNoPermitida(f"El respaldo {dump.ruta} está vacío")
    if not dump.cabecera.startswith(FIRMA_PG_DUMP):
        raise BaseNoPermitida(f"{dump.ruta} no es un respaldo de pg_dump en formato custom (-Fc): pg_restore no podría "
                              "deshacer la carga")
    if dump.base != BASE:
        raise BaseNoPermitida(f"El respaldo {dump.ruta} es de la base '{dump.base}', no de '{BASE}'")
    edad = ahora - dump.modificado
    if edad < -timedelta(minutes=1):
        raise BaseNoPermitida(f"La fecha del respaldo {dump.ruta} está en el futuro: no se puede confiar en ella")
    if edad > MAX_EDAD_DUMP:
        minutos = int(edad.total_seconds() // 60)
        raise BaseNoPermitida(f"El respaldo {dump.ruta} tiene {minutos} minutos; haga uno nuevo (máximo "
                              f"{int(MAX_EDAD_DUMP.total_seconds() // 60)})")


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


# ------------------------------------------------------------------ respaldo
def inspeccionar_dump(ruta: str) -> Dump:
    """Lee tamaño, fecha y cabecera del archivo, y la base que declara su índice (pg_restore --list)."""
    p = Path(ruta)
    if not p.is_file():
        return Dump(ruta, False)
    st = p.stat()
    with p.open("rb") as f:
        cabecera = f.read(len(FIRMA_PG_DUMP))
    base = None
    pg_restore = shutil.which("pg_restore")
    if cabecera.startswith(FIRMA_PG_DUMP) and pg_restore:
        lista = subprocess.run([pg_restore, "--list", str(p)], capture_output=True, text=True, timeout=120,
                               encoding="utf-8", errors="replace")
        m = re.search(r"^;\s*dbname:\s*(\S+)\s*$", lista.stdout, re.MULTILINE | re.IGNORECASE)
        base = m.group(1) if m else None
    return Dump(ruta, True, st.st_size, datetime.fromtimestamp(st.st_mtime, timezone.utc), cabecera, base)


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
        SELECT u.id AS usuario_id, d.id AS dispositivo_id, d.modelo, md5(COALESCE(d.clave_publica, '')) AS huella
          FROM usuario u JOIN dispositivo d ON d.usuario_id = u.id AND d.activo
         WHERE u.nombre_completo = %s AND u.rol = 'acopiador' AND u.activo
    """, (JUAN_CARLOS,)).fetchall()
    if len(filas) != 1:
        raise BaseNoPermitida(f"Se esperaba exactamente un {JUAN_CARLOS} con celular activo; hay {len(filas)}")
    return filas[0]


def _uno(conn, consulta: str, params, que: str) -> dict:
    filas = conn.execute(consulta, params).fetchall()
    if len(filas) != 1:
        raise BaseNoPermitida(f"Se esperaba exactamente {que}; hay {len(filas)}")
    return filas[0]


def escenario(conn) -> dict:
    """Revisión previa del escenario: si algo no está como se espera, ALTO antes de tocar nada."""
    ahora = conn.execute("SELECT (now() AT TIME ZONE 'America/Lima') AS a").fetchone()["a"]
    if ahora.time() < HORA_MINIMA:
        raise BaseNoPermitida(f"Son las {ahora:%H:%M} en Lima: corra la carga desde las {HORA_MINIMA:%H:%M} (las "
                              "entregas de hoy van hasta las 08:45 y no pueden quedar con hora futura)")
    hoy = ahora.date()
    usuario = "SELECT id, dni, celular FROM usuario WHERE nombre_completo = %s AND rol = %s AND activo"
    rosa = _uno(conn, usuario, (ROSA, "acopiador"), f"una acopiadora activa {ROSA}")
    edwin = _uno(conn, usuario, (EDWIN, "analista"), f"un analista activo {EDWIN}")
    prod = """SELECT p.id, p.nombre, p.ruta_id, ra.acopiador_id, ra.vigente_desde
                FROM productor p JOIN ruta r ON r.id = p.ruta_id AND r.activa
                JOIN ruta_acopiador ra ON ra.ruta_id = p.ruta_id AND ra.vigente_hasta IS NULL
               WHERE p.nombre = %s AND p.tipo = 'de_ruta' AND p.activo AND p.aprobado AND p.latitud_ref IS NOT NULL"""
    mario = _uno(conn, prod, (MARIO,), f"un {MARIO} activo, aprobado y con referencia GPS en una ruta asignada")
    cirilo = _uno(conn, prod, (CIRILO,), f"un {CIRILO} activo, aprobado y con referencia GPS en una ruta asignada")
    gregoria = _uno(conn, prod, (GREGORIA,), f"una {GREGORIA} activa, aprobada y con referencia GPS en una ruta asignada")
    jc = juan_carlos(conn)
    if cirilo["ruta_id"] != gregoria["ruta_id"] or cirilo["ruta_id"] == mario["ruta_id"]:
        raise BaseNoPermitida(f"{CIRILO} y {GREGORIA} deben estar en la misma ruta (la 2) y {MARIO} en otra (la 1)")
    for p in (mario, cirilo):
        if p["acopiador_id"] != jc["usuario_id"]:
            raise BaseNoPermitida(f"La ruta de {p['nombre']} no está asignada hoy a {JUAN_CARLOS}")
    if cirilo["vigente_desde"] > hoy - timedelta(days=DIAS_COBERTURA):
        raise BaseNoPermitida(f"{JUAN_CARLOS} tiene la ruta de {CIRILO} solo desde {cirilo['vigente_desde']}: la "
                              f"cobertura de {DIAS_COBERTURA} días no cabe (¿ya se cargó hoy? restaure el respaldo)")
    ruta3 = conn.execute("""SELECT r.id, r.nombre FROM ruta r JOIN ruta_acopiador ra ON ra.ruta_id = r.id
                             WHERE ra.acopiador_id = %s AND ra.vigente_hasta IS NULL AND r.activa ORDER BY r.id""",
                         (rosa["id"],)).fetchall()
    if len(ruta3) != 1:
        raise BaseNoPermitida(f"{ROSA} debe tener exactamente una ruta vigente; tiene {len(ruta3)}")
    externos = conn.execute("""SELECT id, nombre FROM productor WHERE tipo = 'externo' AND activo AND aprobado
                                 AND nombre NOT ILIKE %s ORDER BY id""", (PATRON_PRUEBA,)).fetchall()
    if len(externos) < 2:
        raise BaseNoPermitida(f"Se esperaban al menos 2 productores externos activos; hay {len(externos)}")
    return {"hoy": hoy, "jc": jc, "rosa": rosa, "edwin": edwin, "mario": mario, "cirilo": cirilo,
            "gregoria": gregoria, "ruta1": mario["ruta_id"], "ruta2": cirilo["ruta_id"], "ruta3": ruta3[0],
            "externos": externos}


def listar(conn) -> dict:
    verificar_base(BASE, base_actual(conn))
    alcance = alcance_truncate(conn, TRUNCAR)
    revisar_alcance(alcance, set(TRUNCAR))
    esc = escenario(conn)
    conteos = contar_tablas(conn)
    print("TRUNCATE ... CASCADE vaciaría (filas actuales):")
    for t in sorted(alcance):
        print(f"  - {t}: {conteos.get(t, 0)}")
    prueba = de_prueba(conn)
    print("De prueba (se borran):")
    for clave, filas in prueba.items():
        print(f"  {clave}: " + (", ".join(f"{f['id']} {f.get('nombre') or f.get('nombre_completo')}" for f in filas) or "ninguno"))
    jc = esc["jc"]
    print(f"Se conserva {JUAN_CARLOS} (usuario {jc['usuario_id']}) con su celular activo "
          f"(dispositivo {jc['dispositivo_id']}, {jc['modelo']}).")
    print(f"Escenario listo: hoy {esc['hoy']}, ruta de {CIRILO} y {GREGORIA} = {esc['ruta2']}, ruta de {MARIO} = "
          f"{esc['ruta1']}, ruta de {ROSA} = {esc['ruta3']['nombre']}.")
    print(f"Se vinculará un celular de demostración a {ROSA} y a {EDWIN} (su PIN actual deja de servir).")
    return {"conteos": conteos, "prueba": prueba, "juan_carlos": jc}


# ------------------------------------------------------------------ fase de limpieza
def limpiar(conn) -> None:
    """Una sola transacción; ROLLBACK si algo no cuadra."""
    from psycopg import sql

    with conn.transaction():
        verificar_base(BASE, base_actual(conn))
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

        verificar_base(BASE, base_actual(conn))
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
    """Celular de demostración: clave ECDSA P-256 propia y cadena hash_anterior (SHA-256 de la firma anterior)."""

    def __init__(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        self.privada = ec.generate_private_key(ec.SECP256R1())
        self.publica = base64.b64encode(self.privada.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).decode()
        self.hash_anterior: str | None = None
        self.cab: dict | None = None

    def firmar(self, item: dict) -> dict:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec

        from app.esquemas.sync import RecoleccionPush
        from app.firma import cadena_canonica, hash_de_firma

        item = {**item, "hash_anterior": self.hash_anterior}
        cadena = cadena_canonica(RecoleccionPush.model_validate(item))
        firma = base64.b64encode(self.privada.sign(cadena.encode(), ec.ECDSA(hashes.SHA256()))).decode()
        self.hash_anterior = hash_de_firma(firma)
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


def _vincular(client, adm: dict, usuario: dict) -> Movil:
    """Código del admin + clave propia + PIN al azar que no se muestra (como lo haría la app)."""
    movil = Movil()
    codigo = _ok(client.post(f"/usuarios/{usuario['id']}/codigo-activacion", headers=adm))["codigo"]
    act = _ok(client.post("/auth/dispositivo/activar", json={
        "codigo": codigo, "device_uuid": str(uuid.uuid4()), "clave_publica": movil.publica,
        "modelo": "Celular de demostración", "pin": _pin_valido(usuario["dni"], usuario["celular"])}))
    movil.cab = {"Authorization": f"Bearer {act['access_token']}"}
    return movil


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _entrega(p: dict, hora: datetime, litros: float, rng: random.Random, *, lat=None, lon=None,
             simulada=False, sin_gps=False, uuid_cliente: str | None = None) -> dict:
    """Recolección sin firmar, alrededor de la referencia del productor (o en la posición indicada)."""
    if sin_gps:
        ubic = {"latitud": None, "longitud": None, "precision_m": None, "origen_ubicacion": "ninguna"}
    else:
        if lat is None:
            lat, lon = alrededor(p["lat"], p["lon"], rng)
        ubic = {"latitud": round(lat, 6), "longitud": round(lon, 6), "precision_m": round(rng.uniform(4, 12), 1),
                "origen_ubicacion": "gps"}
    quien = {"productor_uuid_cliente": uuid_cliente} if uuid_cliente else {"productor_id": p["id"]}
    return {"id": str(uuid.uuid4()), **quien, "litros": round(litros, 2), "registrada_en": _utc(hora),
            "hora_gps": None if sin_gps else _utc(hora), "hora_automatica": True, "ubicacion_simulada": simulada,
            **ubic}


def _push(client, movil: Movil, productores: list[dict], items: list[dict], dia: date) -> None:
    firmados = [movil.firmar(it) for it in items]
    items[:] = firmados
    resultado = _ok(client.post("/sync/push", headers=movil.cab, json={"productores": productores,
                                                                      "recolecciones": firmados}))
    malos = [x for x in resultado["productores"] + resultado["recolecciones"] if x["estado"] != "creado"]
    if malos:
        raise RuntimeError(f"Push del {dia} con ítems no creados: {malos}")


def cargar(client, conn, rng: random.Random, esc: dict) -> dict:
    """Una semana y un día de trabajo (hoy-7 … hoy) con las situaciones de la demostración."""
    from app import seguridad

    verificar_base(BASE, base_actual(conn))
    hoy = esc["hoy"]
    d = lambda n: hoy - timedelta(days=n)  # noqa: E731
    admin_id = conn.execute("SELECT id FROM usuario WHERE rol = 'admin' AND activo ORDER BY id LIMIT 1").fetchone()["id"]
    adm = {"Authorization": f"Bearer {seguridad.crear_token(admin_id, 'admin', 120)}"}   # no se imprime
    verificar_base(BASE, _ok(client.get("/salud"))["base"])
    jc_id, rosa, edwin = esc["jc"]["usuario_id"], esc["rosa"], esc["edwin"]
    r2, r3 = esc["ruta2"], esc["ruta3"]["id"]

    def de_ruta(ruta_id: int) -> list[dict]:
        filas = conn.execute("""SELECT id, nombre, latitud_ref::float AS lat, longitud_ref::float AS lon FROM productor
                                 WHERE ruta_id = %s AND activo AND aprobado AND latitud_ref IS NOT NULL ORDER BY id""",
                             (ruta_id,)).fetchall()
        if len(filas) < 5:
            raise RuntimeError(f"La ruta {ruta_id} necesita al menos 5 productores con referencia GPS")
        return filas

    ruta2, ruta3 = de_ruta(r2), de_ruta(r3)
    por_nombre = {p["nombre"]: p for p in ruta2}
    cirilo, gregoria = por_nombre[CIRILO], por_nombre[GREGORIA]
    externos = [dict(e) for e in esc["externos"][:2]]
    tipico = {p["nombre"]: LITROS_TIPICOS.get(p["nombre"]) or rng.uniform(12, 38) for p in ruta2 + ruta3 + externos}

    # Celulares de demostración (Juan Carlos y su Realme no se tocan)
    m_rosa, m_edwin = _vincular(client, adm, rosa), _vincular(client, adm, edwin)

    # Compras de insumos: la grande de la quincena y una reposición
    insumos = {f["nombre"]: f["insumo_id"] for f in _ok(client.get("/insumos", headers=adm))}
    compras = [
        (d(9), "Compra de la quincena", {"Cuajo líquido": (2000, 0.08), "Cloruro de calcio": (4000, 0.015),
                                         "Sal": (50, 1.5), "Cultivo láctico mesófilo": (400, 0.9),
                                         "Cultivo para yogurt": (300, 1.2), "Azúcar": (60, 3.8),
                                         "Envase de yogurt 1 kg": (400, 0.8), "Bolsa para queso": (600, 0.15)}),
        (d(3), "Reposición", {"Sal": (25, 1.6), "Azúcar": (40, 3.9), "Envase de yogurt 1 kg": (300, 0.82),
                              "Bolsa para queso": (500, 0.15)}),
    ]
    n_compras = 0
    for fecha, nota, lista in compras:
        for nombre, (cantidad, costo) in lista.items():
            if nombre in insumos:
                _ok(client.post(f"/insumos/{insumos[nombre]}/ingresos", headers=adm, json={
                    "cantidad": cantidad, "costo_unitario": costo, "fecha": str(fecha), "nota": nota}))
                n_compras += 1

    # Cobertura: Rosa Elena toma la Ruta 2 desde hoy-4 (la devuelve hoy, después de cargar sus entregas)
    _ok(client.put(f"/rutas/{r2}/acopiador", headers=adm, json={"acopiador_id": rosa["id"], "desde": str(d(DIAS_COBERTURA))}))

    # Situaciones puntuales
    hilario, martha, benedicto, sabina, florencio = ruta3[:5]
    valentin = por_nombre.get("Valentín Huarachi Cutipa") or ruta2[3]
    alta = {"uuid_cliente": str(uuid.uuid4()), "nombre": "Saturnina Ccori Huanca", "ruta_id": r3}
    nuevo_ext = {"uuid_cliente": str(uuid.uuid4()), "nombre": "Marcelino Yupanqui Coila", "documento": "40111217",
                 "celular": "955200003"}
    anular: list[tuple[str, str]] = []           # (id, motivo)
    revisar_alerta: list[tuple[str, str, str]] = []   # (id, tipo, resolución)
    sin_revisar: set[str] = set()
    alteradas: dict[str, dict] = {}              # nombre -> entrega de ayer (Cirilo y Gregoria)
    primera_gregoria: dict | None = None
    todas: dict[date, list[dict]] = {}
    n_anuladas = 0

    for n in range(7, -1, -1):
        dia = d(n)
        hora = datetime.combine(dia, time(6, 0), LIMA)
        items: list[dict] = []
        altas: list[dict] = []
        # Rosa Elena: su Ruta 3 todos los días
        for p in ruta3:
            hora += timedelta(minutes=rng.randint(14, 22))
            litros = tipico[p["nombre"]] * rng.uniform(0.9, 1.1)
            if n == 0 and p is hilario:                                   # a ~500 m de su referencia
                items.append(_entrega(p, hora, litros, rng, lat=p["lat"] + 500 / M_POR_GRADO, lon=p["lon"]))
            elif n == 0 and p is benedicto:                               # muy por debajo de lo habitual
                items.append(_entrega(p, hora, 9.0, rng))
                sin_revisar.add(items[-1]["id"])
            elif n == 1 and p is sabina:
                items.append(_entrega(p, hora, litros, rng, simulada=True))
            elif n == 2 and p is florencio:
                items.append(_entrega(p, hora, litros, rng, sin_gps=True))
            elif n == 5 and p is hilario:                                 # mal digitado, se anula y se corrige
                items.append(_entrega(p, hora, litros * 10, rng))
                anular.append((items[-1]["id"], "Litros mal digitados (se registró de nuevo)"))
                hora += timedelta(minutes=3)
                items.append(_entrega(p, hora, litros, rng))
            else:
                items.append(_entrega(p, hora, litros, rng))
            if n == 0 and p is martha:                                    # doble toque: mismo productor y litros
                hora += timedelta(minutes=4)
                items.append(_entrega(p, hora, items[-1]["litros"], rng))
                sin_revisar.add(items[-1]["id"])
            if n == 0 and p is florencio:
                sin_revisar.add(items[-1]["id"])
        if n == 0:                                                        # alta de campo, con su entrega (retenida)
            hora += timedelta(minutes=15)
            lat, lon = alrededor(benedicto["lat"] + 0.0012, benedicto["lon"] + 0.0010, rng)
            items.append(_entrega(None, hora, 9.5, rng, lat=lat, lon=lon, uuid_cliente=alta["uuid_cliente"]))
            altas.append(alta)
        # Rosa Elena cubre la Ruta 2 de hoy-4 a hoy-1
        if 1 <= n <= DIAS_COBERTURA:
            hora += timedelta(minutes=25)
            for p in ruta2:
                hora += timedelta(minutes=rng.randint(14, 22))
                items.append(_entrega(p, hora, tipico[p["nombre"]] * rng.uniform(0.9, 1.1), rng))
                if n == 1 and p in (cirilo, gregoria):
                    alteradas[p["nombre"]] = items[-1]
                if n == DIAS_COBERTURA and p is gregoria:
                    primera_gregoria = items[-1]
                if n == 3 and p is valentin:                              # doble toque, se anula
                    hora += timedelta(minutes=5)
                    items.append(_entrega(p, hora, items[-1]["litros"], rng))
                    anular.append((items[-1]["id"], "Registro duplicado (doble toque)"))
                    revisar_alerta.append((items[-1]["id"], "posible_duplicado", "Era un duplicado: se anuló"))
        _push(client, m_rosa, altas, items, dia)
        todas[dia] = items
        # El admin anula el mismo día (antes de liquidar, y para que lo anulado no cuente en el promedio del productor)
        for rid, motivo in anular[n_anuladas:]:
            _ok(client.post(f"/recolecciones/{rid}/anular", headers=adm, json={"motivo": motivo}))
        n_anuladas = len(anular)

        # Edwin (analista) recibe externos en planta: día por medio cada uno; el nuevo, desde hoy-5
        ext_items, ext_altas = [], []
        hora = datetime.combine(dia, time(8, 30), LIMA)
        a, b = externos
        if n % 2 == 1:
            ext_items.append(_entrega(a, hora, tipico[a["nombre"]] * rng.uniform(0.9, 1.1), rng, lat=PLANTA[0], lon=PLANTA[1]))
        else:
            ext_items.append(_entrega(b, hora + timedelta(minutes=10), tipico[b["nombre"]] * rng.uniform(0.9, 1.1), rng,
                                      lat=PLANTA[0], lon=PLANTA[1]))
            if n == 0:
                sin_revisar.add(ext_items[-1]["id"])
        if n in (5, 3, 1):
            ext_items.append(_entrega(None, hora + timedelta(minutes=15), 30 * rng.uniform(0.9, 1.1), rng,
                                      lat=PLANTA[0], lon=PLANTA[1], uuid_cliente=nuevo_ext["uuid_cliente"]))
            if n == 5:
                ext_altas.append(nuevo_ext)
        _push(client, m_edwin, ext_altas, ext_items, dia)
        todas[dia] += ext_items

    # Rosa Elena devuelve la Ruta 2 a Juan Carlos desde hoy
    _ok(client.put(f"/rutas/{r2}/acopiador", headers=adm, json={"acopiador_id": jc_id, "desde": str(hoy)}))

    # La alerta del duplicado anulado queda revisada
    for rid, tipo, resolucion in revisar_alerta:
        alerta = next(a for a in _ok(client.get(f"/alertas?recoleccion_id={rid}", headers=adm)) if a["tipo"] == tipo)
        _ok(client.post(f"/alertas/{alerta['id']}/revisar", headers=adm, json={"resolucion": resolucion}))

    # Calidad (Edwin, /sync/calidad): todo normal salvo lo que queda por revisar y las tres alteraciones
    apartadas = {rid for rid, _ in anular} | sin_revisar | {e["id"] for e in alteradas.values()} | {primera_gregoria["id"]}
    revisiones = [{"recoleccion_id": it["id"]} for items in todas.values() for it in items if it["id"] not in apartadas]
    resp = _ok(client.post("/sync/calidad", headers=m_edwin.cab, json={"revisiones": revisiones}))
    malas = [x for x in resp["revisiones"] if x["estado"] != "creado"]
    if malas:
        raise RuntimeError(f"Revisiones no creadas: {malas}")

    # Sin endpoint: la primera alteración de Gregoria se marca con calidad_en de hace 3 días (su análisis primero; la
    # base crea la sanción de precio y, con la segunda alteración de hoy, decide ella misma el bloqueo)
    verificar_base(BASE, base_actual(conn))
    with conn.transaction():
        conn.execute("SELECT set_config('app.usuario_id', %s, true)", (str(edwin["id"]),))
        conn.execute("INSERT INTO analisis_calidad (recoleccion_id, ph, temperatura_c, densidad, antibioticos_positivo) "
                     "VALUES (%s, 6.2, 9.5, 1.025, false)", (primera_gregoria["id"],))
        conn.execute("""UPDATE recoleccion SET estado_calidad = 'alterado', calidad_por = %s,
                               calidad_en = (((now() AT TIME ZONE 'America/Lima')::date - 3) + time '09:40') AT TIME ZONE 'America/Lima'
                         WHERE id = %s""", (edwin["id"], primera_gregoria["id"]))
    # Hoy, por la API: Cirilo (primera vez → sanción de precio) y Gregoria (reincidencia → bloqueo), ambos desde mañana
    analisis = {CIRILO: {"ph": 6.4, "temperatura_c": 11.0, "densidad": 1.027, "antibioticos_positivo": False},
                GREGORIA: {"ph": 6.3, "temperatura_c": 10.5, "densidad": 1.024, "antibioticos_positivo": True}}
    resp = _ok(client.post("/sync/calidad", headers=m_edwin.cab, json={"revisiones": [
        {"recoleccion_id": alteradas[nombre]["id"], "estado": "alterado", **analisis[nombre]} for nombre in (CIRILO, GREGORIA)]}))
    sanciones = {nombre: x["sancion"] for nombre, x in zip((CIRILO, GREGORIA), resp["revisiones"])}

    # Producción diaria con la leche aprobada hasta ayer (si no, mañana quedaría "sin destino"); una merma antes
    recetas = {r["nombre"]: r for r in _ok(client.get("/recetas", headers=adm))}
    turno = ["Queso paria", "Queso pasteurizado", "Queso paria", "Yogurt", "Queso paria", "Queso pasteurizado",
             "Queso fresco"]
    lotes, merma = [], None
    for k, dia in enumerate(d(n) for n in range(7, 0, -1)):
        if dia == d(2):
            merma = _ok(client.post("/mermas", headers=adm, json={
                "fecha": str(dia), "litros": 8.5, "motivo": "Leche cortada en un porongo (acidez alta)"}))
        jornada = conn.execute("SELECT litros_disponibles::float AS l FROM v_leche_jornada WHERE fecha = %s", (dia,)).fetchone()
        litros = round(jornada["l"], 2) if jornada else 0
        if litros <= 0:
            continue
        receta = recetas.get(turno[k % len(turno)]) or recetas["Queso paria"]
        teorico = litros / float(receta["litros_base"]) * float(receta["rendimiento_base"] or 10)
        lotes.append(_ok(client.post("/produccion", headers=adm, json={
            "receta_id": receta["id"], "fecha_leche": str(dia), "litros": litros,
            "cantidad_producida": round(teorico * rng.uniform(0.94, 1.0), 0 if receta["unidad_venta"] == "unidad" else 1),
            "fecha_produccion": str(dia)})))

    # Ventas al contado: el primer lote se vende completo; otros, en parte
    clientes = [_ok(client.post("/clientes", headers=adm, json=c)) for c in (
        {"nombre": "Bodega San Martín"}, {"nombre": "Minimarket Lucía"},
        {"nombre": "Restaurante El Lago", "tipo": "empresa"}, {"nombre": "Feria dominical de Huata"})]
    ventas: list[dict] = []

    def vender(lote: dict, cantidad: float, dias_despues: int, cliente: dict) -> None:
        fecha = min(date.fromisoformat(str(lote["fecha_produccion"])) + timedelta(days=dias_despues), hoy)
        ventas.append(_ok(client.post("/ventas", headers=adm, json={
            "cliente_id": cliente["id"], "lote_id": lote["lote_id"], "cantidad": cantidad,
            "precio_unitario": float(recetas[lote["receta"]]["precio_venta"] or 20), "fecha": str(fecha)})))

    primero = lotes[0]
    mitad = math.floor(float(primero["cantidad_producida"]) / 2)
    vender(primero, mitad, 1, clientes[0])
    vender(primero, float(primero["cantidad_producida"]) - mitad, 3, clientes[2])
    for k, lote in enumerate(lotes[1:4], start=1):
        cant = float(lote["cantidad_producida"]) * 0.5
        vender(lote, math.floor(cant) if recetas[lote["receta"]]["unidad_venta"] == "unidad" else round(cant, 1),
               2, clientes[k % len(clientes)])
    vender(lotes[2], 4, 3, clientes[3])

    # Sin endpoint: baja de producto (2 quesos rajados al desmoldar) en el segundo lote
    verificar_base(BASE, base_actual(conn))
    with conn.transaction():
        conn.execute("SELECT set_config('app.usuario_id', %s, true)", (str(admin_id),))
        conn.execute("""INSERT INTO baja_producto (lote_id, cantidad, motivo, fecha, nota, registrado_por)
                        VALUES (%s, 2, 'merma', %s, 'Quesos rajados al desmoldar', %s)""",
                     (lotes[1]["lote_id"], lotes[1]["fecha_produccion"], admin_id))

    # Sin endpoint: lote en proceso con parte de la leche aprobada de hoy (mismo orden que POST /produccion, sin cerrar)
    disponible_hoy = conn.execute("SELECT fn_leche_disponible(%s)::float AS l", (hoy,)).fetchone()["l"]
    litros_proceso = round(disponible_hoy * 0.6, 2)
    receta_proceso = recetas["Queso paria"]
    with conn.transaction():
        conn.execute("SELECT set_config('app.usuario_id', %s, true)", (str(admin_id),))
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('lote_codigo'), %s)", (hoy.year,))
        prefijo = f"L-{hoy.year}-"
        ultimo = conn.execute("SELECT COALESCE(MAX(substring(codigo FROM %s)::int), 0) AS n FROM lote_produccion "
                              "WHERE codigo ~ %s", (f"^{prefijo}(\\d+)$", f"^{prefijo}\\d+$")).fetchone()["n"]
        en_proceso = conn.execute("""INSERT INTO lote_produccion (codigo, receta_id, fecha_produccion, creado_por)
                                     VALUES (%s, %s, %s, %s) RETURNING id, codigo""",
                                  (f"{prefijo}{ultimo + 1:04d}", receta_proceso["id"], hoy, admin_id)).fetchone()
        conn.execute("INSERT INTO lote_leche (lote_id, fecha, litros, costo_litro) VALUES (%s, %s, %s, 0)",
                     (en_proceso["id"], hoy, litros_proceso))
        conn.execute("""INSERT INTO movimiento_insumo (insumo_id, tipo, cantidad, lote_id, usuario_id, nota)
                        SELECT ri.insumo_id, 'consumo_lote', -round(ri.cantidad * %s::numeric / r.litros_base, 3), %s, %s,
                               'Consumo sugerido por la receta'
                          FROM receta r JOIN receta_insumo ri ON ri.receta_id = r.id
                         WHERE r.id = %s AND round(ri.cantidad * %s::numeric / r.litros_base, 3) > 0""",
                     (litros_proceso, en_proceso["id"], admin_id, receta_proceso["id"], litros_proceso))

    # Liquidaciones: la semana pasada (lunes a domingo) pagada; esta semana hasta ayer, pendiente
    lunes = hoy - timedelta(days=hoy.weekday())
    pasada = (lunes - timedelta(days=7), lunes - timedelta(days=1))
    pagadas = _ok(client.post("/liquidaciones/lote", headers=adm, json={"desde": str(pasada[0]), "hasta": str(pasada[1])}))
    for liq in pagadas:
        _ok(client.post(f"/liquidaciones/{liq['liquidacion_id']}/pagar", headers=adm))
    pendientes = []
    if d(1) >= lunes:
        pendientes = _ok(client.post("/liquidaciones/lote", headers=adm, json={"desde": str(lunes), "hasta": str(d(1))}))

    # Sueldo del mes pasado de Rosa Elena, registrado y pagado (genera su gasto "Sueldo acopiador")
    mes_pasado = (hoy.replace(day=1) - timedelta(days=1)).replace(day=1)
    pago = _ok(client.post("/pagos/acopiadores", headers=adm, json={
        "acopiador_id": rosa["id"], "mes": str(mes_pasado), "nota": "Sueldo de " + mes_pasado.strftime("%m/%Y")}))
    pago = _ok(client.post(f"/pagos/acopiadores/{pago['id']}/pagar", headers=adm))

    # Gastos variados
    cat = {c["nombre"]: c["id"] for c in _ok(client.get("/categorias-gasto", headers=adm))}
    gastos = [
        ("Alquiler", 600, "Alquiler del local (mes en curso)", None, hoy.replace(day=1)),
        ("Combustible", 45, "Gasolina de la Ruta 3", rosa["id"], d(6)),
        ("Combustible", 50, "Gasolina de las Rutas 1 y 2", jc_id, d(2)),
        ("Servicios (luz, agua)", 120, "Luz de la planta", None, d(5)),
        ("Mantenimiento", 85, "Empaquetadura de la tina de cuajado", None, d(4)),
        ("Empaque y etiquetas", 60, "Etiquetas de yogurt", None, d(3)),
        ("Otros", 35, "Útiles de limpieza", None, d(1)),
    ]
    for nombre, monto, desc, acop, fecha in gastos:
        if nombre in cat:
            _ok(client.post("/gastos", headers=adm, json={"categoria_id": cat[nombre], "monto": monto, "descripcion": desc,
                                                          "acopiador_id": acop, "fecha": str(fecha)}))

    return {"hoy": hoy, "sanciones": sanciones, "lotes": [l["codigo"] for l in lotes], "lote_en_proceso": en_proceso["codigo"],
            "litros_en_proceso": litros_proceso, "merma_litros": merma and merma["litros"], "ventas": len(ventas),
            "liquidaciones_pagadas": len(pagadas), "liquidaciones_pendientes": len(pendientes),
            "pago_acopiador": float(pago["total"]), "compras": n_compras, "anuladas": len(anular),
            "alta": alta["nombre"], "nuevo_externo": nuevo_ext["nombre"], "semana_pagada": pasada}


# ------------------------------------------------------------------ cifras para el guion
def cifras_guion(conn) -> None:
    """Nombres y montos reales de la carga (de las vistas) para completar el guion y la hoja de ensayo."""
    q = lambda s: conn.execute(s).fetchall()  # noqa: E731
    print("\n===== Cifras para el guion =====")
    for f in q("""SELECT nombre, ruta, tipo_sancion, estado, sancion_desde, sancion_hasta, ph, densidad,
                         antibioticos_positivo FROM v_productor_observado ORDER BY nombre"""):
        print(f"Observado: {f['nombre']} ({f['ruta']}): {f['tipo_sancion']} {f['sancion_desde']}…{f['sancion_hasta']}, "
              f"estado {f['estado']}; pH {f['ph']}, densidad {f['densidad']}, antibióticos {f['antibioticos_positivo']}")
    for f in q("""SELECT a.tipo::text AS tipo, d.fecha, d.productor, d.litros, a.detalle FROM alerta_recoleccion a
                    JOIN v_recoleccion_detalle d ON d.recoleccion_id = a.recoleccion_id
                   WHERE a.revisada_en IS NULL ORDER BY a.tipo, d.fecha"""):
        print(f"Alerta {f['tipo']}: {f['productor']} ({f['fecha']}, {f['litros']} L) — {f['detalle']}")
    for f in q("SELECT productor, litros FROM v_recoleccion_sin_revisar ORDER BY registrada_en"):
        print(f"Por revisar: {f['productor']} {f['litros']} L")
    for f in q("""SELECT codigo, receta, fecha_produccion, estado::text AS estado, litros_leche, cantidad_producida,
                         cantidad_vendida, cantidad_baja, saldo, ingresos, costo_por_unidad, utilidad_realizada
                    FROM v_lote_resumen ORDER BY fecha_produccion, codigo"""):
        print(f"Lote {f['codigo']} {f['receta']} {f['fecha_produccion']} [{f['estado']}]: {f['litros_leche']} L → "
              f"{f['cantidad_producida']}; vendido {f['cantidad_vendida']}, baja {f['cantidad_baja']}, saldo {f['saldo']}; "
              f"ingresos S/ {f['ingresos']}, costo/u S/ {f['costo_por_unidad']}, utilidad S/ {f['utilidad_realizada']}")
    for f in q("""SELECT c.nombre, COUNT(*) AS n, SUM(d.subtotal) AS total FROM venta v JOIN cliente c ON c.id = v.cliente_id
                    JOIN venta_detalle d ON d.venta_id = v.id GROUP BY 1 ORDER BY 1"""):
        print(f"Ventas a {f['nombre']}: {f['n']} por S/ {f['total']}")
    for f in q("""SELECT estado::text AS estado, desde, hasta, COUNT(*) AS n, SUM(litros) AS litros, SUM(monto) AS monto,
                         SUM(descuento_sancion) AS descuento FROM v_liquidacion_productor GROUP BY 1, 2, 3 ORDER BY 2"""):
        print(f"Liquidaciones {f['estado']} {f['desde']}…{f['hasta']}: {f['n']} productores, {f['litros']} L, "
              f"S/ {f['monto']} (descuento por sanción S/ {f['descuento']})")
    for f in q("""SELECT p.nombre, pg.litros, pg.monto FROM v_recoleccion_pago pg JOIN productor p ON p.id = pg.productor_id
                   WHERE pg.retenida"""):
        print(f"Retenido: {f['nombre']} {f['litros']} L, S/ {f['monto']}")
    for f in q("SELECT * FROM v_leche_stock"):
        print(f"Leche: disponible {f['litros_disponibles']} L, por revisar {f['litros_por_revisar']} L, "
              f"descartada {f['litros_descartados']} L, merma {f['litros_merma']} L")
    for f in q("SELECT mes, ingresos, costo_ventas, perdida_producto, perdida_leche, gasto_operativo, utilidad_neta "
               "FROM v_resultado_mensual ORDER BY mes"):
        s = lambda x: f"{float(x):.2f}"  # noqa: E731
        print(f"Resultado {f['mes']}: ventas S/ {s(f['ingresos'])}, costo S/ {s(f['costo_ventas'])}, pérdidas S/ "
              f"{s(f['perdida_producto'] + f['perdida_leche'])}, gastos S/ {s(f['gasto_operativo'])}, "
              f"utilidad S/ {s(f['utilidad_neta'])}")
    print("================================\n")


# ------------------------------------------------------------------ verificación con las vistas
def verificar(conn, esc: dict) -> list[str]:
    verificar_base(BASE, base_actual(conn))
    fallas: list[str] = []
    q = lambda s, *a: conn.execute(s, a).fetchall()  # noqa: E731
    uno = lambda s, *a: conn.execute(s, a).fetchone()  # noqa: E731
    manana = "(now() AT TIME ZONE 'America/Lima')::date + 1"

    obs = {(f["nombre"], f["tipo"]) for f in q(f"""
        SELECT p.nombre, s.tipo::text AS tipo FROM sancion_productor s JOIN productor p ON p.id = s.productor_id
         WHERE s.levantada_en IS NULL AND s.desde = {manana}""")}
    if (CIRILO, "precio") not in obs:
        fallas.append(f"Falta la sanción de precio de {CIRILO} desde mañana")
    if (GREGORIA, "bloqueo") not in obs:
        fallas.append(f"Falta el bloqueo de {GREGORIA} desde mañana")
    if q("SELECT 1 FROM sancion_productor s JOIN productor p ON p.id = s.productor_id WHERE p.nombre = %s", MARIO):
        fallas.append(f"{MARIO} no debería tener sanciones")
    asig = q("""SELECT u.nombre_completo AS a, ra.vigente_desde AS desde, ra.vigente_hasta AS hasta
                  FROM ruta_acopiador ra JOIN usuario u ON u.id = ra.acopiador_id WHERE ra.ruta_id = %s
                 ORDER BY ra.vigente_desde DESC, ra.id DESC LIMIT 2""", esc["ruta2"])
    hoy = esc["hoy"]
    if [(a["a"], a["desde"], a["hasta"]) for a in asig] != [(JUAN_CARLOS, hoy, None),
                                                            (ROSA, hoy - timedelta(days=DIAS_COBERTURA), hoy)]:
        fallas.append(f"La Ruta 2 no quedó con la cobertura de {ROSA} y devuelta a {JUAN_CARLOS}: {asig}")

    alertas = {f["tipo"]: f["n"] for f in q("SELECT tipo::text AS tipo, COUNT(*) AS n FROM alerta_recoleccion "
                                            "WHERE revisada_en IS NULL GROUP BY tipo")}
    for tipo in ("lejos_del_productor", "ubicacion_simulada", "sin_ubicacion", "posible_duplicado", "litros_atipicos"):
        if alertas.get(tipo, 0) < 1:
            fallas.append(f"Falta la alerta pendiente {tipo}")
    for tipo in ("firma_invalida", "hora_inconsistente", "velocidad_imposible", "ubicacion_imprecisa"):
        if alertas.get(tipo, 0) > 0:
            fallas.append(f"No debería haber alertas {tipo} ({alertas[tipo]})")
    por_revisar = uno("SELECT COUNT(*) AS n FROM v_recoleccion_sin_revisar")["n"]
    if not 1 <= por_revisar <= 6:
        fallas.append(f"Calidad debería tener entre 1 y 6 entregas por revisar (hay {por_revisar})")
    if q(f"""SELECT 1 FROM v_leche_jornada WHERE litros_disponibles > 0
              AND {manana} - fecha > (SELECT valor::int FROM configuracion WHERE clave = 'dias_max_leche')"""):
        fallas.append("Mañana habría leche sin destino")
    liq = {f["estado"]: f["n"] for f in q("SELECT estado::text AS estado, COUNT(*) AS n FROM v_liquidacion_productor GROUP BY 1")}
    if not liq.get("pagado"):
        fallas.append("Falta la liquidación pagada")
    if not liq.get("pendiente"):
        fallas.append("Falta la liquidación pendiente")
    if not q("SELECT 1 FROM v_recoleccion_pago WHERE retenida AND revisada"):
        fallas.append("Falta una entrega revisada con el pago retenido")
    if not q("SELECT 1 FROM v_lote_resumen WHERE estado = 'cerrado' AND saldo = 0 AND cantidad_vendida > 0"):
        fallas.append("Falta un lote cerrado y vendido por completo")
    if not q("SELECT 1 FROM lote_produccion WHERE estado = 'en_proceso'"):
        fallas.append("Falta el lote en proceso")
    if not q("SELECT 1 FROM v_lote_disponible WHERE NOT vencido"):
        fallas.append("Falta un lote con saldo para vender")
    for tabla, que in (("merma_leche", "la merma de leche"), ("baja_producto", "la baja de producto")):
        if not q(f"SELECT 1 FROM {tabla}"):
            fallas.append(f"Falta {que}")
    if not q("SELECT 1 FROM pago_acopiador WHERE estado = 'pagado'"):
        fallas.append("Falta el sueldo de acopiador pagado")
    if uno("SELECT COUNT(DISTINCT categoria_id) AS n FROM gasto_operativo")["n"] < 5:
        fallas.append("Faltan gastos variados")
    if uno("SELECT COUNT(DISTINCT cliente_id) AS n FROM venta")["n"] < 3:
        fallas.append("Faltan ventas a varios clientes")
    if uno("SELECT COUNT(*) AS n FROM recoleccion WHERE anulada_en IS NOT NULL")["n"] < 2:
        fallas.append("Faltan las entregas anuladas")
    if uno("SELECT COUNT(*) AS n FROM productor WHERE NOT aprobado AND activo")["n"] != 1:
        fallas.append("Debería haber exactamente un alta de campo pendiente")
    if uno("""SELECT COUNT(DISTINCT r.productor_id) AS n FROM recoleccion r JOIN productor p ON p.id = r.productor_id
               WHERE p.tipo = 'externo' AND r.anulada_en IS NULL""")["n"] < 3:
        fallas.append("Faltan productores externos con entregas")
    jc = juan_carlos(conn)
    if (jc["dispositivo_id"], jc["huella"]) != (esc["jc"]["dispositivo_id"], esc["jc"]["huella"]):
        fallas.append(f"¡El celular de {JUAN_CARLOS} cambió!")

    cifras_guion(conn)
    print("Alertas pendientes por tipo:", dict(sorted(alertas.items())))
    print(f"Por revisar en Calidad: {por_revisar}; liquidaciones: {liq}")
    for f in q("SELECT mes, ingresos, egreso_leche, egreso_insumos, egreso_operativo, saldo_caja FROM v_flujo_mensual ORDER BY mes"):
        print(f"Flujo {f['mes']}: ingresos {f['ingresos']}, leche {f['egreso_leche']}, insumos {f['egreso_insumos']}, "
              f"operativo {f['egreso_operativo']}, saldo {f['saldo_caja']}")
    return fallas


# ------------------------------------------------------------------ principal
def main(argv: list[str] | None = None, conectar_fn=None, inspeccionar_fn=None, ahora_fn=None) -> int:
    parser = argparse.ArgumentParser(description="Borra lo transaccional de 'queseria' y carga datos de demostración")
    parser.add_argument("--base", required=True)
    parser.add_argument(BANDERA, dest="confirmo", action="store_true",
                        help="Confirma que todos los datos de la base son ficticios y se pueden borrar")
    parser.add_argument("--dump", help="Respaldo de pg_dump -Fc de la base hecho en los últimos 10 minutos")
    parser.add_argument("--fase", choices=("listar", "todo"), default="listar")
    parser.add_argument("--semilla", type=int, default=2110)
    args = parser.parse_args(argv)
    try:
        verificar_base(args.base)                  # antes de abrir cualquier conexión o leer el respaldo
        if not args.confirmo or not args.dump:
            revisar_permiso(args.confirmo, None, datetime.now(timezone.utc))
        dump = (inspeccionar_fn or inspeccionar_dump)(args.dump)
        revisar_permiso(args.confirmo, dump, (ahora_fn or (lambda: datetime.now(timezone.utc)))())
    except BaseNoPermitida as e:
        print(f"ALTO: {e}", file=sys.stderr)
        return 2
    conectar_fn = conectar_fn or conectar

    try:
        if args.fase == "listar":
            with conectar_fn(BASE, True) as conn:  # solo lectura
                verificar_base(BASE, base_actual(conn))
                listar(conn)
                print(f"Respaldo revisado: {dump.ruta} ({dump.tamano} bytes, base {dump.base}).")
                return 0
        with conectar_fn(BASE) as conn:
            verificar_base(BASE, base_actual(conn))
            limpiar(conn)
            esc = escenario(conn)
            from fastapi.testclient import TestClient

            from app.config import config
            # Solo aquí, ya comprobada la conexión: la app (TestClient) se conecta a la misma base
            os.environ["PGDATABASE"] = BASE
            config.cache_clear()
            from app.main import app
            with TestClient(app) as client:
                carga = cargar(client, conn, random.Random(args.semilla), esc)
            fallas = verificar(conn, esc)
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
