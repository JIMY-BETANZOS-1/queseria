// Se carga antes de cada archivo de pruebas (vite.config.ts → test.setupFiles)
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { reiniciarParaPruebas } from "../sesion/almacen";
import { servidor } from "./servidor";

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
