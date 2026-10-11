"""Sincronización offline con la app móvil: push (productores + recolecciones), calidad y pull.

Cada ítem va en su propia transacción: lo que la base rechace (triggers, checks, FK) se traduce y
se devuelve como "rechazado" con su motivo, sin tumbar el resto del lote. Las reglas las aplica la
base; aquí solo se arman los INSERT/UPDATE y se leen las vistas. Contrato: docs/sincronizacion.md
"""
from datetime import datetime
from decimal import Decimal

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ValidationError

from .. import db, firma
from ..deps import Usuario, requiere_rol, solo_movil
from ..errores import describir_validacion, traducir
from ..esquemas.sync import (LoteCalidad, LotePush, ProductorPush, PullAcopiador, PullAnalista,
                             RecoleccionPush, RespuestaCalidad, RespuestaPush, ResultadoProductor,
                             ResultadoRecoleccion, ResultadoRevision, RevisionCalidad)
from .rutas import HOY_LIMA

router = APIRouter(prefix="/sync", tags=["sincronización"])

solo_analista = requiere_rol("analista")

# Margen del pull incremental: una transacción que empezó antes del pull pero confirmó después
# tiene actualizado_en anterior a "ahora"; se vuelve a pedir un poco hacia atrás (el celular hace upsert).
MARGEN_PULL = "interval '2 minutes'"

TIPO_POR_ROL = {"acopiador": "de_ruta", "analista": "externo"}


def _ahora() -> datetime:
    with db.pool().connection() as conn:
        return db.uno(conn, "SELECT now() AS ahora")["ahora"]


def _validar(modelo: type[BaseModel], item) -> tuple[BaseModel | None, str | None]:
    try:
        return modelo.model_validate(item), None
    except ValidationError as e:
        return None, describir_validacion(e.errors())


def _campo(item, nombre: str) -> str | None:
    """Identificador del ítem para la respuesta, aunque el ítem venga mal formado."""
    valor = item.get(nombre) if isinstance(item, dict) else None
    return str(valor) if valor is not None else None


# ----------------------------------------------------------------- push
def _push_productor(usuario: Usuario, p: ProductorPush) -> dict:
    with db.transaccion(usuario.id) as conn:
        existente = db.uno(conn, "SELECT id, codigo FROM productor WHERE uuid_cliente = %s", (p.uuid_cliente,))
        if existente is None:
            existente = db.uno(conn, """
                INSERT INTO productor (nombre, documento, celular, tipo, ruta_id, creado_por, uuid_cliente)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (uuid_cliente) DO NOTHING
                RETURNING id, codigo
            """, (p.nombre, p.documento, p.celular, TIPO_POR_ROL[usuario.rol], p.ruta_id, usuario.id,
                  p.uuid_cliente))
            if existente is not None:
                return {"estado": "creado", "productor_id": existente["id"], "codigo": existente["codigo"]}
            # Otra petición lo insertó al mismo tiempo
            existente = db.uno(conn, "SELECT id, codigo FROM productor WHERE uuid_cliente = %s", (p.uuid_cliente,))
        return {"estado": "duplicado", "productor_id": existente["id"], "codigo": existente["codigo"]}


def _ubicacion(r: RecoleccionPush) -> dict:
    """La ubicación NUNCA rechaza: lo que no se puede guardar se guarda como 'sin ubicación' y las
    alertas (sin_ubicacion, ubicacion_imprecisa...) las crea el trigger de la base."""
    lat, lon, precision, origen = r.latitud, r.longitud, r.precision_m, r.origen_ubicacion
    if lat is None or lon is None or not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return {"latitud": None, "longitud": None, "precision_m": None, "origen_ubicacion": "ninguna"}
    if origen == "ninguna":
        origen = "ultima_conocida"     # hay coordenadas: se guardan como ubicación no confiable
    if precision is not None and not (0 <= precision <= Decimal("999999.9")):
        precision = None
    return {"latitud": lat, "longitud": lon, "precision_m": precision, "origen_ubicacion": origen or "gps"}


def _alertas(conn, recoleccion_id) -> list[str]:
    filas = db.todos(conn, "SELECT tipo::text AS tipo FROM alerta_recoleccion WHERE recoleccion_id = %s ORDER BY tipo",
                     (recoleccion_id,))
    return [f["tipo"] for f in filas]


