"""Dashboard (A2 mínimo) y leche por jornada (A8b): solo lectura de las vistas de la base, sin cálculos propios
más allá de sumar o contar sus filas."""
from datetime import date

from fastapi import APIRouter, Depends

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import validacion
from ..esquemas.dashboard import Dashboard, Jornada

router = APIRouter(tags=["dashboard"])

MAX_DIAS_JORNADAS = 400


@router.get("/jornadas", response_model=list[Jornada])
def jornadas(desde: date, hasta: date, usuario: Usuario = Depends(solo_admin)):
    """Días con leche entre desde y hasta (v_leche_jornada); los días sin recolecciones no tienen fila."""
    if hasta < desde:
        raise validacion("La fecha final no puede ser anterior a la inicial")
    if (hasta - desde).days >= MAX_DIAS_JORNADAS:
        raise validacion(f"Pida como máximo {MAX_DIAS_JORNADAS} días")
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, "SELECT * FROM v_leche_jornada WHERE fecha BETWEEN %s AND %s ORDER BY fecha",
                        (desde, hasta))


@router.get("/dashboard", response_model=Dashboard)
def dashboard(mes: date, usuario: Usuario = Depends(solo_admin)):
    """Resumen del mes de `mes` (cualquier día del mes) y lo pendiente de atención."""
    p = {"mes": mes}
    with db.transaccion(usuario.id) as conn:
        inicio = db.uno(conn, "SELECT date_trunc('month', %(mes)s::date)::date AS m", p)["m"]
        p = {"mes": inicio}
        leche = db.uno(conn, """
            SELECT COALESCE(SUM(litros_recolectados), 0) AS litros_recolectados,
                   COALESCE(SUM(litros_descartados), 0)  AS litros_descartados,
                   COALESCE(SUM(litros_por_revisar), 0)  AS litros_por_revisar,
                   COALESCE(SUM(litros_aprobados), 0)    AS litros_aprobados,
                   COALESCE(SUM(costo_pagado), 0)        AS costo_pagado
              FROM v_leche_jornada
             WHERE date_trunc('month', fecha::timestamp)::date = %(mes)s
        """, p)
        flujo = db.uno(conn, "SELECT * FROM v_flujo_mensual WHERE mes = %(mes)s", p) or {
            "ingresos": 0, "egreso_leche": 0, "egreso_insumos": 0, "egreso_lotes": 0, "egreso_operativo": 0,
            "total_invertido": 0, "saldo_caja": 0}
        resultado = db.uno(conn, "SELECT * FROM v_resultado_mensual WHERE mes = %(mes)s", p) or {
            "ingresos": 0, "costo_ventas": 0, "perdida_producto": 0, "perdida_leche": 0, "gasto_operativo": 0,
            "utilidad_neta": 0}
        por_pagar = db.uno(conn, """
            SELECT (SELECT COALESCE(SUM(monto_pagable), 0) FROM v_pago_pendiente_productor)   AS monto_pagable,
                   (SELECT COALESCE(SUM(monto_en_espera), 0) FROM v_pago_pendiente_productor) AS monto_en_espera,
                   (SELECT COUNT(*) FROM v_liquidacion_productor WHERE estado = 'pendiente')  AS liquidaciones_pendientes,
                   (SELECT COALESCE(SUM(monto), 0) FROM v_liquidacion_productor WHERE estado = 'pendiente')
                                                                                              AS monto_liquidaciones_pendientes
        """)
        acopiadores = db.uno(conn, """
            SELECT (SELECT COALESCE(SUM(sueldo_estimado), 0) FROM v_acopiador_mes WHERE mes = %(mes)s) AS sueldo_estimado,
                   (SELECT COALESCE(SUM(total), 0) FROM pago_acopiador WHERE mes = %(mes)s AND estado = 'pagado') AS pagado,
                   (SELECT COUNT(*) FROM pago_acopiador WHERE mes = %(mes)s AND estado = 'pendiente') AS pagos_pendientes
        """, p)
        atencion = db.uno(conn, """
            SELECT (SELECT COUNT(*) FROM alerta_recoleccion WHERE revisada_en IS NULL) AS alertas_pendientes,
                   (SELECT COUNT(*) FROM alerta_recoleccion
                     WHERE revisada_en IS NULL AND tipo IN ('productor_bloqueado', 'firma_invalida')) AS alertas_que_retienen,
                   (SELECT COUNT(*) FROM productor WHERE NOT aprobado AND activo)             AS altas_por_aprobar,
                   (SELECT COUNT(*) FROM v_recoleccion_sin_revisar)                         AS entregas_sin_revisar,
                   (SELECT COUNT(DISTINCT productor_id) FROM v_productor_observado)          AS productores_observados
        """)
    return {"mes": inicio, "leche": leche, "flujo": flujo, "resultado": resultado, "por_pagar": por_pagar,
            "acopiadores": acopiadores, "atencion": atencion}
