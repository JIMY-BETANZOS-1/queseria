import { useEffect, useId } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { salir } from "../api/cliente";
import { horaLima } from "../comun/formato";
import { vigilarVencimiento } from "../sesion/almacen";
import { useSesion } from "../sesion/useSesion";
import { EstadoApi } from "./EstadoApi";

type Opcion = { ruta: string; texto: string; exacta: boolean };

// Solo las pantallas ya construidas, agrupadas como se usan en el día. El Dashboard es la pantalla de inicio (/).
export const MENU: { grupo: string | null; opciones: Opcion[] }[] = [
  { grupo: null, opciones: [{ ruta: "/", texto: "Dashboard", exacta: true }] },
  {
    grupo: "Operación",
    opciones: [
      { ruta: "/recolecciones", texto: "Recolecciones del día", exacta: false },
      { ruta: "/alertas", texto: "Alertas", exacta: false },
      { ruta: "/calidad", texto: "Calidad", exacta: false },
      { ruta: "/jornadas", texto: "Leche de la jornada", exacta: false },
    ],
  },
  {
    grupo: "Planta",
    opciones: [
      { ruta: "/produccion", texto: "Producción", exacta: false },
      { ruta: "/ventas", texto: "Ventas", exacta: false },
      { ruta: "/almacen", texto: "Almacén", exacta: false },
      { ruta: "/recetas", texto: "Recetas", exacta: false },
    ],
  },
  {
    grupo: "Campo",
    opciones: [
      { ruta: "/productores", texto: "Productores", exacta: false },
      { ruta: "/rutas", texto: "Rutas", exacta: false },
      { ruta: "/acopiadores", texto: "Acopiadores", exacta: false },
      { ruta: "/analistas", texto: "Analistas", exacta: false },
    ],
  },
  {
    grupo: "Dinero",
    opciones: [
      { ruta: "/pagos/productores", texto: "Pagos a productores", exacta: false },
      { ruta: "/pagos/acopiadores", texto: "Pagos a acopiadores", exacta: false },
      { ruta: "/gastos", texto: "Gastos", exacta: false },
    ],
  },
  { grupo: "Administración", opciones: [{ ruta: "/configuracion", texto: "Configuración", exacta: false }] },
];

/** Barra superior + menú lateral + pantalla actual + estado de la API al pie. Solo con sesión (ver RequiereSesion). */
export function Marco() {
  const id = useId();
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
        {MENU.map(({ grupo, opciones }, i) => (
          <div key={grupo ?? "inicio"}>
            {grupo && <h2 className="menu-grupo" id={`${id}-grupo-${i}`}>{grupo}</h2>}
            <ul aria-labelledby={grupo ? `${id}-grupo-${i}` : undefined}>
              {opciones.map((opcion) => (
                <li key={opcion.ruta}>
                  <NavLink to={opcion.ruta} end={opcion.exacta}
                           className={({ isActive }) => (isActive ? "menu-opcion activa" : "menu-opcion")}>
                    {opcion.texto}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="contenido">
        <Outlet />
      </main>
      <footer className="pie">
        <EstadoApi />
      </footer>
    </div>
  );
}
