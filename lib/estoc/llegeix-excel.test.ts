import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { llegeixEstoc } from "./llegeix-excel";
import { esMatriculaValida, normalitzaMatricula } from "./matricula";

/** Construeix un .xls (BIFF8) sintètic amb la mateixa forma que l'export de Spiga. Sense dades reals. */
function xls(files: unknown[][], bookType: XLSX.BookType = "biff8"): Uint8Array {
  const llibre = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(llibre, XLSX.utils.aoa_to_sheet(files), "Sheet");
  return new Uint8Array(XLSX.write(llibre, { type: "array", bookType }) as ArrayBuffer);
}

// Capçaleres com les de Spiga: "Modelo" i "Color" dues vegades (principal i secundària).
const CAP = ["Empresa", "Centro", "VIN", "Matrícula", "Marca", "Modelo", "Color", "Modelo", "Color", "Días en Stock"];
const capçalera = (data = "18/11/2026", hora = "14:03") => [
  [],
  ["Empresa de prova / Centre", null, null, null, null, null, null, null, null, data],
  ["Español (España)", null, "VO - Stock VO", null, null, null, null, null, null, hora],
  [],
  CAP,
];
const fila = (mat: unknown, model = "Model exacte", dies: unknown = 12) => [
  "Empresa",
  "Pivot",
  "VIN0001",
  mat,
  "Renault",
  "(CL4) Clio",
  "BLANCO",
  model,
  "ROJO",
  dies,
];

describe("normalitzaMatricula", () => {
  it("treu espais, guions i punts i passa a majúscules", () => {
    expect(normalitzaMatricula(" 5855 hrt ")).toBe("5855HRT");
    expect(normalitzaMatricula("5855-HRT")).toBe("5855HRT");
    expect(normalitzaMatricula("B 5865GW")).toBe("B5865GW");
    expect(normalitzaMatricula(null)).toBe("");
  });

  it("elimina comodins i accents (cerca segura)", () => {
    expect(normalitzaMatricula("%")).toBe("");
    expect(normalitzaMatricula("58*5,5_hrt\\")).toBe("5855HRT");
    expect(normalitzaMatricula("àb12")).toBe("AB12");
  });

  it("valida longitud i caràcters", () => {
    expect(esMatriculaValida("5855HRT")).toBe(true);
    expect(esMatriculaValida("B5865GW")).toBe(true);
    expect(esMatriculaValida("")).toBe(false);
    expect(esMatriculaValida("AB1")).toBe(false);
  });
});

describe("llegeixEstoc", () => {
  it("llegeix data, vehicles i les columnes secundàries", () => {
    const r = llegeixEstoc(xls([...capçalera(), fila("5855 HRT"), fila("1105NPT"), [], [2]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dataEstoc).toBe("2026-11-18T14:03");
    expect(r.vehicles).toHaveLength(2);
    expect(r.vehicles[0]).toEqual({
      matricula: "5855HRT",
      vin: "VIN0001",
      marca: "Renault",
      model: "Model exacte",
      color: "ROJO",
      dies_estoc: 12,
    });
    expect(r.descartats).toBe(0);
    expect(r.avisos).toEqual([]);
  });

  it("també llegeix .xlsx", () => {
    const r = llegeixEstoc(xls([...capçalera(), fila("5855HRT")], "xlsx"));
    expect(r.ok && r.vehicles.length).toBe(1);
  });

  it("descarta matrícules buides o repetides i ignora línies en blanc i de recompte", () => {
    const r = llegeixEstoc(xls([...capçalera(), fila("5855HRT"), fila(""), fila("5855 hrt"), fila("1105NPT"), [], [3]]));
    expect(r.ok && r.vehicles.map((v) => v.matricula)).toEqual(["5855HRT", "1105NPT"]);
    expect(r.ok && r.descartats).toBe(2);
  });

  it("dies en estoc buit o no numèric → null", () => {
    const r = llegeixEstoc(xls([...capçalera(), fila("5855HRT", "M", ""), fila("1105NPT", "M", "x")]));
    expect(r.ok && r.vehicles.map((v) => v.dies_estoc)).toEqual([null, null]);
  });

  it("sense data a la capçalera: avisa i deixa la data a null", () => {
    const r = llegeixEstoc(xls([...capçalera("", ""), fila("5855HRT")]));
    expect(r.ok && r.dataEstoc).toBe(null);
    expect(r.ok && r.avisos).toEqual(["data-no-trobada"]);
  });

  it("data impossible a la capçalera → null amb avís (no fa caure la càrrega)", () => {
    const r = llegeixEstoc(xls([...capçalera("31/02/2026", "25:70"), fila("5855HRT")]));
    expect(r.ok && r.dataEstoc).toBe(null);
    expect(r.ok && r.avisos).toEqual(["data-no-trobada"]);
  });

  it("accepta data com a número de sèrie d'Excel i hora amb segons", () => {
    // 46344 = 18/11/2026
    const r = llegeixEstoc(xls([...capçalera(46344 as unknown as string, "14:03:22"), fila("5855HRT")]));
    expect(r.ok && r.dataEstoc).toBe("2026-11-18T14:03");
  });

  it("dies en estoc fora de rang o amb separadors → null", () => {
    const r = llegeixEstoc(xls([...capçalera(), fila("5855HRT", "M", 1e10), fila("1105NPT", "M", "1.234"), fila("0137KZJ", "M", -3)]));
    expect(r.ok && r.vehicles.map((v) => v.dies_estoc)).toEqual([null, null, null]);
  });

  it("format incorrecte: diu quines columnes falten", () => {
    const r = llegeixEstoc(xls([["Matrícula", "Marca"], ["5855HRT", "Renault"]]));
    expect(r).toEqual({ ok: false, error: "format", falten: ["VIN", "Modelo", "Color", "Días en Stock"] });
  });

  it("sense fila de capçaleres → falten totes", () => {
    const r = llegeixEstoc(xls([["hola"], ["adéu"]]));
    expect(r.ok === false && r.error).toBe("format");
  });

  it("fitxer sense vehicles → buit", () => {
    expect(llegeixEstoc(xls([...capçalera(), [], [0]]))).toEqual({ ok: false, error: "buit" });
  });

  it("fitxer que no és un Excel → no peta", () => {
    const r = llegeixEstoc(new TextEncoder().encode("això no és un excel"));
    expect(r.ok).toBe(false);
  });
});
