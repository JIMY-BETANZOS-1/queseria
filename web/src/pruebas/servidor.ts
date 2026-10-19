// API simulada para las pruebas (MSW). Cada prueba define sus respuestas con servidor.use(...).
// Una petición sin respuesta definida hace fallar la prueba: nunca se llama a la API real.
import { setupServer } from "msw/node";

export const API = "http://api.prueba";   // = VITE_API_URL de las pruebas (vite.config.ts)

export const servidor = setupServer();
