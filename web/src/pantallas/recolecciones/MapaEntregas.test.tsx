import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { recoleccion } from "../../pruebas/fabricas";
import { enlaceGoogleMaps, escala, MapaEntregas, metros, proyectar } from "./MapaEntregas";

const REF = { latitud_ref: -15.6, longitud_ref: -69.9 };
// ~512 m al norte de su referencia, con GPS
const LEJOS = recoleccion({ recoleccion_id: "a", productor: "Rosa Condori", productor_id: 1, latitud: -15.5954, longitud: -69.9,
                            ...REF, distancia_ref_m: 512, color_hex: "#2563EB", registrada_en: "2026-10-18T06:15:00-05:00" });
// Cerca (40 m), última ubicación conocida y simulada
const CERCA = recoleccion({ recoleccion_id: "b", productor: "Pedro Quispe", productor_id: 2, latitud: -15.6004, longitud: -69.9002,
                            latitud_ref: -15.6008, longitud_ref: -69.9002, distancia_ref_m: 40, origen_ubicacion: "ultima_conocida",
                            ubicacion_simulada: true, color_hex: "#16A34A", registrado_por: 8, registrado_por_nombre: "Ana Quispe",
                            registrada_en: "2026-10-18T07:30:00-05:00" });
// Sin GPS, con referencia
const SIN_GPS = recoleccion({ recoleccion_id: "c", productor: "Marta Huanca", productor_id: 3, latitud: null, longitud: null,
                              precision_m: null, origen_ubicacion: "ninguna", latitud_ref: -15.601, longitud_ref: -69.899,
                              distancia_ref_m: null, registrada_en: "2026-10-18T08:00:00-05:00" });
// Sin GPS ni referencia
const NADA = recoleccion({ recoleccion_id: "d", productor: "Juan Sin Ref", productor_id: 4, latitud: null, longitud: null,
                           precision_m: null, origen_ubicacion: "ninguna", latitud_ref: null, longitud_ref: null, distancia_ref_m: null,
                           registrada_en: "2026-10-18T09:00:00-05:00" });

describe("funciones del mapa", () => {
  it("enlace de Google Maps con 6 decimales, metros y km, barra de escala redonda", () => {
    expect(enlaceGoogleMaps(-15.6, -69.9)).toBe("https://www.google.com/maps?q=-15.600000,-69.900000");
    expect(metros(512.4)).toBe("512 m");
    expect(metros(1540)).toBe("1.5 km");
    expect(escala(0.5)).toBe(200);     // 160 px (un quinto de 800) ÷ 0.5 px/m = 320 m → 200 m
    expect(escala(0.05)).toBe(2000);
  });

  it("proyección: el norte arriba, el este a la derecha y las distancias en proporción", () => {
    const { xy, pxPorM } = proyectar([{ lat: -15.6, lon: -69.9 }, { lat: -15.5954, lon: -69.9 }]);
    const sur = xy({ lat: -15.6, lon: -69.9 });
    const norte = xy({ lat: -15.5954, lon: -69.9 });
    expect(norte.y).toBeLessThan(sur.y);
    expect(norte.x).toBeCloseTo(sur.x);
    expect((sur.y - norte.y) / pxPorM).toBeCloseTo(0.0046 * 110_540, 0);   // ≈ 508 m
    expect(xy({ lat: -15.6, lon: -69.899 }).x).toBeGreaterThan(sur.x);
  });
});

