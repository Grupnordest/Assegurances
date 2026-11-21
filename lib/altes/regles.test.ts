import { describe, expect, it } from "vitest";
import { tipusAdjunt } from "./fitxers";
import { altaSchema, esValidadorDeQualsevol, potValidar, rolValidador } from "./regles";

const M = { matricula: "m", motiu: "mo", data: "d", dataPrevista: "dp", centre: "c", cobertura: "co" };
const base = {
  matricula: "1234ABC",
  motiu: "client",
  dataAlta: "2026-11-22",
  centre: "5",
  cobertura: "tot_risc",
  dataPrevista: "",
  comentari: "",
};

describe("qui valida", () => {
  it("VS només el Cap de postvenda; la resta, els Validadors; Administració tot", () => {
    expect(rolValidador("vs")).toBe("cap_postvenda");
    expect(rolValidador("familia")).toBe("validador");
    expect(potValidar(["validador"], "vs")).toBe(false);
    expect(potValidar(["cap_postvenda"], "vs")).toBe(true);
    expect(potValidar(["cap_postvenda"], "client")).toBe(false);
    expect(potValidar(["validador"], "demo")).toBe(true);
    expect(potValidar(["administracio"], "vs")).toBe(true);
    expect(potValidar(["sollicitant"], "prova")).toBe(false);
  });

  it("qui veu Pendents de validar", () => {
    expect(esValidadorDeQualsevol(["sollicitant"])).toBe(false);
    expect(esValidadorDeQualsevol(["sollicitant", "validador"])).toBe(true);
    expect(esValidadorDeQualsevol(["cap_postvenda"])).toBe(true);
  });
});

describe("altaSchema", () => {
  it("accepta una sol·licitud correcta i converteix els opcionals buits a null", () => {
    const r = altaSchema(M).safeParse(base);
    expect(r.success && r.data).toMatchObject({ centre: 5, dataPrevista: null, comentari: null });
  });

  it("rebutja Motiu, centre i dates no vàlids", () => {
    expect(altaSchema(M).safeParse({ ...base, motiu: "lloguer" }).success).toBe(false);
    expect(altaSchema(M).safeParse({ ...base, centre: "" }).success).toBe(false);
    expect(altaSchema(M).safeParse({ ...base, dataAlta: "2026-02-30" }).success).toBe(false);
  });

  it("la data prevista de baixa ha de ser igual o posterior a l'alta", () => {
    const r = altaSchema(M).safeParse({ ...base, dataPrevista: "2026-11-21" });
    expect(!r.success && r.error.issues[0].message).toBe("dp");
    expect(altaSchema(M).safeParse({ ...base, dataPrevista: "2026-12-01" }).success).toBe(true);
  });
});

describe("tipusAdjunt", () => {
  it("reconeix JPEG, PNG i PDF pel contingut", () => {
    expect(tipusAdjunt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(tipusAdjunt(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("png");
    expect(tipusAdjunt(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(tipusAdjunt(new TextEncoder().encode("hola"))).toBeNull();
  });
});