def _push_recoleccion(usuario: Usuario, r: RecoleccionPush, clave_publica: str | None) -> dict:
    motivo_firma = firma.verificar(r, clave_publica)
    with db.transaccion(usuario.id) as conn:
        previa = db.uno(conn, "SELECT registrado_por FROM recoleccion WHERE id = %s", (r.id,))
        if previa is not None:
            if previa["registrado_por"] != usuario.id:
                return {"estado": "rechazado", "motivo": "El id de la recolección ya fue usado por otro usuario"}
            return {"estado": "duplicado", "alertas": _alertas(conn, r.id)}

        productor_id = r.productor_id
        if productor_id is None:
            fila = db.uno(conn, "SELECT id FROM productor WHERE uuid_cliente = %s", (r.productor_uuid_cliente,))
            if fila is None:
                return {"estado": "rechazado",
                        "motivo": "El productor no está registrado (súbalo antes que sus recolecciones)"}
            productor_id = fila["id"]

        creada = db.uno(conn, """
            INSERT INTO recoleccion (id, productor_id, registrado_por, dispositivo_id, litros, observacion,
                                     registrada_en, latitud, longitud, precision_m, origen_ubicacion,
                                     ubicacion_simulada, hora_gps, hora_automatica, hash_anterior, firma)
            VALUES (%(id)s, %(productor_id)s, %(usuario)s, %(dispositivo)s, %(litros)s, %(observacion)s,
                    %(registrada_en)s, %(latitud)s, %(longitud)s, %(precision_m)s, %(origen_ubicacion)s,
                    %(ubicacion_simulada)s, %(hora_gps)s, %(hora_automatica)s, %(hash_anterior)s, %(firma)s)
            ON CONFLICT (id) DO NOTHING
            RETURNING id
        """, {"id": r.id, "productor_id": productor_id, "usuario": usuario.id, "dispositivo": usuario.dispositivo_id,
              "litros": r.litros, "observacion": r.observacion, "registrada_en": r.registrada_en,
              "ubicacion_simulada": r.ubicacion_simulada, "hora_gps": r.hora_gps,
              "hora_automatica": r.hora_automatica, "hash_anterior": r.hash_anterior, "firma": r.firma,
              **_ubicacion(r)})
        if creada is None:
            return {"estado": "duplicado", "alertas": _alertas(conn, r.id)}
        if motivo_firma is not None:
            conn.execute("SELECT fn_crear_alerta(%s, 'firma_invalida', %s)", (r.id, motivo_firma))
        return {"estado": "creado", "alertas": _alertas(conn, r.id)}


@router.post("/push", response_model=RespuestaPush)
def push(lote: LotePush, usuario: Usuario = Depends(solo_movil)):
    """Primero los productores dados de alta en el campo, luego las recolecciones (idempotente)."""
    productores = []
    for i, item in enumerate(lote.productores):
        base = {"indice": i, "uuid_cliente": _campo(item, "uuid_cliente")}
        p, error = _validar(ProductorPush, item)
        if p is None:
            productores.append(ResultadoProductor(**base, estado="rechazado", motivo=error))
            continue
        try:
            productores.append(ResultadoProductor(**base, **_push_productor(usuario, p)))
        except psycopg.Error as e:
            productores.append(ResultadoProductor(**base, estado="rechazado", motivo=traducir(e).mensaje))

    with db.pool().connection() as conn:
        clave_publica = db.uno(conn, "SELECT clave_publica FROM dispositivo WHERE id = %s",
                               (usuario.dispositivo_id,))["clave_publica"]

    recolecciones = []
    for i, item in enumerate(lote.recolecciones):
        base = {"indice": i, "id": _campo(item, "id")}
        r, error = _validar(RecoleccionPush, item)
        if r is None:
            recolecciones.append(ResultadoRecoleccion(**base, estado="rechazado", motivo=error))
            continue
        try:
            recolecciones.append(ResultadoRecoleccion(**base, **_push_recoleccion(usuario, r, clave_publica)))
        except psycopg.Error as e:
            recolecciones.append(ResultadoRecoleccion(**base, estado="rechazado", motivo=traducir(e).mensaje))

    return RespuestaPush(productores=productores, recolecciones=recolecciones, servidor_ahora=_ahora())


# ----------------------------------------------------------------- calidad
CAMPOS_ANALISIS = ("ph", "temperatura_c", "grasa_pct", "densidad", "antibioticos_positivo")


