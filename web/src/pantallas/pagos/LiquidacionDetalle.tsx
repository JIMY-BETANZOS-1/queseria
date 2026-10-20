import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ErrorApi } from "../../api/cliente";
import { listarParametros } from "../../api/configuracion";
import { eliminarLiquidacion, obtenerLiquidacion, pagarLiquidacion } from "../../api/pagos";
import { Confirmar } from "../../comun/Confirmar";
import { fecha, fechaHoraLima, litros, plural, soles } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

/** A11 · Comprobante de una liquidación (se imprime con el navegador), marcarla pagada o eliminarla. */
export default function LiquidacionDetalle() {
  const { id } = useParams();
  const numero = Number(id);
  const valido = Number.isInteger(numero) && numero > 0;
  const navegar = useNavigate();
  const { carga, recargar, ponerDatos } = useCarga(
    () => (valido ? obtenerLiquidacion(numero) : Promise.reject(new ErrorApi(404, "no_encontrado", "La liquidación no existe"))),
    [numero],
  );
  const [ventana, setVentana] = useState<"pagar" | "eliminar" | null>(null);
  // Solo para el encabezado impreso: si no carga, el comprobante sale sin el nombre de la empresa
  const parametros = useCarga(listarParametros, []);
  const [emitido] = useState(() => Date.now());
  useTitulo(carga.estado === "listo" ? `Liquidación ${carga.datos.productor}` : "Liquidación");

  const miga = <p className="miga no-imprimir"><Link to="/pagos/productores">Pagos a productores</Link> › Liquidación</p>;
  if (carga.estado === "cargando") return <>{miga}<p>Cargando liquidación…</p></>;
  if (carga.estado === "error") {
    return (
      <>
        {miga}
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      </>
    );
  }

  const l = carga.datos;
  const pagada = l.estado === "pagado";
  const empresa = parametros.carga.estado === "listo"
    ? parametros.carga.datos.find((p) => p.clave === "empresa_nombre")?.valor
    : undefined;
  return (
    <>
      {miga}
      <div className="solo-imprimir encabezado-comprobante">
        {empresa && <p><strong>{empresa}</strong></p>}
        <p>Comprobante de liquidación · emitido el {fechaHoraLima(emitido)}</p>
      </div>
      <div className="encabezado">
        <h1>Liquidación de {l.productor} <span className="texto-suave codigo">{l.productor_codigo}</span></h1>
        {pagada ? <Insignia tono="ok">Pagada</Insignia> : <Insignia tono="atencion">Pendiente de pago</Insignia>}
      </div>
      <p>
        Periodo del {fecha(l.desde)} al {fecha(l.hasta)}
        {l.pagada_en && <> · pagada el {fechaHoraLima(l.pagada_en)}</>}
      </p>

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha y hora</th>
            <th className="numero">Litros</th>
            <th className="numero">Precio por litro</th>
            <th>Sanción</th>
            <th className="numero">Monto</th>
          </tr>
        </thead>
        <tbody>
          {l.lineas.map((x) => (
            <tr key={x.recoleccion_id}>
              <td>{fechaHoraLima(x.registrada_en)}</td>
              <td className="numero">{litros(x.litros)}</td>
              <td className="numero">{soles(x.precio_litro, 3)}</td>
              <td>{x.con_sancion ? "Sí" : ""}</td>
              <td className="numero">{soles(x.monto)}</td>
            </tr>
          ))}
          <tr>
            <td><strong>Total ({plural(l.n_recolecciones, "entrega", "entregas")})</strong></td>
            <td className="numero"><strong>{litros(l.litros)}</strong></td>
            <td />
            <td />
            <td className="numero"><strong>{soles(l.monto)}</strong></td>
          </tr>
        </tbody>
      </table>
      {l.litros_con_sancion > 0 && (
        <p>{litros(l.litros_con_sancion)} con precio de sanción: descuento de {soles(l.descuento_sancion)} frente al precio normal.</p>
      )}

      <div className="fila-acciones no-imprimir">
        <button type="button" className="boton boton-secundario" onClick={() => window.print()}>Imprimir comprobante</button>
        {!pagada && (
          <>
            <button type="button" className="boton boton-primario" onClick={() => setVentana("pagar")}>Marcar pagada</button>
            <button type="button" className="boton boton-peligro-suave" onClick={() => setVentana("eliminar")}>Eliminar</button>
          </>
        )}
      </div>

      {ventana === "pagar" && (
        <Confirmar
          titulo="Marcar liquidación pagada"
          textoConfirmar="Marcar pagada"
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            await pagarLiquidacion(l.liquidacion_id);
            ponerDatos(await obtenerLiquidacion(l.liquidacion_id));
            setVentana(null);
          }}
        >
          <ul className="lista-avisos">
            <li>Queda pagada por {soles(l.monto)}, con la fecha y hora de ahora y a su nombre.</li>
            <li>Una liquidación pagada ya no se puede modificar ni eliminar.</li>
          </ul>
        </Confirmar>
      )}

      {ventana === "eliminar" && (
        <Confirmar
          titulo="Eliminar liquidación"
          textoConfirmar="Eliminar"
          peligro
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            await eliminarLiquidacion(l.liquidacion_id);
            navegar("/pagos/productores");
          }}
        >
          <ul className="lista-avisos">
            <li>{l.n_recolecciones === 1 ? "Su entrega vuelve" : `Sus ${l.n_recolecciones} entregas vuelven`} a "por pagar".</li>
            <li>Para liquidarlas otra vez, puede usar el mismo periodo: al eliminarla, ese periodo queda libre para este
              productor.</li>
          </ul>
        </Confirmar>
      )}
    </>
  );
}
