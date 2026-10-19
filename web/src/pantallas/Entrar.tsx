import { useId, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { entrar, ErrorApi } from "../api/cliente";
import { useTitulo } from "../comun/useTitulo";
import { motivoCierre } from "../sesion/almacen";
import { useSesion } from "../sesion/useSesion";
import { rutaVolver } from "../sesion/volver";

type Faltan = { email?: string; password?: string };

/** A1 · Entrar con correo y contraseña. La contraseña solo vive en este formulario y se borra tras cada intento. */
export default function Entrar() {
  useTitulo("Entrar");
  const sesion = useSesion();
  const [parametros] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [faltan, setFaltan] = useState<Faltan>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const id = useId();

  // Con sesión (recién entró o ya la tenía) se va a donde estaba, solo si es una ruta interna segura
  if (sesion !== null && Date.now() < sesion.vence_en) {
    return <Navigate to={rutaVolver(parametros.get("volver"))} replace />;
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    const correo = email.trim();
    const nuevasFaltas: Faltan = {
      email: correo === "" ? "Escriba su correo" : undefined,
      password: password === "" ? "Escriba su contraseña" : undefined,
    };
    setFaltan(nuevasFaltas);
    if (nuevasFaltas.email || nuevasFaltas.password) return;

    setEnviando(true);
    setError(null);
    const clave = password;
    setPassword("");
    try {
      await entrar(correo, clave);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo entrar. Intente de nuevo.");
      setEnviando(false);
    }
  }

  const vencida = motivoCierre() === "vencida";

  return (
    <div className="entrar">
      <form className="tarjeta entrar-tarjeta" onSubmit={enviar} noValidate>
        <h1>Quesería Huata</h1>
        <p className="texto-suave">Panel del administrador</p>

        {vencida && error === null && (
          <p className="aviso aviso-atencion" role="status">Su sesión venció. Vuelva a entrar.</p>
        )}
        {error !== null && <p className="aviso aviso-error" role="alert">{error}</p>}

        <div className="campo">
          <label htmlFor={`${id}-email`}>Correo</label>
          <input
            id={`${id}-email`}
            type="email"
            name="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={faltan.email ? true : undefined}
            aria-describedby={faltan.email ? `${id}-email-error` : undefined}
            disabled={enviando}
          />
          {faltan.email && <span id={`${id}-email-error`} className="campo-error">{faltan.email}</span>}
        </div>

        <div className="campo">
          <label htmlFor={`${id}-password`}>Contraseña</label>
          <input
            id={`${id}-password`}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={faltan.password ? true : undefined}
            aria-describedby={faltan.password ? `${id}-password-error` : undefined}
            disabled={enviando}
          />
          {faltan.password && <span id={`${id}-password-error`} className="campo-error">{faltan.password}</span>}
        </div>

        <button type="submit" className="boton boton-primario boton-ancho" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
