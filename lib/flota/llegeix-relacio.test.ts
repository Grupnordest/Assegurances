import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { dataDelNom, llegeixRelacio, llegeixRelacioExcel, llegeixRelacioPdf } from "./llegeix-relacio";

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

describe("dataDelNom", () => {
  it("llegeix dates ISO i europees del nom del fitxer", () => {
    expect(dataDelNom("VO PARA SEGURO 2026-11-18.xlsx-A.xlsx")).toBe("2026-11-18");
    expect(dataDelNom("relacio 18-11-2026.xlsx")).toBe("2026-11-18");
    expect(dataDelNom("relacio 18.11.2026.xls")).toBe("2026-11-18");
  });
  it("rebutja noms sense data o amb dates impossibles", () => {
    expect(dataDelNom("relacio.xlsx")).toBeNull();
    expect(dataDelNom("relacio 2026-02-30.xlsx")).toBeNull();
  });
});

describe("llegeixRelacioExcel", () => {
  const excel = (files: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(files), "Hoja1");
    return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  };
  const COMUNICACIO = [
    ["COMUNICACION DE STOCK DE MATRICULAS PARA POLIZAS DE VEHICULOS DE OCASION"],
    ["Nº Poliza", "Marca", "Tipo", "Matricula Vehiculo"],
    [6897837, "RENAULT", "TURISMO", "0119LWX"],
    [6897837, "DACIA", "TURISMO", "0122 mbp"],
    [6897837, "SEAT", "TURISMO", "GI-1234-AB"],
    [6897837, "RENAULT", "TURISMO", "0119LWX"],
  ];

  it("treu les matrícules (normalitzades i sense repetir) i la data del nom", () => {
    expect(llegeixRelacioExcel(excel(COMUNICACIO), "VO PARA SEGURO 2026-11-18.xlsx")).toEqual({
      ok: true,
      data: "2026-11-18",
      matricules: ["0119LWX", "0122MBP", "GI1234AB"],
    });
  });
  it("no pren el número de pòlissa ni textos com a matrícula", () => {
    const r = llegeixRelacioExcel(excel(COMUNICACIO), "x 2026-11-18.xlsx");
    expect(r.ok && r.matricules).not.toContain("6897837");
  });
  it("errors: sense data, sense matrícules, fitxer il·legible", () => {
    expect(llegeixRelacioExcel(excel(COMUNICACIO), "relacio.xlsx")).toEqual({ ok: false, error: "sense-data" });
    expect(llegeixRelacioExcel(excel([["res"]]), "x 2026-11-18.xlsx")).toEqual({ ok: false, error: "sense-matricules" });
    expect(llegeixRelacioExcel(new Uint8Array([1, 2, 3]), "x 2026-11-18.xlsx").ok).toBe(false);
  });
});
