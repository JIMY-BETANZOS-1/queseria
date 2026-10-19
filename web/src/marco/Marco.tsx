import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { salir } from "../api/cliente";
import { horaLima } from "../comun/formato";
import { vigilarVencimiento } from "../sesion/almacen";
import { useSesion } from "../sesion/useSesion";

// Solo las pantallas ya construidas: cada paso de W1 agrega la suya
const MENU = [{ ruta: "/", texto: "Inicio" }];

/** Barra superior + menú lateral + pantalla actual. Solo se muestra con sesión (ver RequiereSesion). */
export function Marco() {
  const sesion = useSesion();

  useEffect(() => vigilarVencimiento(), []);

  return (
    <div className="marco">
      <header className="barra">
        <span className="barra-titulo">Quesería Huata · Administración</span>
        {sesion && (
          <div className="barra-sesion">
            <span>{sesion.usuario.nombre_completo}</span>
            <span className="texto-suave">Sesión hasta las {horaLima(sesion.vence_en)}</span>
            <button type="button" className="boton boton-secundario" onClick={salir}>
              Salir
            </button>
          </div>
        )}
      </header>
      <nav className="menu" aria-label="Menú principal">
        <ul>
          {MENU.map((opcion) => (
            <li key={opcion.ruta}>
              <NavLink to={opcion.ruta} end className={({ isActive }) => (isActive ? "menu-opcion activa" : "menu-opcion")}>
                {opcion.texto}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="contenido">
        <Outlet />
      </main>
    </div>
  );
}
