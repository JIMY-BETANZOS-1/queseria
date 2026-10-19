import { Confirmar } from "../comun/Confirmar";

type Props = {
  rol: "acopiador";
  /** Estado actual: true = se va a desactivar; false = se va a reactivar. */
  activo: boolean;
  onConfirmar: () => Promise<void>;
  onCerrar: () => void;
};

/**
 * Confirmación de desactivar o reactivar a un usuario móvil. Los textos describen lo que hacen el backend
 * (deps.py y /auth/pin/login exigen usuario.activo; el PATCH solo cambia activo) y la app
 * (Autenticador.desvincular conserva lo que no se envió).
 */
export function CambiarActivo({ rol, activo, onConfirmar, onCerrar }: Props) {
  return (
    <Confirmar
      titulo={activo ? `Desactivar ${rol}` : `Reactivar ${rol}`}
      textoConfirmar={activo ? "Desactivar" : "Reactivar"}
      peligro={activo}
      onCerrar={onCerrar}
      onConfirmar={onConfirmar}
    >
      {activo ? (
        <ul className="lista-avisos">
          <li>Corta su acceso al instante: la app ya no podrá entrar ni sincronizar con el servidor.</li>
          <li>Lo que ya registró en el servidor no cambia.</li>
          <li>Lo que tenga sin enviar se queda guardado en su celular: no se borra.</li>
        </ul>
      ) : (
        <ul className="lista-avisos">
          <li>Vuelve a poder entrar y sincronizar.</li>
          <li>
            Si mientras estuvo inactivo intentó entrar con señal, su celular quedó desvinculado: genere un código
            nuevo y actívelo en ese mismo celular (conserva lo que tenga sin enviar).
          </li>
        </ul>
      )}
    </Confirmar>
  );
}
