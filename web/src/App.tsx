import { Route, Routes } from "react-router-dom";

import { Marco } from "./marco/Marco";
import AcopiadorDetalle from "./pantallas/acopiadores/AcopiadorDetalle";
import AcopiadorNuevo from "./pantallas/acopiadores/AcopiadorNuevo";
import Acopiadores from "./pantallas/acopiadores/Acopiadores";
import Entrar from "./pantallas/Entrar";
import Inicio from "./pantallas/Inicio";
import NoEncontrada from "./pantallas/NoEncontrada";
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
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  );
}
