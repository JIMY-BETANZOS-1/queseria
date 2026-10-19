// Reglas de los datos de un usuario móvil (acopiador o analista): las mismas que los CHECK de la tabla
// usuario en db/schema.sql (ck_usuario_dni, ck_usuario_celular, nombre_completo NOT NULL). El servidor decide igual.
// reglaDocumento es la de productor (ck_productor_documento); reglaCelular también vale para ck_productor_celular.

/** Mensaje de error, o undefined si el valor está bien. */
export type Regla = (valor: string) => string | undefined;

export const reglaNombre: Regla = (v) => (v.trim() === "" ? "Escriba el nombre completo" : undefined);
export const reglaDni: Regla = (v) => (/^[0-9]{8}$/.test(v.trim()) ? undefined : "El DNI debe tener 8 dígitos");
export const reglaDocumento: Regla = (v) =>
  (/^[0-9]{8}([0-9]{3})?$/.test(v.trim()) ? undefined : "El documento debe ser un DNI (8 dígitos) o RUC (11 dígitos)");
export const reglaCelular: Regla = (v) => (/^[0-9]{9}$/.test(v.trim()) ? undefined : "El celular debe tener 9 dígitos");
