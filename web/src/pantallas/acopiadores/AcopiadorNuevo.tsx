import { Link, useNavigate } from "react-router-dom";

import { crearAcopiador, listarAcopiadores } from "../../api/usuarios";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { datosDe, FormularioAcopiador, type Valores } from "./FormularioAcopiador";

// Colores bien distintos entre sí para proponer uno libre (el admin puede elegir cualquier otro)
const PALETA = ["#2563EB", "#16A34A", "#DC2626", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#65A30D", "#9333EA", "#EA580C"];

export function colorLibre(usados: string[]): string {
  const ocupados = new Set(usados.map((c) => c.toUpperCase()));
  return PALETA.find((c) => !ocupados.has(c)) ?? "#000000";
}

export default function AcopiadorNuevo() {
  useTitulo("Nuevo acopiador");
  const navegar = useNavigate();
  // Solo para proponer un color que nadie usa; si falla, el formulario funciona igual
  const existentes = useCarga(listarAcopiadores, []);

  if (existentes.carga.estado === "cargando") return <p>Cargando…</p>;
  const usados = existentes.carga.estado === "listo" ? existentes.carga.datos.map((a) => a.color_hex) : [];

  const inicial: Valores = {
    nombre_completo: "",
    dni: "",
    celular: "",
    color_hex: colorLibre(usados),
    vehiculo: "moto_lineal",
    sueldo_base_mensual: "0",
    comision_por_litro: "0",
  };

  return (
    <>
      <p className="miga"><Link to="/acopiadores">Acopiadores</Link> › Nuevo</p>
      <h1>Nuevo acopiador</h1>
      <p className="texto-suave">
        No se pide PIN: el acopiador crea el suyo al activar su celular con el código que usted genere después.
      </p>
      <FormularioAcopiador
        inicial={inicial}
        textoGuardar="Crear acopiador"
        onGuardar={async (v) => {
          const creado = await crearAcopiador(datosDe(v));
          navegar(`/acopiadores/${creado.id}`, { state: { creado: true } });
          return null;
        }}
      />
    </>
  );
}
