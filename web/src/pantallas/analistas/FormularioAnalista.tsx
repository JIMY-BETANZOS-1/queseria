import { useId, useState, type FormEvent, type ReactNode } from "react";

import { ErrorApi, ErrorSesion } from "../../api/cliente";
import type { Analista, AnalistaNuevo } from "../../api/tipos";
import { Campo, type PropsControl } from "../../comun/Campo";
import { mensajeDeError } from "../../comun/useCarga";
import { reglaCelular, reglaDni, reglaNombre } from "../../usuarios/reglas";

/** Un analista solo tiene los datos de usuario móvil (UsuarioMovilNuevo): sin rutas, vehículo ni sueldo. */
export type Valores = { nombre_completo: string; dni: string; celular: string };
type NombreCampo = keyof Valores;
type Errores = Partial<Record<NombreCampo, string>>;

export const VACIO: Valores = { nombre_completo: "", dni: "", celular: "" };

export function valoresDe(a: Analista): Valores {
  return { nombre_completo: a.nombre_completo, dni: a.dni, celular: a.celular };
}

/** Datos para la API (mismos nombres que AnalistaNuevo). */
export function datosDe(v: Valores): AnalistaNuevo {
  return { nombre_completo: v.nombre_completo.trim(), dni: v.dni.trim(), celular: v.celular.trim() };
}

/** Mismas reglas que los CHECK de la tabla usuario. El servidor decide igual. */
export function validar(v: Valores): Errores {
  const e: Errores = {
    nombre_completo: reglaNombre(v.nombre_completo),
    dni: reglaDni(v.dni),
    celular: reglaCelular(v.celular),
  };
  // Solo los campos con error
  return Object.fromEntries(Object.entries(e).filter(([, mensaje]) => mensaje !== undefined)) as Errores;
}

const CAMPOS: NombreCampo[] = ["nombre_completo", "dni", "celular"];

type Props = {
  inicial: Valores;
  textoGuardar: string;
  /** Guarda y devuelve un aviso de éxito (o null si la pantalla navega a otra parte). */
  onGuardar: (valores: Valores) => Promise<string | null>;
  /** Botones extra junto a Guardar. */
  extra?: ReactNode;
};

export function FormularioAnalista({ inicial, textoGuardar, onGuardar, extra }: Props) {
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
      // Errores de validación del servidor: bajo su campo; el resto (DNI repetido…), arriba
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
