import { useId, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ErrorSesion } from "../../api/cliente";
import { acopiadoresDelMes, editarPagoAcopiador, eliminarPagoAcopiador, pagarAcopiador,
         registrarPagoAcopiador } from "../../api/pagos";
import type { AcopiadorMes } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { Confirmar } from "../../comun/Confirmar";
import { fechaHoraLima, hoyLima, litros, nombreMes, primerDiaDelMes, soles } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { Modal } from "../../comun/Modal";
import { mensajeDeError, useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

const MES = /^\d{4}-\d{2}$/;
const MONTO = /^-?\d{1,7}(\.\d{1,2})?$/;

type Ventana =
  | { tipo: "registrar" | "editar"; fila: AcopiadorMes }
  | { tipo: "pagar" | "eliminar"; fila: AcopiadorMes };

/** Registrar o editar el pago (ajustes y nota). */
function VentanaPago({ fila, mes, editar, onHecho, onCerrar }: {
  fila: AcopiadorMes; mes: string; editar: boolean; onHecho: () => void; onCerrar: () => void;
}) {
  const id = useId();
  const [ajustes, setAjustes] = useState(editar ? String(fila.ajustes ?? 0) : "0");
  const [nota, setNota] = useState(editar ? fila.nota ?? "" : "");
  const [error, setError] = useState<string | undefined>();
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const base = editar ? fila.pago_sueldo_base ?? 0 : fila.sueldo_base_mensual;
  const comision = editar ? fila.pago_comision ?? 0 : fila.comision_estimada;

  async function guardar() {
    setGeneral(null);
    if (!MONTO.test(ajustes.trim())) {
      setError("Monto en soles, con signo menos si es descuento y hasta 2 decimales");
      return;
    }
    setError(undefined);
    setOcupada(true);
    const datos = { ajustes: Number(ajustes.trim()), nota: nota.trim() === "" ? null : nota.trim() };
    try {
      if (editar) await editarPagoAcopiador(fila.pago_id!, datos);
      else await registrarPagoAcopiador({ acopiador_id: fila.acopiador_id, mes, ...datos });
      onHecho();
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(e));
      setOcupada(false);
    }
  }

  const total = Math.round((base + comision + (MONTO.test(ajustes.trim()) ? Number(ajustes.trim()) : 0)) * 100) / 100;
  return (
    <Modal
      titulo={editar ? "Editar pago" : "Registrar pago del mes"}
      onCerrar={onCerrar}
      ocupada={ocupada}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
          <button type="button" className="boton boton-primario" onClick={guardar} disabled={ocupada}>
            {ocupada ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <p>{fila.nombre_completo} · {nombreMes(mes)}</p>
      <ul className="lista-avisos">
        <li>Sueldo base {soles(base)} + comisión {soles(comision)}{editar ? " (los del registro)" : " (lo estimado ahora)"}.</li>
        {!editar && <li>Se guardan los litros, el sueldo base y la comisión de este momento. Queda pendiente hasta marcarlo pagado.</li>}
      </ul>
      <Campo id={`${id}-ajustes`} etiqueta="Ajustes (S/)" error={error} deshabilitado={ocupada}
             ayuda="Bonos en positivo, descuentos en negativo.">
        {(p) => <input {...p} type="text" inputMode="decimal" value={ajustes} onChange={(e) => setAjustes(e.target.value)} />}
      </Campo>
      <Campo id={`${id}-nota`} etiqueta="Nota (opcional)" deshabilitado={ocupada}>
        {(p) => <input {...p} type="text" value={nota} onChange={(e) => setNota(e.target.value)} />}
      </Campo>
      <p><strong>Total: {soles(total)}</strong></p>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}

/** A5 (pago mensual) · Sueldo estimado de cada acopiador y su pago, que al pagarse registra el gasto. */
export default function PagosAcopiadores() {
  useTitulo("Sueldos de acopiadores");
  const id = useId();
  const [parametros, setParametros] = useSearchParams();
  const [actual] = useState(() => hoyLima().slice(0, 7));
  const pedido = parametros.get("mes");
  const aaaaMm = pedido !== null && MES.test(pedido) ? pedido : actual;
  const mes = primerDiaDelMes(aaaaMm);
  const { carga, recargar } = useCarga(() => acopiadoresDelMes(mes), [mes]);
  const [ventana, setVentana] = useState<Ventana | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function hecho(texto: string) {
    setVentana(null);
    setAviso(texto);
    recargar();
  }

  return (
    <>
      <div className="encabezado">
        <h1>Sueldos de acopiadores</h1>
      </div>
      <div className="filtros">
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-mes`}>Mes</label>
          <input id={`${id}-mes`} type="month" max={actual} value={aaaaMm}
                 onChange={(e) => MES.test(e.target.value) && setParametros({ mes: e.target.value })} />
        </div>
      </div>
      <p className="texto-suave">
        Sueldo estimado = sueldo base + comisión por litro de la leche normal del mes (las anuladas no cuentan).
      </p>
      {aviso !== null && <p className="aviso aviso-ok" role="status">{aviso}</p>}

      {carga.estado === "cargando" && <p>Cargando…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (carga.datos.length === 0 ? (
        <p className="texto-suave">No hay acopiadores para {nombreMes(mes)}.</p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Acopiador</th>
              <th className="numero">Entregas</th>
              <th className="numero">Litros normales</th>
              <th className="numero">Sueldo base</th>
              <th className="numero">Comisión</th>
              <th className="numero">Estimado</th>
              <th>Pago</th>
              <th><span className="solo-lector">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {carga.datos.map((a) => (
              <tr key={a.acopiador_id}>
                <td>{a.nombre_completo}{!a.activo && <> <Insignia tono="neutro">Inactivo</Insignia></>}</td>
                <td className="numero">{a.recolecciones}</td>
                <td className="numero">{litros(a.litros_normales)}</td>
                <td className="numero">{soles(a.sueldo_base_mensual)}</td>
                <td className="numero">{soles(a.comision_estimada)}</td>
                <td className="numero">{soles(a.sueldo_estimado)}</td>
                <td>
                  {a.pago_id === null ? <span className="texto-suave">Sin registrar</span> : (
                    <>
                      {a.estado === "pagado" ? <Insignia tono="ok">Pagado</Insignia> : <Insignia tono="atencion">Pendiente</Insignia>}{" "}
                      {soles(a.total ?? 0)}
                      {a.ajustes !== null && a.ajustes !== 0 && <span className="texto-suave"> (ajustes {soles(a.ajustes)})</span>}
                      {a.pagado_en && <><br /><span className="texto-suave">el {fechaHoraLima(a.pagado_en)}</span></>}
                      {a.nota && <><br /><span className="texto-suave">{a.nota}</span></>}
                    </>
                  )}
                </td>
                <td>
                  <div className="fila-acciones">
                    {a.pago_id === null && (
                      <button type="button" className="boton boton-secundario" onClick={() => setVentana({ tipo: "registrar", fila: a })}>
                        Registrar pago
                      </button>
                    )}
                    {a.pago_id !== null && a.estado === "pendiente" && (
                      <>
                        <button type="button" className="boton boton-primario" onClick={() => setVentana({ tipo: "pagar", fila: a })}>
                          Marcar pagado
                        </button>
                        <button type="button" className="boton boton-secundario" onClick={() => setVentana({ tipo: "editar", fila: a })}>
                          Editar
                        </button>
                        <button type="button" className="boton boton-peligro-suave" onClick={() => setVentana({ tipo: "eliminar", fila: a })}>
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      {(ventana?.tipo === "registrar" || ventana?.tipo === "editar") && (
        <VentanaPago fila={ventana.fila} mes={mes} editar={ventana.tipo === "editar"} onCerrar={() => setVentana(null)}
                     onHecho={() => hecho(ventana.tipo === "editar" ? "Pago actualizado." : "Pago registrado: queda pendiente.")} />
      )}

      {ventana?.tipo === "pagar" && (
        <Confirmar
          titulo="Marcar pago como pagado"
          textoConfirmar="Marcar pagado"
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            await pagarAcopiador(ventana.fila.pago_id!);
            hecho(`Pago de ${ventana.fila.nombre_completo} marcado como pagado.`);
          }}
        >
          <ul className="lista-avisos">
            <li>Se registra el gasto "Sueldo acopiador" por {soles(ventana.fila.total ?? 0)} con la fecha de hoy.</li>
            <li>El pago queda cerrado: ya no se puede editar ni eliminar.</li>
          </ul>
        </Confirmar>
      )}

      {ventana?.tipo === "eliminar" && (
        <Confirmar
          titulo="Eliminar pago pendiente"
          textoConfirmar="Eliminar"
          peligro
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            await eliminarPagoAcopiador(ventana.fila.pago_id!);
            hecho("Pago eliminado: puede registrarlo de nuevo con lo estimado de ahora.");
          }}
        >
          <p>Se borra el pago pendiente de {ventana.fila.nombre_completo}. No se registró ningún gasto.</p>
        </Confirmar>
      )}
    </>
  );
}
