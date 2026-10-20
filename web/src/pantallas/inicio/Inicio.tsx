import { useState } from "react";
import { Link } from "react-router-dom";

import { jornadas, obtenerDashboard } from "../../api/dashboard";
import { lotesDisponibles } from "../../api/produccion";
import { hoyLima, litros, plural, primerDiaDelMes, soles, sumarDias } from "../../comun/formato";
import { Icono, type NombreIcono } from "../../comun/Iconos";
import { Insignia } from "../../comun/Insignia";
import { type Carga, useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { DIAS_LECHE } from "../produccion/Produccion";

/** Cifra de una tarjeta: "…" mientras carga, "—" si falló (la tarjeta lleva igual a su pantalla). */
function cifra<T>(carga: Carga<T>, texto: (datos: T) => string): string {
  return carga.estado === "listo" ? texto(carga.datos) : carga.estado === "cargando" ? "…" : "—";
}

/** Un paso del flujo del día. El número es decorativo: el orden ya lo da la lista numerada (<ol>). */
function Tarjeta({ numero, ruta, icono, titulo, valor, detalle, pendiente = false }: {
  numero: number; ruta: string; icono: NombreIcono; titulo: string; valor: string; detalle: string; pendiente?: boolean;
}) {
  return (
    <li className="paso">
      <Link to={ruta} className={pendiente ? "tarjeta-accion pendiente" : "tarjeta-accion"}>
        <span className="tarjeta-accion-cabecera">
          <span className="tarjeta-accion-numero" aria-hidden="true">{numero}</span>
          <Icono nombre={icono} clase="tarjeta-accion-icono" />
        </span>
        <span className="tarjeta-accion-titulo">{titulo}</span>
        <span className="tarjeta-accion-cifra">{valor}</span>
        <span className="tarjeta-accion-detalle">{detalle}</span>
        {/* El borde dorado no basta (no todos distinguen colores): también lo dice con texto */}
        {pendiente && <span className="tarjeta-accion-pendiente"><Insignia tono="atencion">Pendiente</Insignia></span>}
      </Link>
    </li>
  );
}

/** Pantalla de inicio: las cuatro tareas del día con su cifra y lo que requiere atención. Solo lee endpoints existentes. */
export default function Inicio() {
  useTitulo("Inicio");
  const [hoy] = useState(() => hoyLima());
  const resumen = useCarga(() => obtenerDashboard(primerDiaDelMes(hoy)), [hoy]);
  const leche = useCarga(() => jornadas(sumarDias(hoy, -(DIAS_LECHE - 1)), hoy), [hoy]);
  const lotes = useCarga(lotesDisponibles, []);
  const sinRevisar = resumen.carga.estado === "listo" ? resumen.carga.datos.atencion.entregas_sin_revisar : null;
  const a = resumen.carga.estado === "listo" ? resumen.carga.datos.atencion : null;
  const js = leche.carga.estado === "listo" ? leche.carga.datos : null;
  const litrosHoy = js?.find((j) => j.fecha === hoy)?.litros_recolectados ?? 0;
  const disponible = js === null ? 0 : Math.round(js.reduce((s, j) => s + j.litros_disponibles, 0) * 100) / 100;
  const sinDestino = js !== null && js.some((j) => j.sin_destino);
  const conSaldo = lotes.carga.estado === "listo" ? lotes.carga.datos.length : null;
  const pagable = resumen.carga.estado === "listo" ? resumen.carga.datos.por_pagar.monto_pagable : null;
  const sinRevisarTexto = sinRevisar === null || sinRevisar === 0 ? "" : ` · ${plural(sinRevisar, "entrega", "entregas")} sin revisar`;

  return (
    <>
      <div className="encabezado">
        <h1>Inicio</h1>
      </div>

      {/* Lo que requiere atención, primero: una franja de etiquetas que llevan a su pantalla */}
      <section className="franja-atencion" aria-labelledby="inicio-atencion">
        <h2 id="inicio-atencion">Requiere atención</h2>
        {resumen.carga.estado === "error" && <p className="aviso aviso-error" role="alert">{resumen.carga.mensaje}</p>}
        {a !== null && (a.alertas_pendientes + a.altas_por_aprobar + a.entregas_sin_revisar === 0 ? (
          <Insignia tono="ok">Nada pendiente</Insignia>
        ) : (
          <ul className="etiquetas-atencion">
            {a.alertas_pendientes > 0 && (
              <li><Link to="/alertas"><Insignia tono={a.alertas_que_retienen > 0 ? "error" : "atencion"}>
                {plural(a.alertas_pendientes, "alerta", "alertas")} sin revisar
              </Insignia></Link></li>
            )}
            {a.entregas_sin_revisar > 0 && (
              <li><Link to="/calidad"><Insignia tono="atencion">
                {plural(a.entregas_sin_revisar, "entrega", "entregas")} por revisar calidad
              </Insignia></Link></li>
            )}
            {a.altas_por_aprobar > 0 && (
              <li><Link to="/productores"><Insignia tono="atencion">
                {plural(a.altas_por_aprobar, "alta", "altas")} de campo por aprobar
              </Insignia></Link></li>
            )}
          </ul>
        ))}
        <Link to="/resumen" className="franja-enlace">Ver el resumen del mes</Link>
      </section>

      {/* Banner o foto de la planta (opcional): va aquí, en web/public/, cuando el cliente la entregue */}
      <ol className="tarjetas-accion" aria-label="Tareas del día">
        <Tarjeta numero={1} ruta="/recolecciones" icono="recolecciones" titulo="Recibir leche"
                 valor={cifra(leche.carga, () => litros(litrosHoy))}
                 detalle={js !== null && litrosHoy === 0 ? `Aún no hay entregas hoy${sinRevisarTexto}`
                   : sinRevisar === null ? "recolectados hoy" : `hoy${sinRevisarTexto}`}
                 pendiente={(sinRevisar ?? 0) > 0} />
        <Tarjeta numero={2} ruta="/produccion" icono="produccion" titulo="Producir"
                 valor={cifra(leche.carga, () => litros(disponible))}
                 detalle={js !== null && disponible === 0 ? "No hay leche aprobada disponible"
                   : `de leche aprobada disponible (últimos ${DIAS_LECHE} días)${sinDestino ? " · hay leche sin destino" : ""}`}
                 pendiente={sinDestino} />
        <Tarjeta numero={3} ruta="/ventas" icono="ventas" titulo="Vender"
                 valor={cifra(lotes.carga, (ls) => plural(ls.length, "lote", "lotes"))}
                 detalle={conSaldo === 0 ? "No hay lotes con saldo" : "con saldo para vender"} />
        <Tarjeta numero={4} ruta="/pagos/productores" icono="pagos" titulo="Pagar"
                 valor={cifra(resumen.carga, (d) => soles(d.por_pagar.monto_pagable))}
                 detalle={pagable === 0 ? "Nada por pagar" : "pagable a productores"} />
      </ol>
    </>
  );
}
