// Reglas de los datos de un usuario móvil (acopiador o analista): las mismas que los CHECK de la tabla
// usuario en db/schema.sql (ck_usuario_dni, ck_usuario_celular, nombre_completo NOT NULL). El servidor decide igual.

/** Mensaje de error, o undefined si el valor está bien. */
export type Regla = (valor: string) => string | undefined;

export const reglaNombre: Regla = (v) => (v.trim() === "" ? "Escriba el nombre completo" : undefined);
export const reglaDni: Regla = (v) => (/^[0-9]{8}$/.test(v.trim()) ? undefined : "El DNI debe tener 8 dígitos");
export const reglaCelular: Regla = (v) => (/^[0-9]{9}$/.test(v.trim()) ? undefined : "El celular debe tener 9 dígitos");
