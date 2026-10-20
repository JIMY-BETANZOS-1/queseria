// Nombres legibles para los tipos que genera tipos.ps1 desde el OpenAPI del backend (esquema.d.ts).
import type { components } from "./esquema";

type Esquemas = components["schemas"];

export type Token = Esquemas["Token"];
export type UsuarioSesion = Esquemas["UsuarioSesion"];

export type Acopiador = Esquemas["Acopiador"];
export type AcopiadorNuevo = Esquemas["AcopiadorNuevo"];
export type AcopiadorCambios = Esquemas["AcopiadorCambios"];
export type Vehiculo = Acopiador["vehiculo"];
export type RutaVigente = Esquemas["RutaVigente"];
export type UsuarioMovil = Esquemas["UsuarioMovil"];
// Un analista no tiene datos propios: es un usuario móvil (backend/app/routers/usuarios.py, /analistas)
export type Analista = UsuarioMovil;
export type AnalistaNuevo = Esquemas["UsuarioMovilNuevo"];
export type AnalistaCambios = Esquemas["UsuarioMovilCambios"];
export type Ruta = Esquemas["Ruta"];
export type RutaNueva = Esquemas["RutaNueva"];
export type RutaCambios = Esquemas["RutaCambios"];
export type Asignar = Esquemas["Asignar"];
export type Asignacion = Esquemas["Asignacion"];
export type ProductorResumen = Esquemas["ProductorResumen"];
export type Productor = Esquemas["Productor"];
export type ProductorNuevo = Esquemas["ProductorNuevo"];
export type ProductorCambios = Esquemas["ProductorCambios"];
export type TipoProductor = Productor["tipo"];
export type RecoleccionDetalle = Esquemas["RecoleccionDetalle"];
export type Alerta = Esquemas["Alerta"];
export type RevisarAlerta = Esquemas["RevisarAlerta"];
export type AnularRecoleccion = Esquemas["AnularRecoleccion"];
export type CalidadAdmin = Esquemas["CalidadAdmin"];
export type CalidadRevisada = Esquemas["CalidadRevisada"];
export type PagoPendienteProductor = Esquemas["PagoPendienteProductor"];
export type PagableDelPeriodo = Esquemas["PagableDelPeriodo"];
export type Liquidacion = Esquemas["Liquidacion"];
export type LiquidacionDetalle = Esquemas["LiquidacionDetalle"];
export type LineaLiquidacion = Esquemas["LineaLiquidacion"];
export type AcopiadorMes = Esquemas["AcopiadorMes"];
export type PagoAcopiador = Esquemas["PagoAcopiador"];
export type PagoAcopiadorNuevo = Esquemas["PagoAcopiadorNuevo"];
export type PagoAcopiadorCambios = Esquemas["PagoAcopiadorCambios"];
export type Dashboard = Esquemas["Dashboard"];
export type Jornada = Esquemas["Jornada"];
export type Merma = Esquemas["Merma"];
export type FotoGuardada = Esquemas["FotoGuardada"];
export type MermaNueva = Esquemas["MermaNueva"];
export type Movimiento = Esquemas["Movimiento"];
export type TipoMovimiento = Movimiento["tipo"];
export type Parametro = Esquemas["Parametro"];
export type Precio = Esquemas["Precio"];
export type PrecioNuevo = Esquemas["PrecioNuevo"];
export type Gasto = Esquemas["Gasto"];
export type GastoNuevo = Esquemas["GastoNuevo"];
export type CategoriaGasto = Esquemas["CategoriaGasto"];
export type Receta = Esquemas["Receta"];
export type RecetaNueva = Esquemas["RecetaNueva"];
export type RecetaCambios = Esquemas["RecetaCambios"];
export type InsumoEnReceta = Esquemas["InsumoEnReceta"];
export type InsumoStock = Esquemas["InsumoStock"];
export type InsumoNuevo = Esquemas["InsumoNuevo"];
export type IngresoInsumo = Esquemas["IngresoInsumo"];
export type IngresoRegistrado = Esquemas["IngresoRegistrado"];
export type PreviaProduccion = Esquemas["PreviaProduccion"];
export type ProduccionRapida = Esquemas["ProduccionRapida"];
export type Lote = Esquemas["Lote"];
export type LoteDisponible = Esquemas["LoteDisponible"];
export type Cliente = Esquemas["Cliente"];
export type ClienteNuevo = Esquemas["ClienteNuevo"];
export type VentaRapida = Esquemas["VentaRapida"];
export type Venta = Esquemas["Venta"];
export type CodigoActivacion = Esquemas["CodigoActivacion"];
export type Dispositivo = Esquemas["Dispositivo"];

// Formato de error de backend/app/errores.py. No está en el OpenAPI: FastAPI declara HTTPValidationError
// para los 422, pero el backend responde siempre {codigo, mensaje} (+ errores en los de validación).
export type ErrorCampo = { campo: string; mensaje: string };
export type RespuestaError = { codigo: string; mensaje: string; errores?: ErrorCampo[] };
