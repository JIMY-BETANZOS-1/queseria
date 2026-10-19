/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Origen (protocolo + host + puerto) de VITE_API_URL. Al construir es obligatorio: sin él no se puede armar la CSP. */
function origenApi(mode: string): string {
  const url = loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL?.trim();
  if (!url) {
    throw new Error(
      "Falta VITE_API_URL para construir el panel. Defínala en web\\.env.local (ver web\\.env.example) " +
      "o como variable de entorno, con la dirección pública de la API (por ejemplo https://api.ejemplo.pe).",
    );
  }
  let origen: URL;
  try {
    origen = new URL(url);
  } catch {
    throw new Error(`VITE_API_URL no es una dirección válida: "${url}"`);
  }
  if (origen.protocol !== "http:" && origen.protocol !== "https:") {
    throw new Error(`VITE_API_URL debe empezar con http:// o https:// (se recibió "${url}")`);
  }
  return origen.origin;
}

/**
 * Content-Security-Policy como <meta> en el index.html del build (no en desarrollo: Vite y el plugin de React
 * inyectan un script en línea). frame-ancestors no va aquí porque en <meta> se ignora: debe enviarse como
 * cabecera HTTP en el despliegue (pendiente, ver web/README.md).
 */
function cspProduccion(api: string): Plugin {
  const politica = [
    "default-src 'self'",
    `connect-src 'self' ${api}`,
    `img-src 'self' data: ${api}`,
    "style-src 'self'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
  return {
    name: "queseria-csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: politica }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig(({ command, mode }) => ({
  plugins: command === "build" ? [react(), cspProduccion(origenApi(mode))] : [react()],
  server: {
    // Debe coincidir con CORS_ORIGENES del .env de la raíz: si el puerto está ocupado, falla en vez de cambiarlo
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/pruebas/preparar.ts"],
    // Las pruebas nunca llaman a la API real. TZ distinta de Lima: así se prueba que las horas no dependen del PC
    env: { VITE_API_URL: "http://api.prueba", TZ: "Asia/Tokyo" },
    // Las pruebas de formularios tipean letra por letra: con todos los archivos en paralelo pasan de los 5 s
    // por defecto aunque solas tarden menos
    testTimeout: 15_000,
  },
}));
