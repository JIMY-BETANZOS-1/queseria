import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Marco } from "./marco/Marco";
import Alertas from "./pantallas/alertas/Alertas";
import AcopiadorDetalle from "./pantallas/acopiadores/AcopiadorDetalle";
import AcopiadorNuevo from "./pantallas/acopiadores/AcopiadorNuevo";
import Acopiadores from "./pantallas/acopiadores/Acopiadores";
import AnalistaDetalle from "./pantallas/analistas/AnalistaDetalle";
import AnalistaNuevo from "./pantallas/analistas/AnalistaNuevo";
import Analistas from "./pantallas/analistas/Analistas";
import Calidad from "./pantallas/calidad/Calidad";
import Configuracion from "./pantallas/configuracion/Configuracion";
import Dashboard from "./pantallas/dashboard/Dashboard";
import Inicio from "./pantallas/inicio/Inicio";
import Entrar from "./pantallas/Entrar";
import Almacen from "./pantallas/produccion/Almacen";
import Produccion from "./pantallas/produccion/Produccion";
import Recetas from "./pantallas/produccion/Recetas";
import Ventas from "./pantallas/produccion/Ventas";
import Gastos from "./pantallas/gastos/Gastos";
import Movimientos from "./pantallas/movimientos/Movimientos";
import LecheJornada from "./pantallas/jornadas/LecheJornada";
import RecoleccionesDia from "./pantallas/recolecciones/RecoleccionesDia";
import NoEncontrada from "./pantallas/NoEncontrada";
import LiquidacionDetalle from "./pantallas/pagos/LiquidacionDetalle";
import LiquidarPeriodo from "./pantallas/pagos/LiquidarPeriodo";
import PagosAcopiadores from "./pantallas/pagos/PagosAcopiadores";
import PagosProductores from "./pantallas/pagos/PagosProductores";
import ProductorDetalle from "./pantallas/productores/ProductorDetalle";
import ProductorNuevo from "./pantallas/productores/ProductorNuevo";
import Productores from "./pantallas/productores/Productores";
import RutaDetalle from "./pantallas/rutas/RutaDetalle";
import RutaNueva from "./pantallas/rutas/RutaNueva";
import Rutas from "./pantallas/rutas/Rutas";
import { RequiereSesion } from "./sesion/RequiereSesion";

/** Direcciones viejas del Dashboard (hoy Resumen, en /resumen): /dashboard?mes=… y /?mes=… llevan a /resumen
 * conservando su consulta. / sin mes es Inicio. */
function AlResumen() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/resumen", search }} replace />;
}

function InicioOResumen() {
  const { search } = useLocation();
  return new URLSearchParams(search).has("mes") ? <AlResumen /> : <Inicio />;
}

/** Rutas del panel. El enrutador (BrowserRouter) lo pone main.tsx; las pruebas usan MemoryRouter. */
export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route element={<RequiereSesion><Marco /></RequiereSesion>}>
        <Route index element={<InicioOResumen />} />
        <Route path="resumen" element={<Dashboard />} />
        <Route path="acopiadores" element={<Acopiadores />} />
        <Route path="acopiadores/nuevo" element={<AcopiadorNuevo />} />
        <Route path="acopiadores/:id" element={<AcopiadorDetalle />} />
        <Route path="analistas" element={<Analistas />} />
        <Route path="analistas/nuevo" element={<AnalistaNuevo />} />
        <Route path="analistas/:id" element={<AnalistaDetalle />} />
        <Route path="rutas" element={<Rutas />} />
        <Route path="rutas/nueva" element={<RutaNueva />} />
        <Route path="rutas/:id" element={<RutaDetalle />} />
        <Route path="productores" element={<Productores />} />
        <Route path="productores/nuevo" element={<ProductorNuevo />} />
        <Route path="productores/:id" element={<ProductorDetalle />} />
        <Route path="alertas" element={<Alertas />} />
        <Route path="recolecciones" element={<RecoleccionesDia />} />
        <Route path="calidad" element={<Calidad />} />
        <Route path="dashboard" element={<AlResumen />} />
        <Route path="jornadas" element={<LecheJornada />} />
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="gastos" element={<Gastos />} />
        <Route path="movimientos" element={<Movimientos />} />
        <Route path="produccion" element={<Produccion />} />
        <Route path="ventas" element={<Ventas />} />
        <Route path="almacen" element={<Almacen />} />
        <Route path="recetas" element={<Recetas />} />
        <Route path="pagos/productores" element={<PagosProductores />} />
        <Route path="pagos/liquidar" element={<LiquidarPeriodo />} />
        <Route path="pagos/liquidaciones/:id" element={<LiquidacionDetalle />} />
        <Route path="pagos/acopiadores" element={<PagosAcopiadores />} />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  );
}
