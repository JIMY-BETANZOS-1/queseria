// Se carga antes de cada archivo de pruebas (vite.config.ts → test.setupFiles)
import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { reiniciarParaPruebas } from "../sesion/almacen";
import { servidor } from "./servidor";

// findBy*/waitFor esperan 1 s por defecto: con todos los archivos en paralelo, el primer render de un archivo
// puede pasarse. 5 s sigue siendo poco frente al límite de cada prueba (testTimeout en vite.config.ts)
configure({ asyncUtilTimeout: 5_000 });

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  servidor.resetHandlers();
  window.sessionStorage.clear();
  reiniciarParaPruebas();
});

afterAll(() => {
  servidor.close();
});
