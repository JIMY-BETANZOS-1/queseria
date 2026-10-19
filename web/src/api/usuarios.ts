// Usuarios de la app móvil (backend/app/routers/usuarios.py): acopiadores, código de activación y celulares.
import { pedir } from "./cliente";
import type { Acopiador, AcopiadorCambios, AcopiadorNuevo, CodigoActivacion, Dispositivo } from "./tipos";

export const listarAcopiadores = () => pedir<Acopiador[]>("GET", "/acopiadores");
export const obtenerAcopiador = (id: number) => pedir<Acopiador>("GET", `/acopiadores/${id}`);
export const crearAcopiador = (datos: AcopiadorNuevo) => pedir<Acopiador>("POST", "/acopiadores", { cuerpo: datos });
export const editarAcopiador = (id: number, cambios: AcopiadorCambios) =>
  pedir<Acopiador>("PATCH", `/acopiadores/${id}`, { cuerpo: cambios });

/** El código se muestra una sola vez: quien lo pide debe descartarlo al cerrar la ventana (ver CodigoVentana). */
export const generarCodigo = (usuarioId: number) =>
  pedir<CodigoActivacion>("POST", `/usuarios/${usuarioId}/codigo-activacion`);
export const listarDispositivos = (usuarioId: number) =>
  pedir<Dispositivo[]>("GET", `/usuarios/${usuarioId}/dispositivos`);
export const desactivarDispositivo = (dispositivoId: number) =>
  pedir<Dispositivo>("POST", `/dispositivos/${dispositivoId}/desactivar`);
