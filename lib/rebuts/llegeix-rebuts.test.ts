import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { classificaClase, llegeixDataRebut, llegeixImportRebut, llegeixRebuts } from "./llegeix-rebuts";

/** .xlsx sintètic amb la forma dels rebuts de la Corredoria. Dades inventades. */
function xlsx(files: unknown[][]): Uint8Array {
  const llibre = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(llibre, XLSX.utils.aoa_to_sheet(files), "Sheet1");
  return new Uint8Array(XLSX.write(llibre, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const CAP = [
  "Recibo",
  "Póliza",
  "Ramo",
  "Clase",
  "Inicio cobertura",
  "Fin cobertura",
  "Prima total",
  "Prima Neta",
  "Líquido",
  "Situación",
  "Fecha situación",
  "Datos adicionales",
];
const TITOL = ["Recibo 100000001-A", null, null, null, null, null, null, null, null, null, null, null];
const mare = (num: string, clase: string, prima: number) =>
  [num, "MARE0001", 11111, clase, "01.03.2026", "04.06.2026", prima, prima * 0.9, prima * 0.92, "Cobrado", "02.03.2026", null];
const vehicle = (num: string, clase: string, prima: number, mat = "1234 ABC") =>
  [num, 500000001, 11111, clase, "01.03.2026", "04.06.2026", prima, 90.5, 92.25, "Cobrado", "02.03.2026", mat];

describe("llegeixRebuts", () => {
  it("emissió: ignora la línia de la pòlissa mare i normalitza matrícula, dates i imports", () => {
    const r = llegeixRebuts(xlsx([TITOL, CAP, mare("100000001-A", "00-Nueva Produccion", 100), vehicle("100000002-B", "00-Nueva Produccion", 100)]));
    expect(r).toEqual({
      ok: true,
      ignorades: 1,
      desconegudes: [],
      linies: [
        {
          num_rebut: "100000002-B",
          polissa: "500000001",
          clase: "00-Nueva Produccion",
          tipus: "emissio",
          inici: "2026-03-01",
          fi: "2026-06-04",
          prima_total: 100,
          prima_neta: 90.5,
          liquid: 92.25,
          situacio: "Cobrado",
          data_situacio: "2026-03-02",
          matricula: "1234ABC",
          prima_anual: 384.21, // 100 × 365 ÷ 95 dies
        },
      ],
    });
  });

  it("extorn amb import negatiu, sense prima anual", () => {
    const r = llegeixRebuts(xlsx([TITOL, CAP, vehicle("100000003-C", "93-Recibo de Extorno", -50.12, "5678 xyz")]));
    expect(r).toMatchObject({ ok: true, linies: [{ tipus: "extorn", prima_total: -50.12, matricula: "5678XYZ", prima_anual: null }] });
  });

  it("una Clase desconeguda no s'importa: es retorna a part", () => {
    const r = llegeixRebuts(xlsx([TITOL, CAP, vehicle("100000004-D", "05-Suplemento", 10)]));
    expect(r).toMatchObject({ ok: true, linies: [], desconegudes: [{ num_rebut: "100000004-D", tipus: "desconeguda" }] });
  });

  it("sense capçalera, columnes que falten, dades no vàlides o buit → error", () => {
    expect(llegeixRebuts(xlsx([["hola"], ["adeu"]]))).toEqual({ ok: false, error: "sense-capcaleres" });
    expect(llegeixRebuts(xlsx([CAP.filter((c) => c !== "Prima total")]))).toEqual({ ok: false, error: "format", falten: ["Prima total"] });
    const dolenta = vehicle("100000005-E", "00-Nueva Produccion", 10);
    dolenta[4] = "31/02/2026";
    expect(llegeixRebuts(xlsx([TITOL, CAP, dolenta]))).toEqual({ ok: false, error: "dades", fila: 3, camp: "Inicio cobertura" });
    expect(llegeixRebuts(xlsx([TITOL, CAP]))).toEqual({ ok: false, error: "buit" });
    expect(llegeixRebuts(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false });
  });
});

describe("casos límit del lector", () => {
  it("un fitxer amb només la pòlissa mare retorna 0 línies sense error", () => {
    expect(llegeixRebuts(xlsx([TITOL, CAP, mare("100000001-A", "00-Nueva Produccion", 100)]))).toEqual({
      ok: true,
      linies: [],
      ignorades: 1,
      desconegudes: [],
    });
  });

  it("Fecha situación com a data d'Excel (número)", () => {
    const f = vehicle("100000006-F", "00-Nueva Produccion", 10);
    f[10] = 46113; // 01/04/2026
    expect(llegeixRebuts(xlsx([TITOL, CAP, f]))).toMatchObject({ ok: true, linies: [{ data_situacio: "2026-04-01" }] });
  });
});

describe("normalitzadors", () => {
  it("dates dd.mm.aaaa", () => {
    expect(llegeixDataRebut("13.04.2026")).toBe("2026-04-13");
    expect(llegeixDataRebut("4.6.2026")).toBe("2026-06-04");
    expect(llegeixDataRebut("31.02.2026")).toBe(null);
    expect(llegeixDataRebut("")).toBe(null);
  });

  it("imports amb punt decimal, negatius i format espanyol, a cèntims", () => {
    expect(llegeixImportRebut(-130.24)).toBe(-130.24);
    expect(llegeixImportRebut("-130.24")).toBe(-130.24);
    expect(llegeixImportRebut("1.234,56")).toBe(1234.56);
    expect(llegeixImportRebut(0.1 + 0.2)).toBe(0.3);
    expect(llegeixImportRebut("abc")).toBe(null);
  });

  it("Clase pel prefix", () => {
    expect(classificaClase("00-Nueva Produccion")).toBe("emissio");
    expect(classificaClase("02-Cartera")).toBe("emissio");
    expect(classificaClase("2/02")).toBe("emissio");
    expect(classificaClase("93-Recibo de Extorno")).toBe("extorn");
    expect(classificaClase("05-Suplemento")).toBe("desconeguda");
    expect(classificaClase("")).toBe("desconeguda");
  });
});
