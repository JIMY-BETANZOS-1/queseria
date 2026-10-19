import { API_URL } from "./config";

// GET /salud no declara su respuesta en el OpenAPI (devuelve un dict): la forma sale de backend/app/main.py
export type Salud = { estado: string; base: string; hora: string };

/** Consulta /salud sin sesión: sirve para saber si la API y el CORS responden. */
export async function consultarSalud(): Promise<Salud> {
  const r = await fetch(`${API_URL}/salud`);
  if (!r.ok) throw new Error(`La API respondió ${r.status}`);
  return (await r.json()) as Salud;
}
