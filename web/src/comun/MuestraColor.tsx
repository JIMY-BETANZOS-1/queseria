const COLOR_VALIDO = /^#[0-9A-Fa-f]{6}$/;

export function esColorValido(color: string | null | undefined): color is string {
  return typeof color === "string" && COLOR_VALIDO.test(color);
}

/**
 * Cuadrito con el color del acopiador. Va como atributo `fill` de SVG y no como `style`, así lo permite la
 * política de seguridad (style-src 'self'). Un color con otro formato no se dibuja.
 */
export function MuestraColor({ color, etiqueta }: { color: string | null | undefined; etiqueta?: string }) {
  if (!esColorValido(color)) return <span className="texto-suave" aria-label="Sin color">—</span>;
  return (
    <svg className="muestra-color" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={etiqueta ?? `Color ${color}`}>
      <rect x="0.5" y="0.5" width="15" height="15" rx="3" fill={color} stroke="#00000033" />
    </svg>
  );
}
