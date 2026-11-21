import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  desDeEstoc,
  diferencies,
  generaExcel,
  llegeixLlistaFlota,
  tipusDeModel,
  uneixLlistes,
} from "./comunicacio";

const excel = (files: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(files), "Hoja1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
};

describe("llegeixLlistaFlota", () => {
  it("llegeix el format de Proassa (títol, capçalera, pòlissa, marca, tipus, matrícula)", () => {
    const r = llegeixLlistaFlota(
      excel([
        ["COMUNICACION DE STOCK DE MATRICULAS PARA POLIZAS DE VEHICULOS DE OCASION"],
        ["Nº Poliza", "Marca", "Tipo", "Matricula Vehiculo"],
        [6897837, "Renault", "furgoneta", "0119 lwx"],
        [6897837, "DACIA", "TURISMO", "0122MBP"],
        [6897837, "DACIA", "TURISMO", "0122MBP"],
      ]),
    );
    expect(r).toEqual({
      ok: true,
      vehicles: [
        { matricula: "0119LWX", marca: "RENAULT", tipo: "FURGONETA" },
        { matricula: "0122MBP", marca: "DACIA", tipo: "TURISMO" },
      ],
    });
  });

  it("accepta la llista de campers (columna buida al davant)", () => {
    const r = llegeixLlistaFlota(excel([[null, "LLISTAT CAMPER 27/05/2025"], [null, 6897837, "AUTOCARAVANA", "TURISMO", "5823DPX"]]));
    expect(r.ok && r.vehicles).toEqual([{ matricula: "5823DPX", marca: "AUTOCARAVANA", tipo: "TURISMO" }]);
  });

  it("errors: sense matrícules i fitxer il·legible", () => {
    expect(llegeixLlistaFlota(excel([["res"]]))).toEqual({ ok: false, error: "sense-matricules" });
    expect(llegeixLlistaFlota(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });
});

describe("tipusDeModel", () => {
  it("FURGONETA per a furgonetes conegudes, TURISMO per a la resta", () => {
    expect(tipusDeModel("Kangoo Furgón Profesional")).toBe("FURGONETA");
    expect(tipusDeModel("Trafic Combi 9")).toBe("FURGONETA");
    expect(tipusDeModel("Dokker 1.5dCi Ambiance")).toBe("FURGONETA");
    expect(tipusDeModel("Clio 1.0 TCe")).toBe("TURISMO");
    expect(tipusDeModel(null)).toBe("TURISMO");
  });
});

describe("uneixLlistes i diferencies", () => {
  it("una matrícula només una vegada, i mana l'Estoc", () => {
    const estoc = desDeEstoc([{ matricula: "1111AAA", marca: "Renault", model: "Clio" }]);
    const campers = [
      { matricula: "1111AAA", marca: "AUTOCARAVANA", tipo: "TURISMO" },
      { matricula: "0000BBB", marca: "AUTOCARAVANA", tipo: "TURISMO" },
    ];
    expect(uneixLlistes(estoc, campers)).toEqual([
      { matricula: "0000BBB", marca: "AUTOCARAVANA", tipo: "TURISMO" },
      { matricula: "1111AAA", marca: "RENAULT", tipo: "TURISMO" },
    ]);
  });

  it("altes i baixes respecte a l'anterior; sense canvis → buides", () => {
    expect(diferencies(["A", "B", "C"], ["B", "C", "D"])).toEqual({ altes: ["D"], baixes: ["A"] });
    expect(diferencies(["A"], ["A"])).toEqual({ altes: [], baixes: [] });
  });
});

describe("generaExcel", () => {
  it("es pot tornar a llegir i conserva les dades", () => {
    const v = [{ matricula: "0119LWX", marca: "RENAULT", tipo: "TURISMO" }];
    expect(llegeixLlistaFlota(generaExcel(v))).toEqual({ ok: true, vehicles: v });
  });
});

describe("llegeixLlistaFlota: casos de la revisió", () => {
  it("accepta matrícules no estàndard si van després de la pòlissa (plaques, ciclomotors)", () => {
    const r = llegeixLlistaFlota(excel([[6897837, "VARIOS MULTIMARCA", "PLACAS", "S6445BCM"], [6897837, "PIAGGIO", "CICLOMOTOR", "C1234BCD"]]));
    expect(r.ok && r.vehicles.map((v) => v.matricula)).toEqual(["S6445BCM", "C1234BCD"]);
  });

  it("no llegeix els fulls amagats", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[6897837, "DACIA", "TURISMO", "0122MBP"]]), "Hoja1");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[6897837, "DACIA", "TURISMO", "9999ZZZ"]]), "Vell");
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
    const r = llegeixLlistaFlota(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
    expect(r.ok && r.vehicles.map((v) => v.matricula)).toEqual(["0122MBP"]);
  });
});
