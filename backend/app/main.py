"""API de la quesería: punto de entrada."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import config
from .errores import registrar_manejadores
from .routers import auth, configuracion, precios, productores, recolecciones, rutas, usuarios


@asynccontextmanager
async def ciclo_de_vida(_: FastAPI):
    db.abrir_pool()
    yield
    db.cerrar_pool()


app = FastAPI(title="Quesería Huata — API", version="0.1.0", lifespan=ciclo_de_vida)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in config().cors_origenes.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)
registrar_manejadores(app)

for r in (auth.router, rutas.router, usuarios.router_acopiadores, usuarios.router_analistas,
          usuarios.router_usuarios, productores.router, recolecciones.router, precios.router,
          configuracion.router):
    app.include_router(r)


@app.get("/salud", tags=["salud"])
def salud():
    with db.pool().connection() as conn:
        fila = db.uno(conn, "SELECT current_database() AS base, now() AS hora")
    return {"estado": "ok", **fila}