def _revisar(usuario: Usuario, rev: RevisionCalidad) -> dict:
    # El trigger diferido fn_exigir_analisis se comprueba al COMMIT de esta transacción
    with db.transaccion(usuario.id) as conn:
        actual = db.uno(conn, "SELECT calidad_en, anulada_en FROM recoleccion WHERE id = %s FOR UPDATE",
                        (rev.recoleccion_id,))
        if actual is None:
            return {"estado": "rechazado", "motivo": "La recolección no existe"}
        if actual["anulada_en"] is not None:
            return {"estado": "rechazado", "motivo": "La recolección está anulada"}
        if actual["calidad_en"] is not None:
            return {"estado": "duplicado", "motivo": "La recolección ya estaba revisada (no se cambió)"}

        analisis = {c: getattr(rev, c) for c in CAMPOS_ANALISIS}
        if any(v is not None for v in analisis.values()):
            # Upsert: si la foto se subió antes, se conserva
            conn.execute("""
                INSERT INTO analisis_calidad (recoleccion_id, ph, temperatura_c, grasa_pct, densidad,
                                              antibioticos_positivo)
                VALUES (%(id)s, %(ph)s, %(temperatura_c)s, %(grasa_pct)s, %(densidad)s, %(antibioticos_positivo)s)
                ON CONFLICT (recoleccion_id) DO UPDATE
                   SET ph = EXCLUDED.ph, temperatura_c = EXCLUDED.temperatura_c, grasa_pct = EXCLUDED.grasa_pct,
                       densidad = EXCLUDED.densidad, antibioticos_positivo = EXCLUDED.antibioticos_positivo
            """, {"id": rev.recoleccion_id, **analisis})

        conn.execute("""
            UPDATE recoleccion SET estado_calidad = %s, calidad_por = %s, calidad_en = now() WHERE id = %s
        """, (rev.estado, usuario.id, rev.recoleccion_id))
        sancion = db.uno(conn, """
            SELECT tipo::text AS tipo, desde, hasta FROM sancion_productor
             WHERE recoleccion_id = %s AND levantada_en IS NULL
        """, (rev.recoleccion_id,))
        return {"estado": "creado", "sancion": sancion}


@router.post("/calidad", response_model=RespuestaCalidad)
def calidad(lote: LoteCalidad, usuario: Usuario = Depends(solo_analista)):
    """Revisiones del analista: normal = confirmar; alterado = estado + análisis. calidad_en = hora del servidor."""
    revisiones = []
    for i, item in enumerate(lote.revisiones):
        base = {"indice": i, "recoleccion_id": _campo(item, "recoleccion_id")}
        rev, error = _validar(RevisionCalidad, item)
        if rev is None:
            revisiones.append(ResultadoRevision(**base, estado="rechazado", motivo=error))
            continue
        try:
            revisiones.append(ResultadoRevision(**base, **_revisar(usuario, rev)))
        except psycopg.Error as e:
            revisiones.append(ResultadoRevision(**base, estado="rechazado", motivo=traducir(e).mensaje))
    return RespuestaCalidad(revisiones=revisiones, servidor_ahora=_ahora())


# ----------------------------------------------------------------- pull
COLUMNAS_PRODUCTOR = """p.id, p.codigo, p.nombre, p.documento, p.celular, p.tipo::text AS tipo, p.ruta_id,
                        p.latitud_ref, p.longitud_ref, p.aprobado, p.uuid_cliente, p.actualizado_en"""


def _tiempos(conn) -> dict:
    return db.uno(conn, f"SELECT now() AS servidor_ahora, now() - {MARGEN_PULL} AS siguiente_desde")


