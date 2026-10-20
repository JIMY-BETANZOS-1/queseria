import { useEffect, useId, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { salir } from "../api/cliente";
import { horaLima } from "../comun/formato";
import { Icono, type NombreIcono } from "../comun/Iconos";
import { vigilarVencimiento } from "../sesion/almacen";
import { useSesion } from "../sesion/useSesion";
import { EstadoApi } from "./EstadoApi";

type Opcion = { ruta: string; icono: NombreIcono; texto: string; exacta: boolean };

// Solo las pantallas ya construidas, agrupadas como se usan en el día. Inicio (/) es la pantalla de entrada.
// Los bloques sin grupo no llevan título: Inicio, Resumen y Productores arriba, Configuración sola al pie.
// `tambien`: otras direcciones que pertenecen al grupo (pantallas a las que se llega desde sus opciones).
export const MENU: { clave: string; grupo: string | null; icono?: NombreIcono; opciones: Opcion[]; tambien?: string[] }[] = [
  {
    clave: "inicio",
    grupo: null,
    opciones: [
      { ruta: "/", icono: "inicio", texto: "Inicio", exacta: true },
      { ruta: "/resumen", icono: "resumen", texto: "Resumen", exacta: false },
      { ruta: "/productores", icono: "productores", texto: "Productores", exacta: false },
    ],
  },
  {
    clave: "revision",
    icono: "revision",
    grupo: "Revisión",
    opciones: [
      { ruta: "/recolecciones", icono: "recolecciones", texto: "Entregas del día", exacta: false },
      { ruta: "/alertas", icono: "alertas", texto: "Alertas", exacta: false },
      { ruta: "/calidad", icono: "calidad", texto: "Calidad", exacta: false },
      { ruta: "/jornadas", icono: "jornada", texto: "Leche del día", exacta: false },
    ],
  },
  {
    clave: "personal",
    icono: "personal",
    grupo: "Personal",
    opciones: [
      { ruta: "/acopiadores", icono: "acopiadores", texto: "Acopiadores", exacta: false },
      { ruta: "/rutas", icono: "rutas", texto: "Rutas", exacta: false },
      { ruta: "/analistas", icono: "analistas", texto: "Analistas", exacta: false },
    ],
  },
  {
    clave: "planta",
    icono: "planta",
    grupo: "Planta",
    opciones: [
      { ruta: "/produccion", icono: "produccion", texto: "Producción", exacta: false },
      { ruta: "/ventas", icono: "ventas", texto: "Ventas", exacta: false },
      { ruta: "/almacen", icono: "almacen", texto: "Almacén", exacta: false },
      { ruta: "/recetas", icono: "recetas", texto: "Recetas", exacta: false },
    ],
  },
  {
    clave: "dinero",
    icono: "dinero",
    grupo: "Dinero",
    tambien: ["/pagos"],
    opciones: [
      { ruta: "/pagos/productores", icono: "pagos", texto: "Pagos a productores", exacta: false },
      { ruta: "/pagos/acopiadores", icono: "dinero", texto: "Sueldos de acopiadores", exacta: false },
      { ruta: "/gastos", icono: "gastos", texto: "Gastos", exacta: false },
      { ruta: "/movimientos", icono: "movimientos", texto: "Movimientos", exacta: false },
    ],
  },
  { clave: "pie", grupo: null, opciones: [{ ruta: "/configuracion", icono: "configuracion", texto: "Configuración", exacta: false }] },
];

const AVISO_SESION_MS = 5 * 60_000;

/** "Sesión hasta las HH:MM", solo cuando faltan 5 minutos o menos (antes no distrae). Al vencer, vigilarVencimiento
 * lleva a Entrar. Se monta con key = vencimiento: una sesión nueva vuelve a empezar sin aviso. */
function AvisoSesion({ venceEn }: { venceEn: number }) {
  const [cerca, setCerca] = useState(() => venceEn - Date.now() <= AVISO_SESION_MS);
  useEffect(() => {
    if (cerca) return undefined;
    const t = setTimeout(() => setCerca(true), venceEn - AVISO_SESION_MS - Date.now());
    return () => clearTimeout(t);
  }, [venceEn, cerca]);
  return cerca ? <span className="aviso-sesion" role="status">Sesión hasta las {horaLima(venceEn)}</span> : null;
}

/** Grupo del menú al que pertenece la dirección actual (null si es una opción sin grupo o no está en el menú). */
export function grupoDe(ruta: string): string | null {
  const dentro = (base: string) => ruta === base || ruta.startsWith(`${base}/`);
  return MENU.find((b) => b.grupo !== null
    && (b.opciones.some((o) => dentro(o.ruta)) || (b.tambien ?? []).some(dentro)))?.clave ?? null;
}

/** Barra superior + menú lateral + pantalla actual + estado de la API al pie. Solo con sesión (ver RequiereSesion). */
export function Marco() {
  const id = useId();
  const sesion = useSesion();

  const { pathname } = useLocation();
  // Solo el grupo de la pantalla actual queda abierto; al cambiar de pantalla, el menú vuelve a plegarse (en memoria)
  const actual = grupoDe(pathname);
  const [abiertos, setAbiertos] = useState<{ ruta: string; claves: ReadonlySet<string> }>(
    () => ({ ruta: pathname, claves: new Set(actual ? [actual] : []) }));
  const claves = abiertos.ruta === pathname ? abiertos.claves : new Set(actual ? [actual] : []);
  function alternar(clave: string) {
    const nuevas = new Set(claves);
    if (nuevas.has(clave)) nuevas.delete(clave); else nuevas.add(clave);
    setAbiertos({ ruta: pathname, claves: nuevas });
  }

  useEffect(() => vigilarVencimiento(), []);

  return (
    <div className="marco">
      <header className="barra">
        <span className="barra-titulo">
          {/* Logo provisional: el del cliente se pone en web/public/logo.svg con el mismo nombre */}
          <img className="barra-logo" src="/logo.svg" alt="" width="32" height="32" />
          Quesería Huata · Administración
        </span>
        {sesion && (
          <div className="barra-sesion">
            <span>{sesion.usuario.nombre_completo}</span>
            <AvisoSesion key={sesion.vence_en} venceEn={sesion.vence_en} />
            <button type="button" className="boton boton-secundario" onClick={salir}>
              Salir
            </button>
          </div>
        )}
      </header>
      <nav className="menu" aria-label="Menú principal">
        {MENU.map(({ clave, grupo, icono, opciones }, i) => (
          <div key={clave} className={clave === "pie" ? "menu-pie" : undefined}>
            {grupo && (
              <h2 className="menu-grupo" id={`${id}-grupo-${i}`}>
                <button type="button" className={clave === actual ? "menu-grupo-boton activo" : "menu-grupo-boton"}
                        aria-expanded={claves.has(clave)}
                        aria-controls={`${id}-lista-${i}`} onClick={() => alternar(clave)}>
                  {icono && <Icono nombre={icono} />}
                  <span className="menu-grupo-texto">{grupo}</span>
                  <Icono nombre="desplegar" clase="menu-grupo-flecha" />
                </button>
              </h2>
            )}
            <ul id={`${id}-lista-${i}`} aria-labelledby={grupo ? `${id}-grupo-${i}` : undefined}
                hidden={grupo !== null && !claves.has(clave)}>
              {opciones.map((opcion) => (
                <li key={opcion.ruta}>
                  <NavLink to={opcion.ruta} end={opcion.exacta}
                           className={({ isActive }) => (isActive ? "menu-opcion activa" : "menu-opcion")}>
                    <Icono nombre={opcion.icono} />
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
