import { describe, expect, it } from "vitest";
import { avisQueToca, passaEscalat, respostesDe, sumaMesos, type AvisPrevi, type VehicleAvis } from "./regles";
import { esTestimoni, hashTestimoni, nouTestimoni } from "./testimoni";

const v = (o: Partial<VehicleAvis>): VehicleAvis => ({
  motiu: "client",
  estat: "assegurat",
  data_alta: "2026-11-01",
  data_prevista_baixa: null,
  baixaEnCurs: false,
  ...o,
});
const previ = (o: Partial<AvisPrevi>): AvisPrevi => ({ tipus: "set_dies", clau: "set_dies", estat: "resolt", resposta: null, resolt_at: null, ...o });

describe("sumaMesos", () => {
  it("suma mesos i ajusta el final de mes", () => {
    expect(sumaMesos("2026-01-31", 1)).toBe("2026-02-28");
    expect(sumaMesos("2026-11-21", 4)).toBe("2027-03-21");
    expect(sumaMesos("2026-11-21", 12)).toBe("2027-11-21");
  });
});

describe("avisQueToca", () => {
  it("puntual: Avís dels 7 dies, un sol cop", () => {
    expect(avisQueToca(v({}), [], "2026-11-07")).toBeNull();
    expect(avisQueToca(v({}), [], "2026-11-08")).toEqual({ tipus: "set_dies", clau: "set_dies" });
    expect(avisQueToca(v({}), [previ({ estat: "excepcio" })], "2026-11-20")).toBeNull();
  });

  it("amb data prevista: Avís en arribar-hi (puntual i DEMO), una vegada per data", () => {
    const amb = v({ data_prevista_baixa: "2026-11-28" });
    expect(avisQueToca(amb, [], "2026-11-27")).toBeNull();
    expect(avisQueToca(amb, [], "2026-11-28")).toEqual({ tipus: "data_prevista", clau: "data_prevista:2026-11-28" });
    expect(avisQueToca(amb, [previ({ tipus: "data_prevista", clau: "data_prevista:2026-11-28" })], "2026-11-29")).toBeNull();
    expect(avisQueToca(v({ motiu: "familia", data_prevista_baixa: "2026-11-28" }), [], "2026-11-28")?.tipus).toBe("data_prevista");
  });

  it("DEMO, Família i Personal empresa: 4 mesos sense data prevista", () => {
    for (const motiu of ["demo", "familia", "personal"]) {
      expect(avisQueToca(v({ motiu }), [], "2027-02-28")).toBeNull();
      expect(avisQueToca(v({ motiu }), [], "2027-03-01")).toEqual({ tipus: "demo_4m", clau: "demo_4m" });
    }
  });

  it("VS: als 12 mesos i, si es manté, cada 3 mesos des de la resposta", () => {
    const vs = v({ motiu: "vs" });
    expect(avisQueToca(vs, [], "2027-10-31")).toBeNull();
    expect(avisQueToca(vs, [], "2027-11-01")).toEqual({ tipus: "vs_12m", clau: "vs_12m:2027-11-01" });
    const mante = previ({ tipus: "vs_12m", clau: "vs_12m:2027-11-01", resposta: "mante", resolt_at: "2027-11-03T09:00:00Z" });
    expect(avisQueToca(vs, [mante], "2028-02-02")).toBeNull();
    expect(avisQueToca(vs, [mante], "2028-02-03")).toEqual({ tipus: "vs_12m", clau: "vs_12m:2028-02-03" });
    expect(avisQueToca(vs, [{ ...mante, estat: "excepcio" }], "2028-06-01")).toBeNull();
  });

  it("res si no està assegurat, té baixa en curs o ja hi ha un Avís pendent", () => {
    expect(avisQueToca(v({ estat: "enviat" }), [], "2026-12-01")).toBeNull();
    expect(avisQueToca(v({ baixaEnCurs: true }), [], "2026-12-01")).toBeNull();
    expect(avisQueToca(v({}), [previ({ tipus: "demo_4m", clau: "x", estat: "pendent" })], "2026-12-01")).toBeNull();
    expect(avisQueToca(v({ motiu: null }), [], "2026-12-01")).toBeNull();
  });
});

