// Usuarios de la app móvil (backend/app/routers/usuarios.py): acopiadores, analistas, código de activación y celulares.
import { pedir } from "./cliente";
import type {
  Acopiador, AcopiadorCambios, AcopiadorNuevo, Analista, AnalistaCambios, AnalistaNuevo, CodigoActivacion, Dispositivo,
} from "./tipos";

export const listarAcopiadores = () => pedir<Acopiador[]>("GET", "/acopiadores");
export const obtenerAcopiador = (id: number) => pedir<Acopiador>("GET", `/acopiadores/${id}`);
export const crearAcopiador = (datos: AcopiadorNuevo) => pedir<Acopiador>("POST", "/acopiadores", { cuerpo: datos });
export const editarAcopiador = (id: number, cambios: AcopiadorCambios) =>
  pedir<Acopiador>("PATCH", `/acopiadores/${id}`, { cuerpo: cambios });

export const listarAnalistas = () => pedir<Analista[]>("GET", "/analistas");
export const obtenerAnalista = (id: number) => pedir<Analista>("GET", `/analistas/${id}`);
export const crearAnalista = (datos: AnalistaNuevo) => pedir<Analista>("POST", "/analistas", { cuerpo: datos });
export const editarAnalista = (id: number, cambios: AnalistaCambios) =>
  pedir<Analista>("PATCH", `/analistas/${id}`, { cuerpo: cambios });

/** El código se muestra una sola vez: quien lo pide debe descartarlo al cerrar la ventana (ver CodigoVentana). */
export const generarCodigo = (usuarioId: number) =>
  pedir<CodigoActivacion>("POST", `/usuarios/${usuarioId}/codigo-activacion`);
export const listarDispositivos = (usuarioId: number) =>
  pedir<Dispositivo[]>("GET", `/usuarios/${usuarioId}/dispositivos`);
export const desactivarDispositivo = (dispositivoId: number) =>
  pedir<Dispositivo>("POST", `/dispositivos/${dispositivoId}/desactivar`);
