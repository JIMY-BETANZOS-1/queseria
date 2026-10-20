"""Pagos: liquidación semanal de productores y pago mensual de acopiadores.

Las reglas viven en la base (CLAUDE.md): qué es pagable (v_recoleccion_pago), que solo se liquide lo pagable
del productor y del periodo, que no se pague una liquidación vacía ni se toque una pagada, el periodo único por
productor, el mes único por acopiador y el monto del gasto. Aquí solo se inserta, se consulta y se traduce.

Pendiente (parche 003, docs/sincronizacion.md): el gasto "Sueldo acopiador" que genera el pago de un acopiador
se crea aquí, en la misma transacción, porque schema.sql no tiene ese trigger aunque su comentario lo anuncia.
Tampoco hay trigger que proteja un pago_acopiador ya pagado: por eso editar y eliminar exigen que esté pendiente.
"""
from datetime import date

import psycopg
from fastapi import APIRouter, Depends, Response

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import CHECKS, conflicto, no_encontrado
from ..esquemas.pagos import (AcopiadorMes, EstadoPago, Liquidacion, LiquidacionDetalle, PagableDelPeriodo, PagoAcopiador,
                              PagoAcopiadorCambios, PagoAcopiadorNuevo, PagoPendienteProductor, Periodo)
from .rutas import HOY_LIMA

router = APIRouter(tags=["pagos"])

# Lo pagable y aún no liquidado de un periodo (pg.fecha = día en Lima de la recolección)
PAGABLE = "pg.pagable AND NOT pg.liquidada AND pg.fecha BETWEEN %(desde)s AND %(hasta)s"


def _liquidacion(conn, liquidacion_id: int) -> dict:
    fila = db.uno(conn, "SELECT * FROM v_liquidacion_productor WHERE liquidacion_id = %s", (liquidacion_id,))
    if fila is None:
        raise no_encontrado("La liquidación no existe")
    return fila


