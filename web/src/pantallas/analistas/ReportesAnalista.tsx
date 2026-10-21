import { useEffect, useState } from "react";

import { fotoDeReporte, listarReportesAnalista } from "../../api/reportes";
import type { ReporteAnalista } from "../../api/tipos";
import { fechaHoraLima, horaLima } from "../../comun/formato";
import { useCarga } from "../../comun/useCarga";

/**
 * Reportes que los analistas envían desde el celular: solo informativos (no registran calidad ni sanciones; la
 * decisión es del administrador). La foto se pide con el token y se muestra como blob: (permitido en img-src).
 */
export default function ReportesAnalista() {
  const { carga, recargar } = useCarga(listarReportesAnalista, []);

  return (
    <section className="seccion" aria-labelledby="reportes-analista">
      <div className="encabezado-seccion">
        <h2 id="reportes-analista">Reportes del analista</h2>
        <button type="button" className="boton boton-secundario" onClick={recargar}>Actualizar</button>
      </div>
      <p className="texto-suave">
        Fotos que el analista toma de un productor desde su celular. Son informativas: no cambian la calidad ni
        generan sanciones. El comentario que escribe se guarda solo en su celular (la base aún no tiene dónde
        guardarlo).
      </p>
      {carga.estado === "cargando" && <p>Cargando reportes…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (carga.datos.length === 0 ? (
        <p className="vacio">Todavía no hay reportes del analista.</p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Productor</th>
              <th>Comentario</th>
              <th>Foto</th>
            </tr>
          </thead>
          <tbody>
            {carga.datos.map((r) => (
              <tr key={r.recoleccion_id}>
                <td>{fechaHoraLima(r.creado_en).slice(0, 10)}</td>
                <td>{horaLima(r.creado_en)}</td>
                <td>
                  {r.productor}
                  <div className="texto-suave">
                    {r.productor_codigo} · {r.ruta ?? "Externo"} · entrega del {fechaHoraLima(r.entrega_registrada_en)}
                  </div>
                </td>
                <td className="texto-suave">Solo en el celular</td>
                <td><FotoReporte reporte={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}

/** La foto se descarga al pedirla (no las 200 de golpe) y su URL blob: se libera al ocultarla. */
function FotoReporte({ reporte }: { reporte: ReporteAnalista }) {
  const [url, setUrl] = useState<string | null>(null);
  const [estado, setEstado] = useState<"oculta" | "cargando" | "error">("oculta");

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  async function mostrar() {
    setEstado("cargando");
    try {
      setUrl(URL.createObjectURL(await fotoDeReporte(reporte.recoleccion_id)));
      setEstado("oculta");
    } catch {
      setEstado("error");
    }
  }

  if (url) {
    return (
      <div>
        <img className="foto-reporte" src={url} alt={`Foto del reporte de ${reporte.productor}`} />
        <button type="button" className="boton-enlace" onClick={() => setUrl(null)}>Ocultar</button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="boton boton-secundario" onClick={mostrar} disabled={estado === "cargando"}>
        {estado === "cargando" ? "Cargando…" : "Ver foto"}
      </button>
      {estado === "error" && <div className="campo-error">No se pudo cargar la foto</div>}
    </>
  );
}
