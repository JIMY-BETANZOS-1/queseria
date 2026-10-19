import { useId, useState, type FormEvent, type ReactNode } from "react";

import { ErrorApi, ErrorSesion } from "../../api/cliente";
import type { Productor, ProductorCambios, ProductorNuevo, Ruta, TipoProductor } from "../../api/tipos";
import { Campo, type PropsControl } from "../../comun/Campo";
import { mensajeDeError } from "../../comun/useCarga";
import { reglaCelular, reglaDocumento } from "../../usuarios/reglas";

export const TIPOS: { valor: TipoProductor; texto: string }[] = [
  { valor: "de_ruta", texto: "De ruta" },
  { valor: "externo", texto: "Externo (llega a planta)" },
];

export function textoTipo(t: TipoProductor): string {
  return TIPOS.find((x) => x.valor === t)?.texto ?? t;
}

/** Valores del formulario como texto (lo que escribe el admin); se convierten al guardar. */
export type Valores = {
  tipo: TipoProductor;
  nombre: string;
  documento: string;
  celular: string;
  ruta_id: string;
  latitud_ref: string;
  longitud_ref: string;
};
type NombreCampo = Exclude<keyof Valores, "tipo">;
type Errores = Partial<Record<NombreCampo, string>>;

export const VACIO: Valores = {
  tipo: "de_ruta", nombre: "", documento: "", celular: "", ruta_id: "", latitud_ref: "", longitud_ref: "",
};

const texto = (n: number | null) => (n === null ? "" : String(n));

export function valoresDe(p: Productor): Valores {
  return {
    tipo: p.tipo,
    nombre: p.nombre,
    documento: p.documento ?? "",
    celular: p.celular ?? "",
    ruta_id: texto(p.ruta_id),
    latitud_ref: texto(p.latitud_ref),
    longitud_ref: texto(p.longitud_ref),
  };
}

const nulo = (v: string) => (v.trim() === "" ? null : v.trim());
const numero = (v: string) => (v.trim() === "" ? null : Number(v.trim()));

/** Datos para la API: los vacíos van como null; un externo nunca lleva ruta (ck_productor_tipo). */
export function datosDe(v: Valores): Required<ProductorNuevo> {
  return {
    nombre: v.nombre.trim(),
    documento: nulo(v.documento),
    celular: nulo(v.celular),
    tipo: v.tipo,
    ruta_id: v.tipo === "externo" ? null : numero(v.ruta_id),
    latitud_ref: numero(v.latitud_ref),
    longitud_ref: numero(v.longitud_ref),
  };
}

/** Solo los campos que cambiaron (PATCH). El tipo no se edita: ver FormularioProductor. */
export function cambiosDe(antes: Productor, despues: Required<ProductorNuevo>): ProductorCambios {
  const cambios: ProductorCambios = {};
  if (despues.nombre !== antes.nombre) cambios.nombre = despues.nombre;
  if (despues.documento !== antes.documento) cambios.documento = despues.documento;
  if (despues.celular !== antes.celular) cambios.celular = despues.celular;
  if (despues.ruta_id !== antes.ruta_id) cambios.ruta_id = despues.ruta_id;
  if (despues.latitud_ref !== antes.latitud_ref) cambios.latitud_ref = despues.latitud_ref;
  if (despues.longitud_ref !== antes.longitud_ref) cambios.longitud_ref = despues.longitud_ref;
  return cambios;
}

// Hasta 6 decimales: numeric(9,6) en la base
const COORDENADA = /^-?[0-9]{1,3}(\.[0-9]{1,6})?$/;

function reglaCoordenada(v: string, limite: number, nombre: string): string | undefined {
  const t = v.trim();
  if (COORDENADA.test(t) && Math.abs(Number(t)) <= limite) return undefined;
  return `${nombre} entre -${limite} y ${limite}, con hasta 6 decimales`;
}

/** Mismas reglas que los CHECK de la tabla productor. El servidor decide igual. */
export function validar(v: Valores): Errores {
  const e: Errores = {};
  if (v.nombre.trim() === "") e.nombre = "Escriba el nombre";
  // Un externo necesita documento y celular; en uno de ruta son opcionales, pero si se escriben deben ser válidos
  const externo = v.tipo === "externo";
  if (externo || v.documento.trim() !== "") e.documento = reglaDocumento(v.documento);
  if (externo || v.celular.trim() !== "") e.celular = reglaCelular(v.celular);
  if (!externo && v.ruta_id === "") e.ruta_id = "Elija la ruta";
  // Ubicación de referencia: las dos o ninguna (ck_productor_ref), y cada una en su rango
  const lat = v.latitud_ref.trim();
  const lon = v.longitud_ref.trim();
  if (lat !== "" || lon !== "") {
    e.latitud_ref = lat === "" ? "Escriba también la latitud" : reglaCoordenada(lat, 90, "Latitud");
    e.longitud_ref = lon === "" ? "Escriba también la longitud" : reglaCoordenada(lon, 180, "Longitud");
  }
  // Solo los campos con error
  return Object.fromEntries(Object.entries(e).filter(([, mensaje]) => mensaje !== undefined)) as Errores;
}