# ----------------------------------------------------------------- productores
@router.get("/pagos/productores/pendientes", response_model=list[PagoPendienteProductor])
def pendientes(usuario: Usuario = Depends(solo_admin)):
    """Cuentas por pagar: por productor, lo pagable ya y lo que está en espera (sin revisar o retenido)."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, "SELECT * FROM v_pago_pendiente_productor ORDER BY nombre")


@router.get("/pagos/productores/periodo", response_model=list[PagableDelPeriodo])
def pagable_del_periodo(desde: date, hasta: date, usuario: Usuario = Depends(solo_admin)):
    """Vista previa de "Liquidar semana": lo que entraría en la liquidación de cada productor."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, f"""
            SELECT pg.productor_id, p.codigo, p.nombre,
                   COUNT(*) AS n_recolecciones, SUM(pg.litros) AS litros, SUM(pg.monto) AS monto,
                   COALESCE(SUM(pg.litros) FILTER (WHERE pg.con_sancion), 0) AS litros_con_sancion
              FROM v_recoleccion_pago pg
              JOIN productor p ON p.id = pg.productor_id
             WHERE {PAGABLE}
             GROUP BY pg.productor_id, p.codigo, p.nombre
             ORDER BY p.nombre
        """, {"desde": desde, "hasta": hasta})


@router.post("/liquidaciones/lote", response_model=list[Liquidacion], status_code=201)
def liquidar_periodo(datos: Periodo, usuario: Usuario = Depends(solo_admin)):
    """Una liquidación por productor con lo pagable del periodo, todas en una transacción (o ninguna).
    Los montos se congelan en liquidacion_detalle; trg_liq_detalle_validar revisa cada recolección."""
    p = {"desde": datos.desde, "hasta": datos.hasta, "usuario": usuario.id}
    with db.transaccion(usuario.id) as conn:
        productores = db.todos(conn, f"""
            SELECT DISTINCT pg.productor_id FROM v_recoleccion_pago pg WHERE {PAGABLE} ORDER BY 1
        """, p)
        ids = []
        for fila in productores:
            liq = db.uno(conn, """
                INSERT INTO liquidacion_productor (productor_id, desde, hasta, creada_por)
                VALUES (%(productor)s, %(desde)s, %(hasta)s, %(usuario)s) RETURNING id
            """, {**p, "productor": fila["productor_id"]})
            conn.execute(f"""
                INSERT INTO liquidacion_detalle (recoleccion_id, liquidacion_id, litros, precio_litro, con_sancion, monto)
                SELECT pg.recoleccion_id, %(liq)s, pg.litros, pg.precio_litro, pg.con_sancion, pg.monto
                  FROM v_recoleccion_pago pg
                 WHERE pg.productor_id = %(productor)s AND {PAGABLE}
            """, {**p, "productor": fila["productor_id"], "liq": liq["id"]})
            ids.append(liq["id"])
        if not ids:
            return []
        return db.todos(conn, "SELECT * FROM v_liquidacion_productor WHERE liquidacion_id = ANY(%s) ORDER BY productor",
                        (ids,))


@router.get("/liquidaciones", response_model=list[Liquidacion])
def liquidaciones(estado: EstadoPago | None = None, productor_id: int | None = None, desde: date | None = None,
                  hasta: date | None = None, usuario: Usuario = Depends(solo_admin)):
    """Las más recientes primero. desde/hasta filtran por periodos que se cruzan con el rango."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, """
            SELECT * FROM v_liquidacion_productor
             WHERE (%(estado)s::text IS NULL OR estado::text = %(estado)s)
               AND (%(prod)s::bigint IS NULL OR productor_id = %(prod)s)
               AND (%(desde)s::date IS NULL OR hasta >= %(desde)s)
               AND (%(hasta)s::date IS NULL OR desde <= %(hasta)s)
             ORDER BY desde DESC, productor
             LIMIT 1000
        """, {"estado": estado, "prod": productor_id, "desde": desde, "hasta": hasta})


@router.get("/liquidaciones/{liquidacion_id}", response_model=LiquidacionDetalle)
def liquidacion(liquidacion_id: int, usuario: Usuario = Depends(solo_admin)):
    """Comprobante: la cabecera con sus totales y cada recolección con su monto congelado."""
    with db.transaccion(usuario.id) as conn:
        cabecera = _liquidacion(conn, liquidacion_id)
        lineas = db.todos(conn, """
            SELECT d.recoleccion_id, r.registrada_en, (r.registrada_en AT TIME ZONE 'America/Lima')::date AS fecha,
                   d.litros, d.precio_litro, d.con_sancion, d.monto
              FROM liquidacion_detalle d JOIN recoleccion r ON r.id = d.recoleccion_id
             WHERE d.liquidacion_id = %s
             ORDER BY r.registrada_en
        """, (liquidacion_id,))
        return {**cabecera, "lineas": lineas}


@router.post("/liquidaciones/{liquidacion_id}/pagar", response_model=Liquidacion)
def pagar_liquidacion(liquidacion_id: int, usuario: Usuario = Depends(solo_admin)):
    """Sin detalle, la base la rechaza (fn_validar_liquidacion). Pagada, ya nada de ella se puede cambiar."""
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, """
            UPDATE liquidacion_productor SET estado = 'pagado', pagada_en = now(), pagada_por = %s
             WHERE id = %s AND estado = 'pendiente' RETURNING id
        """, (usuario.id, liquidacion_id))
        if fila is None:
            _liquidacion(conn, liquidacion_id)   # 404 si no existe
            raise conflicto("La liquidación ya está pagada")
        return _liquidacion(conn, liquidacion_id)


@router.delete("/liquidaciones/{liquidacion_id}", status_code=204)
def eliminar_liquidacion(liquidacion_id: int, usuario: Usuario = Depends(solo_admin)):
    """Solo una pendiente: sus recolecciones vuelven a "por pagar".

    Hueco de la base (parche 003): fn_proteger_liquidacion_pagada protege el detalle, pero al borrar la cabecera el
    ON DELETE CASCADE lo borra cuando la cabecera ya no se ve, así que el trigger no detecta que estaba pagada y la
    base dejaría borrar una liquidación pagada. Mientras no exista un trigger BEFORE DELETE en
    liquidacion_productor, aquí solo se borran las pendientes."""
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, "DELETE FROM liquidacion_productor WHERE id = %s AND estado = 'pendiente' RETURNING id",
                      (liquidacion_id,))
        if fila is None:
            _liquidacion(conn, liquidacion_id)   # 404 si no existe
            raise conflicto("La liquidación ya está pagada y no se puede eliminar")
    return Response(status_code=204)


# ----------------------------------------------------------------- acopiadores
SELECT_ACOPIADOR_MES = """
    SELECT a.usuario_id AS acopiador_id, u.nombre_completo, u.activo, %(mes)s::date AS mes,
           COALESCE(m.litros, 0) AS litros, COALESCE(m.litros_normales, 0) AS litros_normales,
           COALESCE(m.recolecciones, 0) AS recolecciones,
           a.sueldo_base_mensual,
           -- Sin entregas en el mes, v_acopiador_mes no tiene fila: comisión 0 y solo el sueldo base
           COALESCE(m.comision_estimada, 0) AS comision_estimada,
           COALESCE(m.sueldo_estimado, a.sueldo_base_mensual) AS sueldo_estimado,
           pa.id AS pago_id, pa.estado::text AS estado, pa.litros_mes AS pago_litros_mes,
           pa.sueldo_base AS pago_sueldo_base, pa.comision AS pago_comision, pa.ajustes, pa.total,
           pa.pagado_en, pa.gasto_id, pa.nota
      FROM acopiador a
      JOIN usuario u ON u.id = a.usuario_id
      LEFT JOIN v_acopiador_mes m ON m.acopiador_id = a.usuario_id AND m.mes = %(mes)s
      LEFT JOIN pago_acopiador pa ON pa.acopiador_id = a.usuario_id AND pa.mes = %(mes)s
