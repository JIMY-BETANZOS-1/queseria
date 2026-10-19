/** Dirección de la API: web\.env.local (VITE_API_URL) o, si falta, el backend local de dev.ps1. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
