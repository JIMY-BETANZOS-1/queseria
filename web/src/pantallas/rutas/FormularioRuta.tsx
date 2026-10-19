import { useId, useState, type FormEvent, type ReactNode } from "react";

import { ErrorApi, ErrorSesion } from "../../api/cliente";
import type { Ruta, RutaNueva } from "../../api/tipos";
import { Campo, type PropsControl } from "../../comun/Campo";
import { mensajeDeError } from "../../comun/useCarga";

export type Valores = { nombre: string; descripcion: string };
type NombreCampo = keyof Valores;
type Errores = Partial<Record<NombreCampo, string>>;

export const VACIO: Valores = { nombre: "", descripcion: "" };

export function valoresDe(r: Ruta): Valores {
  return { nombre: r.nombre, descripcion: r.descripcion ?? "" };
}

/** Datos para la API: una descripción vacía se guarda como null (sin descripción). */
export function datosDe(v: Valores): RutaNueva & { descripcion: string | null } {
  const descripcion = v.descripcion.trim();
  return { nombre: v.nombre.trim(), descripcion: descripcion === "" ? null : descripcion };
}

export function validar(v: Valores): Errores {
  return v.nombre.trim() === "" ? { nombre: "Escriba el nombre de la ruta" } : {};
}

const CAMPOS: NombreCampo[] = ["nombre", "descripcion"];

type Props = {
  inicial: Valores;
  textoGuardar: string;
  /** Guarda y devuelve un aviso de éxito (o null si la pantalla navega a otra parte). */
  onGuardar: (valores: Valores) => Promise<string | null>;
  /** Botones extra junto a Guardar. */
  extra?: ReactNode;
};

export function FormularioRuta({ inicial, textoGuardar, onGuardar, extra }: Props) {
  const id = useId();
  const [v, setV] = useState<Valores>(inicial);
  const [errores, setErrores] = useState<Errores>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function cambiar(campo: NombreCampo, valor: string) {
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
      setExito(await onGuardar(v));
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      // Errores de validación del servidor: bajo su campo; el resto (nombre repetido…), arriba
      const porCampo: Errores = {};
      if (e instanceof ErrorApi) {
        for (const err of e.errores) {
          if ((CAMPOS as string[]).includes(err.campo)) porCampo[err.campo as NombreCampo] = err.mensaje;
        }
      }
      setErrores(porCampo);
      setGeneral(Object.keys(porCampo).length > 0 ? "Revise los datos marcados." : mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  function campo(nombre: NombreCampo, etiqueta: string, control: (props: PropsControl) => ReactNode) {
    return (
      <Campo id={`${id}-${nombre}`} etiqueta={etiqueta} error={errores[nombre]} deshabilitado={guardando}>
        {control}
      </Campo>
    );
  }

  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
      {exito !== null && <p className="aviso aviso-ok" role="status">{exito}</p>}

      <div className="formulario-rejilla">
        {campo("nombre", "Nombre", (p) => (
          <input {...p} type="text" autoComplete="off" value={v.nombre} onChange={(e) => cambiar("nombre", e.target.value)} />
        ))}
        {campo("descripcion", "Descripción (opcional)", (p) => (
          <input {...p} type="text" autoComplete="off" value={v.descripcion}
                 onChange={(e) => cambiar("descripcion", e.target.value)} />
        ))}
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