"""


def _pago(conn, pago_id: int, para_cambiar: bool = False) -> dict:
    fila = db.uno(conn, "SELECT * FROM pago_acopiador WHERE id = %s" + (" FOR UPDATE" if para_cambiar else ""),
                  (pago_id,))
    if fila is None:
        raise no_encontrado("El pago no existe")
    if para_cambiar and fila["estado"] == "pagado":
        raise conflicto("El pago ya está pagado y no se puede modificar")
    return fila


@router.get("/pagos/acopiadores", response_model=list[AcopiadorMes])
def acopiadores_del_mes(mes: date, usuario: Usuario = Depends(solo_admin)):
    """Cada acopiador activo (o con entregas o pago en el mes): lo estimado y su pago, si existe."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_ACOPIADOR_MES + """
             WHERE u.activo OR m.acopiador_id IS NOT NULL OR pa.id IS NOT NULL
             ORDER BY u.nombre_completo
        """, {"mes": mes})


@router.post("/pagos/acopiadores", response_model=PagoAcopiador, status_code=201)
def registrar_pago(datos: PagoAcopiadorNuevo, usuario: Usuario = Depends(solo_admin)):
    """Queda pendiente con lo estimado en este momento (litros, base y comisión de v_acopiador_mes) más los ajustes.
    Mes que no es el día 1, mes ya registrado o acopiador inexistente: los rechaza la base."""
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, """
            INSERT INTO pago_acopiador (acopiador_id, mes, litros_mes, sueldo_base, comision, ajustes, nota, creado_por)
            SELECT a.usuario_id, %(mes)s, COALESCE(m.litros, 0), a.sueldo_base_mensual, COALESCE(m.comision_estimada, 0),
                   %(ajustes)s, %(nota)s, %(usuario)s
              FROM acopiador a
              LEFT JOIN v_acopiador_mes m ON m.acopiador_id = a.usuario_id AND m.mes = %(mes)s
             WHERE a.usuario_id = %(acop)s
            RETURNING *
        """, {"acop": datos.acopiador_id, "mes": datos.mes, "ajustes": datos.ajustes, "nota": datos.nota,
              "usuario": usuario.id})
        if fila is None:
            raise no_encontrado("El acopiador no existe")
        return fila


@router.patch("/pagos/acopiadores/{pago_id}", response_model=PagoAcopiador)
def editar_pago(pago_id: int, datos: PagoAcopiadorCambios, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        _pago(conn, pago_id, para_cambiar=True)
        return db.actualizar(conn, "pago_acopiador", "id", pago_id, datos.model_dump(exclude_unset=True))


@router.delete("/pagos/acopiadores/{pago_id}", status_code=204)
def eliminar_pago(pago_id: int, usuario: Usuario = Depends(solo_admin)):
    """Solo pendiente: para volver a registrarlo con lo estimado de nuevo."""
    with db.transaccion(usuario.id) as conn:
        _pago(conn, pago_id, para_cambiar=True)
        conn.execute("DELETE FROM pago_acopiador WHERE id = %s", (pago_id,))
    return Response(status_code=204)


@router.post("/pagos/acopiadores/{pago_id}/pagar", response_model=PagoAcopiador)
def pagar_acopiador(pago_id: int, usuario: Usuario = Depends(solo_admin)):
    """Crea su gasto "Sueldo acopiador" (fecha de hoy en Lima, monto = total) y lo marca pagado, en una transacción.
    Un total de cero o negativo: la base rechaza el gasto (monto > 0) y se responde 409 con ese mensaje."""
    with db.transaccion(usuario.id) as conn:
        pago = _pago(conn, pago_id, para_cambiar=True)
        try:
            with conn.transaction():
                gasto = db.uno(conn, f"""
                    INSERT INTO gasto_operativo (fecha, categoria_id, descripcion, monto, acopiador_id, registrado_por)
                    SELECT {HOY_LIMA}, c.id, 'Sueldo de ' || u.nombre_completo || ' (' || to_char(%(mes)s::date, 'MM/YYYY') || ')',
                           %(monto)s, %(acop)s, %(usuario)s
                      FROM categoria_gasto c, usuario u
                     WHERE c.nombre = 'Sueldo acopiador' AND u.id = %(acop)s
                    RETURNING id
                """, {"mes": pago["mes"], "monto": pago["total"], "acop": pago["acopiador_id"], "usuario": usuario.id})
        except psycopg.errors.CheckViolation as e:
            if e.diag.constraint_name == "gasto_operativo_monto_check":
                raise conflicto(CHECKS["gasto_operativo_monto_check"]) from e
            raise
        if gasto is None:
            raise conflicto("Falta la categoría de gasto 'Sueldo acopiador'")
        return db.uno(conn, """
            UPDATE pago_acopiador SET estado = 'pagado', pagado_en = now(), gasto_id = %s WHERE id = %s RETURNING *
        """, (gasto["id"], pago_id))
