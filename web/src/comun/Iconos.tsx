// Íconos propios (SVG de trazo, 24 × 24): sin librerías ni style=; el color es el del texto (currentColor) y el
// tamaño lo da la clase "icono". Son decorativos: aria-hidden, no cambian el nombre de enlaces ni botones.

const TRAZOS = {
  inicio: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  resumen: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  productores: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20c0-3.5 3-6 7-6s7 2.5 7 6M17 11a3 3 0 1 0 0-6M22 20c0-3-2-5-5-5.5",
  revision: "M9 4h6v3H9zM7 5H5v16h14V5h-2M8.5 14l2.5 2.5 5-5",
  recolecciones: "M8 3h8M9 3v4l-3 4v9h12v-9l-3-4V3M6 14h12",
  alertas: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4",
  calidad: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9",
  jornada: "M12 3c-3 4.5-6 7.5-6 11a6 6 0 0 0 12 0c0-3.5-3-6.5-6-11z",
  personal: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.5-7 8-7s8 3 8 7",
  acopiadores: "M3 16V7h11v9M14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  rutas: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  analistas: "M10 3h4M11 3v5l-1 1M6 21h12M8 17h8M12 17a5 5 0 0 0 0-10",
  planta: "M3 21V10l5 3V10l5 3V10l5 3V4h3v17zM7 17h2M12 17h2M17 17h2",
  produccion: "M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8M12 12v8",
  ventas: "M3 4h2l2.5 11h11L21 7H6.5M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  almacen: "M3 7l9-4 9 4v13H3zM3 7h18M8 20v-7h8v7M8 16h8",
  recetas: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6",
  dinero: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4",
  pagos: "M12 3v18M16.5 7.5C16 6 14.5 5 12 5c-3 0-4.5 1.5-4.5 3.25S9 11 12 12s4.5 2 4.5 3.75S15 19 12 19c-2.5 0-4.2-1-4.7-2.5",
  gastos: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  movimientos: "M4 6h16M4 12h16M4 18h10M18 16l2 2-2 2",
  configuracion: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  desplegar: "M9 6l6 6-6 6",
  ok: "M5 12.5l4.5 4.5L19 7.5",
  aviso: "M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.2v.1",
  reloj: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
  error: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6",
  pin: "M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  externo: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
} as const;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, clase }: { nombre: NombreIcono; clase?: string }) {
  return (
    <svg className={clase ? `icono ${clase}` : "icono"} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}
