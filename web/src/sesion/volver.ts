/**
 * Valida el parámetro ?volver= de Entrar: solo una ruta interna del panel. Así nadie puede armar un enlace
 * que, después de entrar, lleve al admin a otro sitio. Rechaza:
 *   - lo que no empieza con "/" (https://…, javascript:…, rutas relativas);
 *   - "//sitio" y "/\sitio" (el navegador los toma como otro dominio);
 *   - cualquier "\" (algunos navegadores lo leen como "/");
 *   - espacios y caracteres de control.
 */
export function rutaVolver(valor: string | null | undefined, porDefecto = "/"): string {
  if (!valor || !valor.startsWith("/")) return porDefecto;
  if (valor.startsWith("//") || valor.includes("\\")) return porDefecto;
  if (/[\s\u0000-\u001f\u007f]/.test(valor)) return porDefecto;
  return valor;
}
