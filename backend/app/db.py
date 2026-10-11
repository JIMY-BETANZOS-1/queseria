"""Pool de conexiones y transacciones con auditoría.

Cada transacción de un usuario autenticado fija app.usuario_id (equivalente a SET LOCAL, pero
parametrizado con set_config(..., true)) para que el trigger fn_auditar sepa quién hizo el cambio.
"""
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import config

_pool: ConnectionPool | None = None


def abrir_pool() -> None:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            config().conninfo, min_size=1, max_size=10, open=True,
            kwargs={"autocommit": True, "row_factory": dict_row},
        )


def cerrar_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def pool() -> ConnectionPool:
    if _pool is None:
        abrir_pool()
    assert _pool is not None
    return _pool


@contextmanager
def transaccion(usuario_id: int | None) -> Iterator[psycopg.Connection]:
    """Abre una transacción; si hay usuario, ejecuta el equivalente de SET LOCAL app.usuario_id."""
    with pool().connection() as conn:
        with conn.transaction():
            if usuario_id is not None:
                fijar_usuario(conn, usuario_id)
            yield conn


def fijar_usuario(conn: psycopg.Connection, usuario_id: int) -> None:
    conn.execute("SELECT set_config('app.usuario_id', %s, true)", (str(usuario_id),))


def uno(conn: psycopg.Connection, consulta: Any, params: Any = None) -> dict | None:
    return conn.execute(consulta, params).fetchone()


def todos(conn: psycopg.Connection, consulta: Any, params: Any = None) -> list[dict]:
    return conn.execute(consulta, params).fetchall()


def actualizar(conn: psycopg.Connection, tabla: str, columna_id: str, id_: Any,
               cambios: dict[str, Any]) -> dict | None:
    """UPDATE tabla SET <cambios> WHERE columna_id = id_ RETURNING *. Las columnas vienen de modelos pydantic."""
    if not cambios:
        return uno(conn, sql.SQL("SELECT * FROM {} WHERE {} = %s").format(
            sql.Identifier(tabla), sql.Identifier(columna_id)), (id_,))
    asignaciones = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(c), sql.Placeholder(c)) for c in cambios)
    consulta = sql.SQL("UPDATE {} SET {} WHERE {} = %(_id)s RETURNING *").format(
        sql.Identifier(tabla), asignaciones, sql.Identifier(columna_id))
    return uno(conn, consulta, {**cambios, "_id": id_})
