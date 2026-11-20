import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { llegeixCobertura, llegeixData, llegeixImport, llegeixLlistatFlota, separaMatricula } from "./llegeix-llistat";

/** .xlsx sintètic amb la forma del Llistat de flota de la corredoria. Sense dades reals. */
function xlsx(files: unknown[][]): Uint8Array {
  const llibre = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(llibre, XLSX.utils.aoa_to_sheet(files), "Sheet1");
  return new Uint8Array(XLSX.write(llibre, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const CAP = [
  "Póliza",
  "Matrícula/Bastidor",
  "Prima neta",
  "Prima total",
  "Fecha de efecto",
  "Fecha de vencimiento",
  "Estado",
  "Grupo de tarifa",
  "Marca - modelo - versión",
];
const TR = "007 - TT-TER(def1500)+LUNAS+AV+INC+Rob+DPcFrq300-Particular-COLISION";
const TER = "018 - Tur-De 76 a 105CV--TER(def1500)+LUNAS+AV-Particular-COLISION";
const fila = (mat: string, tarifa = TR, total = "1.031,45 €") => [
  111111111,
  mat,
  "948,67 €",
  total,
  "30/10/2026",
  "04/06/2027",
  1,
  tarifa,
  "RENAULT - CLIO - PROVA",
];
const llistat = (...files: unknown[][]) => xlsx([["Datos de la Flota BIFR0000"], CAP, ...files]);

describe("separaMatricula", () => {
  it("separa matrícula i nota amb o sense espais", () => {
    expect(separaMatricula("0245 NSZ  SUSAN SABATÉ")).toEqual({ matricula: "0245NSZ", nota: "SUSAN SABATÉ" });
    expect(separaMatricula("7404NTT- MITA SABATÉ")).toEqual({ matricula: "7404NTT", nota: "MITA SABATÉ" });
    expect(separaMatricula("9633 HVC")).toEqual({ matricula: "9633HVC", nota: null });
    expect(separaMatricula("B 5865GW VS")).toEqual({ matricula: "B5865GW", nota: "VS" });
  });
});

describe("llegeixImport", () => {
  it("format espanyol", () => {
    expect(llegeixImport("1.031,45 €")).toBe(1031.45);
    expect(llegeixImport("815,78 €")).toBe(815.78);
    expect(llegeixImport(427.05)).toBe(427.05);
    expect(llegeixImport("2-3 SETMANES")).toBe(null);
    expect(llegeixImport(null)).toBe(null);
  });
});

describe("llegeixData", () => {
  it("dd/mm/aaaa dins un text, i dates impossibles → null", () => {
    expect(llegeixData("22/09/2026")).toBe("2026-09-22");
    expect(llegeixData(" ALTA 12/11/2026")).toBe("2026-11-12");
    expect(llegeixData("31/02/2026")).toBe(null);
    expect(llegeixData(null)).toBe(null);
  });
});

describe("llegeixCobertura", () => {
  it("tot risc amb franquícia, tercers i textos escrits a mà", () => {
    expect(llegeixCobertura(TR)).toEqual({ cobertura: "tot_risc", franquicia: 300 });
    expect(llegeixCobertura("036 - FURGONETA TERCEROS+R+I+L+AV+DP FQ 600€ COLISION")).toEqual({
      cobertura: "tot_risc",
      franquicia: 600,
    });
    expect(llegeixCobertura(TER)).toEqual({ cobertura: "tercers", franquicia: null });
    expect(llegeixCobertura("RENAULT CAPTUR A TERCERS")).toEqual({ cobertura: "tercers", franquicia: null });
    expect(llegeixCobertura("RENAULT CLIO A TOT RISC+ FQ 300€")).toEqual({ cobertura: "tot_risc", franquicia: 300 });
  });
});

describe("llegeixLlistatFlota", () => {
  it("llegeix files completes i altes afegides a mà", () => {
    const r = llegeixLlistatFlota(
      llistat(
        fila("0245 NSZ  SUSAN SABATÉ"),
        fila("9633 HVC", TER, "427,05 €"),
        [549710694, "9048KYM VS FRANCESC", "2-3 SETMANES", null, " ALTA 12/11/2026", null, null, "RENAULT CAPTUR A TERCERS", null],
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vehicles).toHaveLength(3);
    expect(r.vehicles[0]).toMatchObject({
      matricula: "0245NSZ",
      polissa: "111111111",
      estat: "assegurat",
      cobertura: "tot_risc",
      franquicia: 300,
      data_alta: "2026-10-30",
      data_venciment: "2027-06-04",
      prima_neta: 948.67,
      prima_total: 1031.45,
      nota: "SUSAN SABATÉ",
    });
    expect(r.vehicles[1]).toMatchObject({ cobertura: "tercers", prima_total: 427.05, nota: null });
    expect(r.vehicles[2]).toMatchObject({
      matricula: "9048KYM",
      polissa: "549710694",
      estat: "enviat",
      cobertura: "tercers",
      data_alta: "2026-11-12",
      prima_total: null,
      nota: "VS FRANCESC · 2-3 SETMANES",
    });
  });

  it("descarta matrícules il·legibles o repetides i ignora files en blanc", () => {
    const r = llegeixLlistatFlota(llistat(fila("0245 NSZ"), [], fila("0245NSZ"), fila("???")));
    expect(r.ok && r.vehicles.map((v) => v.matricula)).toEqual(["0245NSZ"]);
    expect(r.ok && r.descartades.map((d) => d.motiu)).toEqual(["repetida", "matricula"]);
  });

  it("format incorrecte: diu quines columnes falten", () => {
    const r = llegeixLlistatFlota(xlsx([["Matrícula/Bastidor", "Póliza"], ["0245NSZ", 1]]));
    expect(r.ok === false && r.error === "format" && r.falten).toEqual([
      "Prima neta",
      "Prima total",
      "Fecha de efecto",
      "Fecha de vencimiento",
      "Grupo de tarifa",
      "Marca - modelo - versión",
    ]);
  });

  it("buit i il·legible", () => {
    expect(llegeixLlistatFlota(llistat())).toEqual({ ok: false, error: "buit" });
    expect(llegeixLlistatFlota(new TextEncoder().encode("no és un excel")).ok).toBe(false);
  });
});

describe("casos de la revisió", () => {
  it("no accepta etiquetes ni matrícules amb caràcters de més", () => {
    expect(separaMatricula("TOTAL").matricula).toBe("");
    expect(separaMatricula("0245NSZ2").matricula).toBe("");
    expect(separaMatricula("VF15RFL0H52289015").matricula).toBe("");
  });

  it("sense capçaleres → error propi", () => {
    expect(llegeixLlistatFlota(xlsx([["hola"], ["adéu"]]))).toEqual({ ok: false, error: "sense-capcaleres" });
  });

  it("Estado informat → assegurat encara que la prima no es pugui llegir", () => {
    const r = llegeixLlistatFlota(llistat(fila("0245NSZ", TR, "1,031.45")));
    expect(r.ok && r.vehicles[0].estat).toBe("assegurat");
  });

  it("grup de tarifa buit → Tot risc", () => {
    expect(llegeixCobertura("")).toEqual({ cobertura: "tot_risc", franquicia: null });
  });
});