describe("passaEscalat", () => {
  it("1 dia laborable sense resposta: escala; 1 més: excepció", () => {
    // divendres 20/11 → dilluns 23/11 = 1 dia laborable
    expect(passaEscalat({ nivell: 0, enviat_at: "2026-11-20T08:00:00Z", escalat_at: null }, new Date("2026-11-21T08:00:00Z"))).toBeNull();
    expect(passaEscalat({ nivell: 0, enviat_at: "2026-11-20T08:00:00Z", escalat_at: null }, new Date("2026-11-23T08:00:00Z"))).toBe("escala");
    expect(passaEscalat({ nivell: 1, enviat_at: "x", escalat_at: "2026-11-23T08:00:00Z" }, new Date("2026-11-24T08:00:00Z"))).toBe("excepcio");
    expect(passaEscalat({ nivell: 1, enviat_at: "x", escalat_at: "2026-11-23T08:00:00Z" }, new Date("2026-11-23T18:00:00Z"))).toBeNull();
  });
});

describe("respostes i testimonis", () => {
  it("VS: baixa o es manté; la resta: baixa o fins al", () => {
    expect(respostesDe("vs_12m")).toEqual(["baixa", "mante"]);
    expect(respostesDe("set_dies")).toEqual(["baixa", "mante_fins"]);
  });

  it("testimoni aleatori de 43 caràcters i hash estable", () => {
    const a = nouTestimoni(new Date("2026-11-22T08:00:00Z"));
    expect(esTestimoni(a.testimoni)).toBe(true);
    expect(a.hash).toBe(hashTestimoni(a.testimoni));
    expect(a.caduca).toBe("2026-11-29T08:00:00.000Z");
    expect(nouTestimoni().testimoni).not.toBe(a.testimoni);
    expect(esTestimoni("../../etc")).toBe(false);
  });
});

describe("revisió: avisos que no han de bloquejar i dates", () => {
  it("un Avís cancel·lat o resolt amb una baixa que no ha prosperat no bloqueja un de nou", () => {
    expect(avisQueToca(v({}), [previ({ estat: "cancelat" })], "2026-11-20")).toEqual({ tipus: "set_dies", clau: "set_dies" });
    expect(avisQueToca(v({}), [previ({ resposta: "baixa" })], "2026-11-20")).toEqual({ tipus: "set_dies", clau: "set_dies" });
    expect(avisQueToca(v({}), [previ({ resposta: "mante_fins" })], "2026-11-20")).toBeNull();
  });

  it("VS: el venciment de 3 mesos es compta des de la data de Madrid de la resposta", () => {
    // 00:30 a Madrid del 04/11 = 23:30 UTC del 03/11
    const mante = previ({ tipus: "vs_12m", clau: "vs_12m:2027-11-01", resposta: "mante", resolt_at: "2027-11-03T23:30:00Z" });
    expect(avisQueToca(v({ motiu: "vs" }), [mante], "2028-02-03")).toBeNull();
    expect(avisQueToca(v({ motiu: "vs" }), [mante], "2028-02-04")?.clau).toBe("vs_12m:2028-02-04");
  });

  it("Es manté fins al: posterior a avui, data real i com a molt d'aquí a un any", async () => {
    const { esDataMante } = await import("./regles");
    expect(esDataMante("2026-11-23", "2026-11-22")).toBe(true);
    expect(esDataMante("2026-11-22", "2026-11-22")).toBe(false);
    expect(esDataMante("2027-11-24", "2026-11-22")).toBe(false);
    expect(esDataMante("2026-02-30", "2026-01-01")).toBe(false);
    expect(esDataMante("9999-12-31", "2026-11-22")).toBe(false);
  });
});
