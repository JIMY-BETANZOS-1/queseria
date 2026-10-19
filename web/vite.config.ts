/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Debe coincidir con CORS_ORIGENES del .env de la raíz: si el puerto está ocupado, falla en vez de cambiarlo
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/pruebas/preparar.ts"],
    // Las pruebas nunca llaman a la API real
    env: { VITE_API_URL: "http://api.prueba" },
  },
});
