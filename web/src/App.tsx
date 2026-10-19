import { Route, Routes } from "react-router-dom";

import { Marco } from "./marco/Marco";
import AcopiadorDetalle from "./pantallas/acopiadores/AcopiadorDetalle";
import AcopiadorNuevo from "./pantallas/acopiadores/AcopiadorNuevo";
import Acopiadores from "./pantallas/acopiadores/Acopiadores";
import AnalistaDetalle from "./pantallas/analistas/AnalistaDetalle";
import AnalistaNuevo from "./pantallas/analistas/AnalistaNuevo";
import Analistas from "./pantallas/analistas/Analistas";
import Entrar from "./pantallas/Entrar";
import Inicio from "./pantallas/Inicio";
import NoEncontrada from "./pantallas/NoEncontrada";
import ProductorDetalle from "./pantallas/productores/ProductorDetalle";
import ProductorNuevo from "./pantallas/productores/ProductorNuevo";
import Productores from "./pantallas/productores/Productores";
import RutaDetalle from "./pantallas/rutas/RutaDetalle";
import RutaNueva from "./pantallas/rutas/RutaNueva";
import Rutas from "./pantallas/rutas/Rutas";
import { RequiereSesion } from "./sesion/RequiereSesion";

/** Rutas del panel. El enrutador (BrowserRouter) lo pone main.tsx; las pruebas usan MemoryRouter. */
export default function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Entrar />} />
      <Route element={<RequiereSesion><Marco /></RequiereSesion>}>
        <Route index element={<Inicio />} />
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
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  );
}
