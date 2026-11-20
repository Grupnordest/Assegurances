import { describe, expect, it } from "vitest";
import { llegeixRelacio, llegeixRelacioPdf } from "./llegeix-relacio";

/** Text amb la forma de la relació d'AXA. Matrícules inventades. */
const RELACIO = `AXA Seguros Atención Cliente: 902 404084
Anexo a la Póliza número: 030-0006897837
Relación de vehículos asegurados a 13/11/2026 15:36:12
Matrícula Marca Matrícula Marca Matrícula Marca
0119LWX RENAULT 0122MBP DACIA 0137NCC RENAULT
GI1234AB SEAT 0119LWX RENAULT
NOM COGNOM 40529128T
https://app.axa.es/rps/vRelVehVO.do? 1/4`;

describe("llegeixRelacio", () => {
  it("llegeix la data i les matrícules (sense repetides, ordenades)", () => {
    expect(llegeixRelacio(RELACIO)).toEqual({
      ok: true,
      data: "2026-11-13",
      matricules: ["0119LWX", "0122MBP", "0137NCC", "GI1234AB"],
    });
  });

  it("no pren trossos de DNI ni de números de pòlissa", () => {
    const r = llegeixRelacio(RELACIO);
    expect(r.ok && r.matricules.some((m) => m.includes("9128"))).toBe(false);
    expect(r.ok && r.matricules.some((m) => m.includes("6897"))).toBe(false);
  });

  it("sense data, data impossible o sense matrícules", () => {
    expect(llegeixRelacio("0119LWX RENAULT")).toEqual({ ok: false, error: "sense-data" });
    expect(llegeixRelacio("asegurados a 31/02/2026 0119LWX")).toEqual({ ok: false, error: "sense-data" });
    expect(llegeixRelacio("Relación de vehículos asegurados a 13/11/2026")).toEqual({
      ok: false,
      error: "sense-matricules",
    });
  });

  it("un fitxer que no és un PDF → il·legible", async () => {
    expect(await llegeixRelacioPdf(new TextEncoder().encode("no és un pdf"))).toEqual({ ok: false, error: "illegible" });
  });
});