describe("MapaEntregas", () => {
  it("puntos con su color y enlace a Google Maps, referencias, tramo lejano resaltado, sin style", () => {
    render(<MapaEntregas filas={[LEJOS, CERCA, SIN_GPS, NADA]} umbral={300} />);
    const mapa = screen.getByRole("img", { name: "Mapa de 2 entregas con ubicación y la referencia de su productor" });
    expect(mapa.querySelector("[style]")).toBeNull();

    const puntos = [...mapa.querySelectorAll("a")];
    expect(puntos).toHaveLength(2);
    const rosa = within(mapa).getByRole("link", { name: "Ver en Google Maps: Rosa Condori, 06:15" });
    expect(rosa).toHaveAttribute("href", "https://www.google.com/maps?q=-15.595400,-69.900000");
    expect(rosa).toHaveAttribute("target", "_blank");
    expect(rosa).toHaveAttribute("rel", "noopener noreferrer");
    expect(rosa.querySelector("circle")).toHaveAttribute("fill", "#2563EB");
    const pedro = within(mapa).getByRole("link", { name: "Ver en Google Maps: Pedro Quispe, 07:30" });
    expect(pedro.querySelector("circle")).toHaveClass("mapa-punto", "aproximada", "simulada");
    expect(pedro.querySelector(".mapa-marca")).toHaveTextContent("!");
    // El nombre del productor va escrito junto a cada punto (solo los que tienen GPS)
    expect([...mapa.querySelectorAll(".mapa-nombre")].map((t) => t.textContent)).toEqual(["Rosa Condori", "Pedro Quispe"]);
    const punto = rosa.querySelector("circle")!;
    const nombre = rosa.querySelector(".mapa-nombre")!;
    expect(Number(nombre.getAttribute("x"))).toBeCloseTo(Number(punto.getAttribute("cx")) + 12);

    // Una referencia por productor con referencia (Rosa, Pedro y Marta, aunque Marta no tenga GPS)
    expect(mapa.querySelectorAll(".mapa-ref")).toHaveLength(3);
    const tramos = [...mapa.querySelectorAll(".mapa-tramo")];
    expect(tramos.map((t) => [t.getAttribute("class"), t.textContent])).toEqual([
      ["mapa-tramo lejos", "512 m"], ["mapa-tramo", "40 m"]]);
    expect(mapa.querySelector(".mapa-escala")).toHaveTextContent(/^\d+ m$|^\d+(\.\d)? km$/);
  });

  it("tabla con distancia, 'Lejos', enlaces a Google Maps (punto y referencia) y las que no tienen ubicación", () => {
    render(<MapaEntregas filas={[LEJOS, CERCA, SIN_GPS, NADA]} umbral={300} />);
    const tabla = screen.getByRole("table", { name: "Entregas en el mapa" });
    const fila = (p: string) => within(tabla).getByText(p).closest("tr")!;
    expect(fila("Rosa Condori")).toHaveTextContent("512 m Lejos");
    expect(within(fila("Rosa Condori")).getByText("Lejos")).toHaveClass("insignia-atencion");
    expect(fila("Pedro Quispe")).toHaveTextContent("40 m");
    expect(fila("Pedro Quispe")).not.toHaveTextContent("Lejos");
    expect(fila("Marta Huanca")).toHaveTextContent("Sin ubicación—");
    expect(fila("Juan Sin Ref")).toHaveTextContent("Sin referencia");

    const punto = within(fila("Rosa Condori")).getByRole("link", { name: "Ver en Google Maps la entrega de Rosa Condori" });
    expect(punto).toHaveAttribute("href", "https://www.google.com/maps?q=-15.595400,-69.900000");
    expect(punto).toHaveAttribute("target", "_blank");
    expect(punto).toHaveAttribute("rel", "noopener noreferrer");
    const ref = within(fila("Rosa Condori")).getByRole("link", { name: "Ver en Google Maps la referencia de Rosa Condori" });
    expect(ref).toHaveAttribute("href", "https://www.google.com/maps?q=-15.600000,-69.900000");
    expect(within(fila("Marta Huanca")).queryByRole("link", { name: /la entrega/ })).not.toBeInTheDocument();
    expect(screen.getByText(/^Sin ubicación \(2\):/)).toHaveTextContent("Sin ubicación (2): Marta Huanca 08:00, Juan Sin Ref 09:00.");
  });

  it("varias entregas del mismo productor: un solo nombre, junto a la primera, con ×N", () => {
    const otraDeRosa = { ...LEJOS, recoleccion_id: "a2", latitud: -15.597, registrada_en: "2026-10-18T09:15:00-05:00" };
    const terceraDeRosa = { ...LEJOS, recoleccion_id: "a3", latitud: -15.598, registrada_en: "2026-10-18T10:15:00-05:00" };
    render(<MapaEntregas filas={[LEJOS, otraDeRosa, CERCA, terceraDeRosa]} umbral={300} />);
    const mapa = screen.getByRole("img", { name: /^Mapa de 4 entregas/ });
    expect([...mapa.querySelectorAll(".mapa-nombre")].map((t) => t.textContent)).toEqual(["Rosa Condori ×3", "Pedro Quispe"]);
    expect(within(mapa).getByRole("link", { name: "Ver en Google Maps: Rosa Condori, 06:15" }).querySelector(".mapa-nombre")).not.toBeNull();
    expect(within(mapa).getByRole("link", { name: "Ver en Google Maps: Rosa Condori, 09:15" }).querySelector(".mapa-nombre")).toBeNull();
    expect(mapa.querySelectorAll("circle.mapa-punto")).toHaveLength(4);   // los puntos sí van todos
  });

  it("sin umbral no marca nada como lejos; sin ninguna ubicación ni referencia, un vacío con frase", () => {
    const { unmount } = render(<MapaEntregas filas={[LEJOS]} umbral={null} />);
    expect(document.querySelector(".mapa-tramo.lejos")).toBeNull();
    expect(screen.queryByText("Lejos")).not.toBeInTheDocument();
    unmount();
    render(<MapaEntregas filas={[NADA]} umbral={300} />);
    expect(screen.getByText("Ninguna entrega tiene ubicación ni referencia de su productor.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
