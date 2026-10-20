import { useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { jornadas, obtenerDashboard } from "../../api/dashboard";
import { hoyLima, litros, nombreMes, plural, primerDiaDelMes, soles, sumarDias } from "../../comun/formato";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { diasDelGrafico, GraficoLeche } from "./GraficoLeche";

const MES = /^\d{4}-\d{2}$/;
const DIAS_GRAFICO = 14;

function Dato({ titulo, cifra, children, atencion = false, negativo = false }: {
  titulo: string; cifra: ReactNode; children?: ReactNode; atencion?: boolean; negativo?: boolean;
}) {
  return (
    <div className={atencion ? "tarjeta-dato atencion" : "tarjeta-dato"}>
      <span className="texto-suave">{titulo}</span>
      <span className={negativo ? "cifra negativo" : "cifra"}>{cifra}</span>
      {children}
    </div>
  );
}

/** A2 (mínimo) · Lo que requiere atención, la leche del mes, el dinero del mes y la leche de los últimos 14 días. */
export default function Dashboard() {
  useTitulo("Resumen");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const [parametros, setParametros] = useSearchParams();
  const pedido = parametros.get("mes");
  const aaaaMm = pedido !== null && MES.test(pedido) ? pedido : hoy.slice(0, 7);
  const mes = primerDiaDelMes(aaaaMm);
  const { carga, recargar } = useCarga(() => obtenerDashboard(mes), [mes]);
  const desde = sumarDias(hoy, -(DIAS_GRAFICO - 1));
  const grafico = useCarga(() => jornadas(desde, hoy), [desde, hoy]);

  return (
    <>
      <div className="encabezado">
        <h1>Resumen</h1>
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-mes`}>Mes</label>
          <input id={`${id}-mes`} type="month" max={hoy.slice(0, 7)} value={aaaaMm}
                 onChange={(e) => MES.test(e.target.value) && setParametros({ mes: e.target.value })} />
        </div>
      </div>

      {carga.estado === "cargando" && <p>Cargando…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (() => {
        const d = carga.datos;
        const a = d.atencion;
        return (
          <>
            <section className="seccion" aria-labelledby={`${id}-atencion`}>
              <h2 id={`${id}-atencion`}>Requiere atención</h2>
              <div className="tarjetas">
                <Dato titulo="Alertas sin revisar" cifra={a.alertas_pendientes} atencion={a.alertas_que_retienen > 0}>
                  <span>{a.alertas_que_retienen === 1 ? "1 retiene el pago" : `${a.alertas_que_retienen} retienen el pago`} · <Link to="/alertas">Ver alertas</Link></span>
                </Dato>
                <Dato titulo="Entregas sin revisar (calidad)" cifra={a.entregas_sin_revisar} atencion={a.entregas_sin_revisar > 0}>
                  <span>Sin revisar no se pagan · <Link to="/calidad">Revisar</Link></span>
                </Dato>
                <Dato titulo="Altas de campo por aprobar" cifra={a.altas_por_aprobar} atencion={a.altas_por_aprobar > 0}>
                  <span><Link to="/productores">Ver productores</Link></span>
                </Dato>
                <Dato titulo="Productores sancionados o bloqueados" cifra={a.productores_observados} />
                <Dato titulo="Liquidaciones por pagar" cifra={d.por_pagar.liquidaciones_pendientes}>
                  <span>{soles(d.por_pagar.monto_liquidaciones_pendientes)} · <Link to="/pagos/productores">Ver pagos</Link></span>
                </Dato>
              </div>
            </section>

            <section className="seccion" aria-labelledby={`${id}-leche`}>
              <h2 id={`${id}-leche`}>Leche de {nombreMes(d.mes)}</h2>
              <div className="tarjetas">
                <Dato titulo="Recolectada" cifra={litros(d.leche.litros_recolectados)} />
                <Dato titulo="Aprobada" cifra={litros(d.leche.litros_aprobados)} />
                <Dato titulo="Por revisar" cifra={litros(d.leche.litros_por_revisar)} />
                <Dato titulo="Descartada (alterada)" cifra={litros(d.leche.litros_descartados)} />
              </div>
            </section>

            <section className="seccion" aria-labelledby={`${id}-dinero`}>
              <h2 id={`${id}-dinero`}>Dinero de {nombreMes(d.mes)}</h2>
              <div className="tarjetas">
                <Dato titulo="Por pagar a productores (acumulado a hoy)" cifra={soles(d.por_pagar.monto_pagable)}>
                  <span>{soles(d.por_pagar.monto_en_espera)} en espera (sin revisar o retenido)</span>
                </Dato>
                <Dato titulo="Sueldos estimados de acopiadores" cifra={soles(d.acopiadores.sueldo_estimado)}>
                  <span>{soles(d.acopiadores.pagado)} pagado · {plural(d.acopiadores.pagos_pendientes, "pago pendiente", "pagos pendientes")}</span>
                </Dato>
                <Dato titulo="Flujo de caja del mes" cifra={soles(d.flujo.saldo_caja)} negativo={d.flujo.saldo_caja < 0}>
                  <span>
                    Ingresos {soles(d.flujo.ingresos)} − leche {soles(d.flujo.egreso_leche)} − insumos{" "}
                    {soles(d.flujo.egreso_insumos)} − lotes {soles(d.flujo.egreso_lotes)} − gastos {soles(d.flujo.egreso_operativo)}
                  </span>
                </Dato>
                <Dato titulo="Resultado (utilidad neta)" cifra={soles(d.resultado.utilidad_neta)} negativo={d.resultado.utilidad_neta < 0}>
                  <span>
                    Ventas {soles(d.resultado.ingresos)} − costo de lo vendido {soles(d.resultado.costo_ventas)} − pérdidas de
                    producto {soles(d.resultado.perdida_producto)} − pérdidas de leche {soles(d.resultado.perdida_leche)}
                    {d.leche.litros_por_revisar > 0 && " (incluye leche aún sin revisar)"} − gastos {soles(d.resultado.gasto_operativo)}
                  </span>
                  {/* v_resultado_mensual: perdida_leche = merma + lo pagado en días sin ninguna leche aprobada */}
                  {d.leche.litros_por_revisar > 0 && (
                    <span className="texto-suave">
                      La base cuenta como pérdida lo pagado en los días sin ninguna leche aprobada: un día con leche aún sin
                      revisar entra ahí hasta que se revise.
                    </span>
                  )}
                </Dato>
              </div>
              <p className="texto-suave">
                Los ingresos son las ventas registradas en Ventas; el costo de lo vendido sale de los lotes de Producción.
                Las compras de insumos van al flujo de su mes; al resultado entran recién cuando se usan en lo vendido. Flujo
                y resultado los calcula la base (v_flujo_mensual, v_resultado_mensual).
              </p>
            </section>
          </>
        );
      })()}

      <section className="seccion" aria-labelledby={`${id}-dias`}>
        <h2 id={`${id}-dias`}>Leche de los últimos {DIAS_GRAFICO} días</h2>
        {grafico.carga.estado === "cargando" && <p>Cargando…</p>}
        {grafico.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {grafico.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={grafico.recargar}>Reintentar</button>
          </p>
        )}
        {grafico.carga.estado === "listo" && <GraficoLeche dias={diasDelGrafico(desde, DIAS_GRAFICO, grafico.carga.datos)} />}
      </section>
    </>
  );
}
