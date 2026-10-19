import { Route, Routes } from "react-router-dom";

import { Marco } from "./marco/Marco";
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
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  );
}