const CAMPOS: NombreCampo[] = ["nombre", "documento", "celular", "ruta_id", "latitud_ref", "longitud_ref"];

type Props = {
  inicial: Valores;
  /** Rutas para elegir: las activas, más la actual del productor aunque esté inactiva. */
  rutas: Ruta[];
  /**
   * false (edición): el tipo se muestra pero no se cambia. fn_validar_recoleccion exige de_ruta al acopiador
   * y externo al analista: cambiarlo haría rechazar la leche que los celulares tengan sin enviar.
   */
  tipoEditable: boolean;
  textoGuardar: string;
  /** Guarda y devuelve un aviso de éxito (o null si la pantalla navega a otra parte). */
  onGuardar: (valores: Valores) => Promise<string | null>;
  /** Botones extra junto a Guardar. */
  extra?: ReactNode;
};

export function FormularioProductor({ inicial, rutas, tipoEditable, textoGuardar, onGuardar, extra }: Props) {
  const id = useId();
  const [v, setV] = useState<Valores>(inicial);
  const [errores, setErrores] = useState<Errores>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const externo = v.tipo === "externo";

  function cambiar(campo: keyof Valores, valor: string) {
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
      // Errores de validación del servidor: bajo su campo; el resto (documento repetido…), arriba
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

  function campo(nombre: NombreCampo, etiqueta: string, control: (props: PropsControl) => ReactNode, ayuda?: string) {
    return (
      <Campo id={`${id}-${nombre}`} etiqueta={etiqueta} error={errores[nombre]} ayuda={ayuda} deshabilitado={guardando}>
        {control}
      </Campo>
    );
  }

  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
      {exito !== null && <p className="aviso aviso-ok" role="status">{exito}</p>}

      {tipoEditable ? (
        <fieldset className="opciones" disabled={guardando}>
          <legend>Tipo</legend>
          {TIPOS.map((t) => (
            <label key={t.valor} className="casilla">
              <input type="radio" name={`${id}-tipo`} value={t.valor} checked={v.tipo === t.valor}
                     onChange={() => cambiar("tipo", t.valor)} />
              {t.texto}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>
          <strong>Tipo:</strong> {textoTipo(v.tipo)}{" "}
          <span className="texto-suave">(no se cambia: si está mal, desactívelo y cree otro)</span>
        </p>
      )}

      <div className="formulario-rejilla">
        {campo("nombre", "Nombre", (p) => (
          <input {...p} type="text" autoComplete="off" value={v.nombre} onChange={(e) => cambiar("nombre", e.target.value)} />
        ))}
        {campo("documento", "Documento (DNI o RUC)", (p) => (
          <input {...p} type="text" inputMode="numeric" maxLength={11} autoComplete="off" value={v.documento}
                 onChange={(e) => cambiar("documento", e.target.value)} />
        ), externo ? undefined : "Opcional en productores de ruta.")}
        {campo("celular", "Celular", (p) => (
          <input {...p} type="text" inputMode="numeric" maxLength={9} autoComplete="off" value={v.celular}
                 onChange={(e) => cambiar("celular", e.target.value)} />
        ), externo ? undefined : "Opcional en productores de ruta.")}
        {!externo && campo("ruta_id", "Ruta", (p) => (
          <select {...p} value={v.ruta_id} onChange={(e) => cambiar("ruta_id", e.target.value)}>
            <option value="">Elija…</option>
            {rutas.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre}{r.activa ? "" : " (inactiva)"}</option>
            ))}
          </select>
        ), tipoEditable ? undefined
          : "Al cambiarla, el productor pasa al celular del acopiador de la nueva ruta en su próxima sincronización; " +
            "lo que el anterior tenga sin enviar se sube igual.")}
        {campo("latitud_ref", "Latitud de referencia", (p) => (
          <input {...p} type="text" inputMode="decimal" autoComplete="off" placeholder="-15.612345" value={v.latitud_ref}
                 onChange={(e) => cambiar("latitud_ref", e.target.value)} />
        ), "Opcional. Con la longitud, sirve para la alerta de distancia.")}
        {campo("longitud_ref", "Longitud de referencia", (p) => (
          <input {...p} type="text" inputMode="decimal" autoComplete="off" placeholder="-69.912345" value={v.longitud_ref}
                 onChange={(e) => cambiar("longitud_ref", e.target.value)} />
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