def _pull_acopiador(conn, usuario: Usuario, desde: datetime | None) -> dict:
    p = {"u": usuario.id, "desde": desde}
    # Rutas vigentes del acopiador (asignación abierta y ruta activa)
    rutas = db.todos(conn, """
        SELECT r.id, r.nombre, r.descripcion, GREATEST(r.actualizado_en, ra.actualizado_en) AS actualizado_en,
               (%(desde)s::timestamptz IS NULL OR r.actualizado_en > %(desde)s
                OR ra.actualizado_en > %(desde)s) AS cambio
          FROM ruta_acopiador ra JOIN ruta r ON r.id = ra.ruta_id
         WHERE ra.acopiador_id = %(u)s AND ra.vigente_hasta IS NULL AND r.activa
         ORDER BY r.nombre
    """, p)
    # Si la ruta (o su asignación) cambió, van todos sus productores: así llegan los de una ruta recién asignada
    productores = db.todos(conn, f"""
        SELECT {COLUMNAS_PRODUCTOR},
               (%(desde)s::timestamptz IS NULL OR p.actualizado_en > %(desde)s
                OR r.actualizado_en > %(desde)s OR ra.actualizado_en > %(desde)s) AS cambio
          FROM productor p
          JOIN ruta r ON r.id = p.ruta_id AND r.activa
          JOIN ruta_acopiador ra ON ra.ruta_id = r.id AND ra.vigente_hasta IS NULL AND ra.acopiador_id = %(u)s
         WHERE p.activo
         ORDER BY p.nombre
    """, p)
    estados = db.todos(conn, """
        SELECT e.* FROM v_productor_estado_hoy e
          JOIN productor p ON p.id = e.productor_id
          JOIN ruta_acopiador ra ON ra.ruta_id = p.ruta_id AND ra.vigente_hasta IS NULL AND ra.acopiador_id = %(u)s
         WHERE e.sancionado
    """, p)
    precios = db.uno(conn, f"""
        SELECT h.hoy AS fecha, fn_precio_leche('normal', h.hoy) AS normal, fn_precio_leche('sancion', h.hoy) AS sancion
          FROM (SELECT {HOY_LIMA} AS hoy) h
    """)
    return {
        "rutas": [r for r in rutas if r["cambio"]],
        "ruta_ids_vigentes": [r["id"] for r in rutas],
        "productores": [x for x in productores if x["cambio"]],
        "productor_ids_vigentes": [x["id"] for x in productores],
        "estados": estados,
        "precios": precios,
    }


def _pull_analista(conn, desde: datetime | None) -> dict:
    p = {"desde": desde}
    externos = db.todos(conn, f"""
        SELECT {COLUMNAS_PRODUCTOR},
               (%(desde)s::timestamptz IS NULL OR p.actualizado_en > %(desde)s) AS cambio
          FROM productor p
         WHERE p.tipo = 'externo' AND p.activo
         ORDER BY p.nombre
    """, p)
    # v_recoleccion_sin_revisar no tiene actualizado_en: es la lista de trabajo y va completa
    sin_revisar = db.todos(conn, "SELECT * FROM v_recoleccion_sin_revisar ORDER BY registrada_en")
    recolecciones_hoy = db.todos(conn, f"""
        SELECT r.id, r.productor_id, p.codigo AS productor_codigo, p.nombre AS productor, r.litros,
               r.registrada_en, r.registrado_por, r.estado_calidad::text AS estado_calidad,
               (r.calidad_en IS NOT NULL) AS revisada, (r.anulada_en IS NOT NULL) AS anulada, r.actualizado_en
          FROM recoleccion r JOIN productor p ON p.id = r.productor_id
         WHERE (r.registrada_en AT TIME ZONE 'America/Lima')::date = {HOY_LIMA}
           AND (%(desde)s::timestamptz IS NULL OR r.actualizado_en > %(desde)s)
         ORDER BY r.registrada_en
    """, p)
    estados = db.todos(conn, "SELECT * FROM v_productor_estado_hoy WHERE sancionado")
    return {
        "productores": [x for x in externos if x["cambio"]],
        "productor_ids_vigentes": [x["id"] for x in externos],
        "sin_revisar": sin_revisar,
        "recolecciones_hoy": recolecciones_hoy,
        "estados": estados,
    }


@router.get("/pull", response_model=PullAcopiador | PullAnalista)
def pull(desde: datetime | None = None, usuario: Usuario = Depends(solo_movil)):
    """Cambios desde 'desde' (usar el siguiente_desde de la respuesta anterior; vacío = todo).
    El estado de sanción, los precios y los ids vigentes van completos en cada pull."""
    with db.transaccion(usuario.id) as conn:
        tiempos = _tiempos(conn)
        if usuario.rol == "acopiador":
            return PullAcopiador(rol="acopiador", **tiempos, **_pull_acopiador(conn, usuario, desde))
        return PullAnalista(rol="analista", **tiempos, **_pull_analista(conn, desde))
