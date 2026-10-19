import { useId, useState, type FormEvent, type ReactNode } from "react";

import { ErrorApi, ErrorSesion } from "../../api/cliente";
import type { Acopiador, AcopiadorNuevo, Vehiculo } from "../../api/tipos";
import { esColorValido } from "../../comun/MuestraColor";
import { mensajeDeError } from "../../comun/useCarga";

export const VEHICULOS: { valor: Vehiculo; texto: string }[] = [
  { valor: "moto_lineal", texto: "Moto lineal" },
  { valor: "motocarga", texto: "Motocarga" },
  { valor: "vehiculo_mediano", texto: "Vehículo mediano" },
];

export function textoVehiculo(v: Vehiculo): string {
  return VEHICULOS.find((x) => x.valor === v)?.texto ?? v;
}

/** Valores del formulario como texto (lo que escribe el admin); se convierten al guardar. */
export type Valores = {
  nombre_completo: string;
  dni: string;
  celular: string;
  color_hex: string;
  vehiculo: Vehiculo;
  sueldo_base_mensual: string;
  comision_por_litro: string;
};
type Campo = keyof Valores;
type Errores = Partial<Record<Campo, string>>;

export function valoresDe(a: Acopiador): Valores {
  return {
    nombre_completo: a.nombre_completo,
    dni: a.dni,
    celular: a.celular,
    color_hex: a.color_hex.toUpperCase(),
    vehiculo: a.vehiculo,
    sueldo_base_mensual: String(a.sueldo_base_mensual),
    comision_por_litro: String(a.comision_por_litro),
  };
}

/** Datos para la API (mismos nombres que AcopiadorNuevo). */
export function datosDe(v: Valores): AcopiadorNuevo {
  return {
    nombre_completo: v.nombre_completo.trim(),
    dni: v.dni.trim(),
    celular: v.celular.trim(),
    color_hex: v.color_hex.toUpperCase(),
    vehiculo: v.vehiculo,
    sueldo_base_mensual: Number(v.sueldo_base_mensual),
    comision_por_litro: Number(v.comision_por_litro),
  };
}

/** Mismas reglas que los CHECK de db/schema.sql (usuario, acopiador). El servidor decide igual. */
export function validar(v: Valores): Errores {
  const e: Errores = {};
  if (v.nombre_completo.trim() === "") e.nombre_completo = "Escriba el nombre completo";
  if (!/^[0-9]{8}$/.test(v.dni.trim())) e.dni = "El DNI debe tener 8 dígitos";
  if (!/^[0-9]{9}$/.test(v.celular.trim())) e.celular = "El celular debe tener 9 dígitos";
  if (!esColorValido(v.color_hex)) e.color_hex = "Elija un color";
  if (!/^[0-9]{1,8}(\.[0-9]{1,2})?$/.test(v.sueldo_base_mensual.trim())) {
    e.sueldo_base_mensual = "Monto en soles, 0 o más, con hasta 2 decimales";
  }
  if (!/^[0-9]{1,3}(\.[0-9]{1,3})?$/.test(v.comision_por_litro.trim())) {
    e.comision_por_litro = "Soles por litro, 0 o más, con hasta 3 decimales";
  }
  return e;
}

const CAMPOS: Campo[] = ["nombre_completo", "dni", "celular", "color_hex", "vehiculo", "sueldo_base_mensual", "comision_por_litro"];

type Props = {
  inicial: Valores;
  textoGuardar: string;
  /** Guarda y devuelve un aviso de éxito (o null si la pantalla navega a otra parte). */
  onGuardar: (valores: Valores) => Promise<string | null>;
  /** Botones extra junto a Guardar. */
  extra?: ReactNode;
};

