import type { RecoleccionDetalle } from "../../api/tipos";
import { horaLima } from "../../comun/formato";
import { Estado, Vacio } from "../../comun/Estado";
import { Icono } from "../../comun/Iconos";
import { MuestraColor } from "../../comun/MuestraColor";
import { textoUbicacion } from "./ubicacion";

// Mapa propio en SVG, sin fondo ni librerías: a la escala de una ruta (unos km) una proyección plana alcanza.
const ANCHO = 800;
const ALTO = 480;
const MARGEN = 40;
const SPAN_MINIMO_M = 200;                 // para que un solo punto no llene todo el mapa
const M_POR_GRADO_LAT = 110_540;
const M_POR_GRADO_LON_ECUADOR = 111_320;
const ESCALAS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000];

export const enlaceGoogleMaps = (lat: number, lon: number) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`;

export function metros(m: number): string {
  return m >= 1000 ? `${(Math.round(m / 100) / 10).toString()} km` : `${Math.round(m)} m`;
}

type Coordenada = { lat: number; lon: number };

/** Proyección plana sobre el recuadro de los puntos: devuelve x/y del SVG y cuántos px mide un metro. */
export function proyectar(puntos: Coordenada[]) {
  const lats = puntos.map((p) => p.lat);
  const lons = puntos.map((p) => p.lon);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = M_POR_GRADO_LON_ECUADOR * Math.cos((lat0 * Math.PI) / 180);
  const ancho = Math.max((Math.max(...lons) - Math.min(...lons)) * kx, SPAN_MINIMO_M);
  const alto = Math.max((Math.max(...lats) - Math.min(...lats)) * M_POR_GRADO_LAT, SPAN_MINIMO_M);
  const pxPorM = Math.min((ANCHO - 2 * MARGEN) / ancho, (ALTO - 2 * MARGEN) / alto);
  const lonCentro = (Math.min(...lons) + Math.max(...lons)) / 2;
  return {
    pxPorM,
    xy: (c: Coordenada) => ({
      x: ANCHO / 2 + (c.lon - lonCentro) * kx * pxPorM,
      y: ALTO / 2 - (c.lat - lat0) * M_POR_GRADO_LAT * pxPorM,
    }),
  };
}

/** Largo "redondo" de la barra de escala: el mayor que entra en un quinto del ancho. */
export function escala(pxPorM: number): number {
  return [...ESCALAS].reverse().find((m) => m * pxPorM <= ANCHO / 5) ?? ESCALAS[0]!;
}

const conGps = (r: RecoleccionDetalle) => r.latitud !== null && r.longitud !== null;
const conRef = (r: RecoleccionDetalle) => r.latitud_ref !== null && r.longitud_ref !== null;
const lejos = (r: RecoleccionDetalle, umbral: number | null) =>
  umbral !== null && r.distancia_ref_m !== null && r.distancia_ref_m > umbral;

/**
 * Entregas en el mapa: punto real (color del acopiador; borde punteado si es la última ubicación conocida, "!" si
 * fue simulada), referencia del productor (anillo) y la línea entre ambos con la distancia (de la base). `umbral` es
 * max_distancia_productor_m de la configuración: más lejos se resalta (la alerta la crea la base).
 */
export function MapaEntregas({ filas, umbral }: { filas: RecoleccionDetalle[]; umbral: number | null }) {
  const enMapa = filas.filter((r) => conGps(r) || conRef(r));
  const sinUbicacion = filas.filter((r) => !conGps(r));
  if (enMapa.length === 0) {
    return <Vacio icono="pin">Ninguna entrega tiene ubicación ni referencia de su productor.</Vacio>;
  }
  const coordenadas: Coordenada[] = enMapa.flatMap((r) => [
    ...(conGps(r) ? [{ lat: r.latitud!, lon: r.longitud! }] : []),
    ...(conRef(r) ? [{ lat: r.latitud_ref!, lon: r.longitud_ref! }] : []),
  ]);
  const { xy, pxPorM } = proyectar(coordenadas);
  const barra = escala(pxPorM);
  const referencias = new Map(enMapa.filter(conRef).map((r) => [r.productor_id, r]));
  const acopiadores = new Map(filas.map((r) => [r.registrado_por, r]));
  const conPunto = enMapa.filter(conGps).length;
  // Un nombre por productor (junto a su primera entrega en el mapa), con "×N" si tiene varias: no se amontonan
  const puntosPorProductor = new Map<number, number>();
  for (const r of enMapa.filter(conGps)) puntosPorProductor.set(r.productor_id, (puntosPorProductor.get(r.productor_id) ?? 0) + 1);
  const primeraDe = new Map<number, string>();
  for (const r of enMapa.filter(conGps)) if (!primeraDe.has(r.productor_id)) primeraDe.set(r.productor_id, r.recoleccion_id);

  return (
    <figure className="mapa">
      <svg className="mapa-svg" viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img"
           aria-label={`Mapa de ${conPunto} ${conPunto === 1 ? "entrega" : "entregas"} con ubicación y la referencia de su productor`}>
        <rect className="mapa-fondo" x="0" y="0" width={ANCHO} height={ALTO} />
        {enMapa.filter((r) => conGps(r) && conRef(r) && (r.distancia_ref_m ?? 0) > 0).map((r) => {
          const a = xy({ lat: r.latitud!, lon: r.longitud! });
          const b = xy({ lat: r.latitud_ref!, lon: r.longitud_ref! });
          return (
            <g key={`l-${r.recoleccion_id}`} className={lejos(r, umbral) ? "mapa-tramo lejos" : "mapa-tramo"}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 6}>{metros(r.distancia_ref_m!)}</text>
            </g>
          );
        })}
        {[...referencias.values()].map((r) => {
          const p = xy({ lat: r.latitud_ref!, lon: r.longitud_ref! });
          return <circle key={`r-${r.productor_id}`} className="mapa-ref" cx={p.x} cy={p.y} r="10" />;
        })}
        {enMapa.filter(conGps).map((r) => {
          const p = xy({ lat: r.latitud!, lon: r.longitud! });
          const clases = ["mapa-punto", r.origen_ubicacion === "ultima_conocida" && "aproximada", r.ubicacion_simulada && "simulada"]
            .filter(Boolean).join(" ");
          return (
            <a key={`p-${r.recoleccion_id}`} href={enlaceGoogleMaps(r.latitud!, r.longitud!)} target="_blank"
               rel="noopener noreferrer" aria-label={`Ver en Google Maps: ${r.productor}, ${horaLima(r.registrada_en)}`}>
              <circle className={clases} cx={p.x} cy={p.y} r="7" fill={r.color_hex ?? undefined} />
              {r.ubicacion_simulada && <text className="mapa-marca" x={p.x + 9} y={p.y - 8}>!</text>}
              {primeraDe.get(r.productor_id) === r.recoleccion_id && (
                <text className="mapa-nombre" x={p.x + 12} y={p.y + 5}>
                  {r.productor}{(puntosPorProductor.get(r.productor_id) ?? 0) > 1 && ` ×${puntosPorProductor.get(r.productor_id)}`}
                </text>
              )}
            </a>
          );
        })}
        <g className="mapa-escala">
          <line x1={MARGEN} y1={ALTO - 16} x2={MARGEN + barra * pxPorM} y2={ALTO - 16} />
          <text x={MARGEN} y={ALTO - 22}>{metros(barra)}</text>
        </g>
      </svg>
      <figcaption className="mapa-leyenda">
        {[...acopiadores.values()].map((r) => (
          <span key={r.registrado_por}>{r.color_hex && <MuestraColor color={r.color_hex} />} {r.registrado_por_nombre}</span>
        ))}
        <span>○ referencia del productor</span>
        <span>— distancia a su referencia{umbral !== null && ` (más de ${metros(umbral)}: lejos)`}</span>
      </figcaption>

      <table className="tabla" aria-label="Entregas en el mapa">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Productor</th>
            <th>Ubicación</th>
            <th>A su referencia</th>
            <th>Google Maps</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.recoleccion_id}>
              <td>{horaLima(r.registrada_en)}</td>
              <td>{r.productor}</td>
              <td>
                <span>{textoUbicacion(r)}</span>
                {r.ubicacion_simulada && <> <Estado tono="error">Simulada</Estado></>}
              </td>
              <td>
                {r.distancia_ref_m === null ? (conRef(r) ? "—" : "Sin referencia")
                  : <>{metros(r.distancia_ref_m)}{lejos(r, umbral) && <> <Estado tono="atencion" icono="aviso">Lejos</Estado></>}</>}
              </td>
              <td className="enlaces-mapa">
                {conGps(r) && (
                  <a href={enlaceGoogleMaps(r.latitud!, r.longitud!)} target="_blank" rel="noopener noreferrer"
                     aria-label={`Ver en Google Maps la entrega de ${r.productor}`}>
                    Ver en Google Maps <Icono nombre="externo" />
                  </a>
                )}
                {conRef(r) && (
                  <a href={enlaceGoogleMaps(r.latitud_ref!, r.longitud_ref!)} target="_blank" rel="noopener noreferrer"
                     aria-label={`Ver en Google Maps la referencia de ${r.productor}`}>
                    Referencia <Icono nombre="externo" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sinUbicacion.length > 0 && (
        <p className="texto-suave">
          Sin ubicación ({sinUbicacion.length}): {sinUbicacion.map((r) => `${r.productor} ${horaLima(r.registrada_en)}`).join(", ")}.
        </p>
      )}
    </figure>
  );
}
