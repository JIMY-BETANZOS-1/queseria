"""Editor de recetas (A8): crear, cambiar la cabecera y reemplazar sus insumos. Solo afecta a la producción futura.

Los costos de un lote ya hecho están guardados en el lote (lote_leche, movimientos de consumo, lote_costo) y no
dependen de la receta. Pero v_lote_resumen y v_lote_disponible calculan el rendimiento teórico, la desviación y el
vencimiento de cada lote con litros_base, rendimiento_base y dias_vida_util ACTUALES de su receta, y la cantidad
producida está en su unidad_venta. Por eso, si la receta ya tiene lotes, esos cuatro campos no se cambian aquí
(409): se crea una receta nueva y se desactiva la anterior. Es una protección del backend mientras la base no la
tenga (docs/pantallas.md, parche pendiente). Los rangos (precio ≥ 0, litros y rendimiento > 0, vida útil ≥ 1,
cantidad > 0) y el nombre único los valida la base: vuelven como 409 con su mensaje.
"""
import psycopg
from fastapi import APIRouter, Depends
from psycopg import sql

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import CHECKS, conflicto, no_encontrado, validacion
from ..esquemas.produccion import Receta
from ..esquemas.recetas import InsumoEnReceta, InsumosDeReceta, RecetaCambios, RecetaNueva
from .produccion import SELECT_RECETA

router = APIRouter(tags=["producción y ventas"])

# Cambiarlos con lotes ya hechos alteraría lo que se muestra de esos lotes (teórico, desviación, vencimiento, unidad)
FIJOS_CON_LOTES = {"unidad_venta": "la unidad de venta", "litros_base": "los litros base",
                   "rendimiento_base": "el rendimiento", "dias_vida_util": "la vida útil"}
EDITABLES = ("nombre", "unidad_venta", "precio_venta", "litros_base", "rendimiento_base", "dias_vida_util", "activa")


def _con_reglas_de_la_base(funcion):
    """Ejecuta `funcion` en un punto de guardado: un CHECK conocido de la base vuelve como 409 con su mensaje."""
    def envoltura(conn, *args):
        try:
            with conn.transaction():
                return funcion(conn, *args)
        except psycopg.errors.CheckViolation as e:
            if e.diag.constraint_name in CHECKS:
                raise conflicto(CHECKS[e.diag.constraint_name]) from e
            raise
    return envoltura


def _validar_insumos(conn, insumos: list[InsumoEnReceta]):
    ids = [i.insumo_id for i in insumos]
    if len(ids) != len(set(ids)):
        raise conflicto("Un insumo está repetido en la receta")
    if not ids:
        return
    activos = {f["id"] for f in db.todos(conn, "SELECT id FROM insumo WHERE id = ANY(%s) AND activo", (ids,))}
    faltan = [i for i in ids if i not in activos]
    if faltan:
        raise conflicto(f"El insumo n.º {faltan[0]} no existe o está inactivo")


@_con_reglas_de_la_base
def _poner_insumos(conn, receta_id: int, insumos: list[InsumoEnReceta]):
    conn.execute("DELETE FROM receta_insumo WHERE receta_id = %s", (receta_id,))
    for i in insumos:
        conn.execute("INSERT INTO receta_insumo (receta_id, insumo_id, cantidad) VALUES (%s, %s, %s)",
                     (receta_id, i.insumo_id, i.cantidad))


def _receta(conn, receta_id: int) -> dict:
    fila = db.uno(conn, SELECT_RECETA + " WHERE r.id = %s", (receta_id,))
    if fila is None:
        raise no_encontrado("La receta no existe")
    return fila


@router.post("/recetas", response_model=Receta, status_code=201)
def crear(datos: RecetaNueva, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        _validar_insumos(conn, datos.insumos)

        @_con_reglas_de_la_base
        def insertar(c):
            return db.uno(c, """
                INSERT INTO receta (nombre, unidad_venta, precio_venta, litros_base, rendimiento_base, dias_vida_util, activa)
                VALUES (%(nombre)s, %(unidad_venta)s, %(precio_venta)s, %(litros_base)s, %(rendimiento_base)s,
                        %(dias_vida_util)s, %(activa)s) RETURNING id
            """, datos.model_dump(exclude={"insumos"}))["id"]

        receta_id = insertar(conn)
        _poner_insumos(conn, receta_id, datos.insumos)
        return _receta(conn, receta_id)


@router.patch("/recetas/{receta_id}", response_model=Receta)
def cambiar(receta_id: int, datos: RecetaCambios, usuario: Usuario = Depends(solo_admin)):
    cambios = datos.model_dump(exclude_unset=True)
    if not cambios:
        raise validacion("No hay nada que cambiar")
    for campo in ("nombre", "unidad_venta", "litros_base", "activa"):
        if campo in cambios and cambios[campo] is None:
            raise validacion(f"El campo {campo} no puede quedar vacío")
    with db.transaccion(usuario.id) as conn:
        actual = _receta(conn, receta_id)
        cambian = [c for c in FIJOS_CON_LOTES if c in cambios and cambios[c] != _comparable(actual[c])]
        if cambian:
            lotes = db.uno(conn, "SELECT COUNT(*) AS n FROM lote_produccion WHERE receta_id = %s", (receta_id,))["n"]
            if lotes > 0:
                raise conflicto(
                    f"La receta ya tiene {lotes} {'lote' if lotes == 1 else 'lotes'}: cambiar "
                    f"{' y '.join(FIJOS_CON_LOTES[c] for c in cambian)} alteraría lo que se muestra de ellos "
                    "(rendimiento teórico, vencimiento o unidad). Cree una receta nueva y desactive esta.")

        @_con_reglas_de_la_base
        def actualizar(c):
            columnas = [k for k in EDITABLES if k in cambios]
            c.execute(sql.SQL("UPDATE receta SET {} WHERE id = %s").format(
                sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in columnas)),
                [cambios[k] for k in columnas] + [receta_id])

        actualizar(conn)
        return _receta(conn, receta_id)


@router.put("/recetas/{receta_id}/insumos", response_model=Receta)
def reemplazar_insumos(receta_id: int, datos: InsumosDeReceta, usuario: Usuario = Depends(solo_admin)):
    """Reemplaza el conjunto completo (una lista vacía deja la receta sin insumos). Los lotes ya hechos no cambian:
    su consumo quedó en sus movimientos."""
    with db.transaccion(usuario.id) as conn:
        _receta(conn, receta_id)
        _validar_insumos(conn, datos.insumos)
        _poner_insumos(conn, receta_id, datos.insumos)
        return _receta(conn, receta_id)


def _comparable(valor):
    """Los numeric de la base llegan como Decimal: se comparan como float con lo que envió la web."""
    return float(valor) if valor is not None and not isinstance(valor, (str, bool, int)) else valor