export function FormularioAcopiador({ inicial, textoGuardar, onGuardar, extra }: Props) {
  const id = useId();
  const [v, setV] = useState<Valores>(inicial);
  const [errores, setErrores] = useState<Errores>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function cambiar(campo: Campo, valor: string) {
    setV((anterior) => ({ ...anterior, [campo]: valor }));
    setExito(null);
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (guardando) return;
    const locales = validar(v);
    setErrores(locales);
    setGeneral(null);
    setExito(null);
    if (Object.keys(locales).length > 0) return;

    setGuardando(true);
    try {
      const aviso = await onGuardar(v);
      setExito(aviso);
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      // Errores de validación del servidor: bajo su campo; el resto (DNI o color repetido…), arriba
      const porCampo: Errores = {};
      if (e instanceof ErrorApi) {
        for (const err of e.errores) {
          if ((CAMPOS as string[]).includes(err.campo)) porCampo[err.campo as Campo] = err.mensaje;
        }
      }
      setErrores(porCampo);
      setGeneral(Object.keys(porCampo).length > 0 ? "Revise los datos marcados." : mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  function campo(nombre: Campo, etiqueta: string, control: (props: {
    id: string; "aria-invalid"?: true; "aria-describedby"?: string; disabled: boolean;
  }) => ReactNode, ayuda?: string) {
    const error = errores[nombre];
    const idControl = `${id}-${nombre}`;
    const descripcion = [error ? `${idControl}-error` : null, ayuda ? `${idControl}-ayuda` : null].filter(Boolean).join(" ");
    return (
      <div className="campo">
        <label htmlFor={idControl}>{etiqueta}</label>
        {control({
          id: idControl,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": descripcion || undefined,
          disabled: guardando,
        })}
        {ayuda && <span id={`${idControl}-ayuda`} className="campo-ayuda">{ayuda}</span>}
        {error && <span id={`${idControl}-error`} className="campo-error">{error}</span>}
      </div>
    );
  }

  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
      {exito !== null && <p className="aviso aviso-ok" role="status">{exito}</p>}

      <div className="formulario-rejilla">
        {campo("nombre_completo", "Nombre completo", (p) => (
          <input {...p} type="text" autoComplete="off" value={v.nombre_completo}
                 onChange={(e) => cambiar("nombre_completo", e.target.value)} />
        ))}
        {campo("dni", "DNI", (p) => (
          <input {...p} type="text" inputMode="numeric" maxLength={8} autoComplete="off" value={v.dni}
                 onChange={(e) => cambiar("dni", e.target.value)} />
        ))}
        {campo("celular", "Celular", (p) => (
          <input {...p} type="text" inputMode="numeric" maxLength={9} autoComplete="off" value={v.celular}
                 onChange={(e) => cambiar("celular", e.target.value)} />
        ))}
        {campo("color_hex", "Color en el mapa y las listas", (p) => (
          <input {...p} type="color" className="campo-color" value={esColorValido(v.color_hex) ? v.color_hex : "#000000"}
                 onChange={(e) => cambiar("color_hex", e.target.value.toUpperCase())} />
        ), "Cada acopiador necesita un color distinto.")}
        {campo("vehiculo", "Vehículo", (p) => (
          <select {...p} value={v.vehiculo} onChange={(e) => cambiar("vehiculo", e.target.value)}>
            {VEHICULOS.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
          </select>
        ))}
        {campo("sueldo_base_mensual", "Sueldo base mensual (S/)", (p) => (
          <input {...p} type="text" inputMode="decimal" autoComplete="off" value={v.sueldo_base_mensual}
                 onChange={(e) => cambiar("sueldo_base_mensual", e.target.value)} />
        ), "Dato pendiente del cliente: se puede editar después.")}
        {campo("comision_por_litro", "Comisión por litro normal (S/)", (p) => (
          <input {...p} type="text" inputMode="decimal" autoComplete="off" value={v.comision_por_litro}
                 onChange={(e) => cambiar("comision_por_litro", e.target.value)} />
        ), "Dato pendiente del cliente: se puede editar después.")}
      </div>

      <div className="fila-acciones">
        <button type="submit" className="boton boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : textoGuardar}
        </button>
        {extra}
      </div>
    </form>
  );
}
