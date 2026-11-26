import { describe, expect, it } from "vitest";
import { construeixIncidencies, esPerReclamar, type Fonts } from "./llista";

const ARA = new Date("2026-11-26T09:00:00Z");
const fa = (min: number) => new Date(ARA.getTime() - min * 60_000).toISOString();
const buit: Fonts = { avisos: [], baixes: [], altesEnviant: [], darrerFlota: null, senseMotiu: [], rebuts: [] };
const baixa = (p: Partial<Fonts["baixes"][number]>): Fonts["baixes"][number] => ({
  id: "b1",
  vehicle_id: "v1",
  estat: "enviada",
  data_baixa: "2026-11-20",
  extorn_esperat: 100,
  extorn_liquidat: null,
  liquidada_at: null,
  reclamada_at: null,
  created_at: fa(1000),
  updated_at: fa(1000),
  matricula: "1111AAA",
  estat_vehicle: "assegurat",
  ...p,
});

describe("construeixIncidencies", () => {
  it("sense fonts no hi ha cap incidència", () => {
    expect(construeixIncidencies(buit, ARA)).toEqual([]);
  });

  it("avís en excepció, amb l'id per respondre des de la safata", () => {
    const r = construeixIncidencies(
      { ...buit, avisos: [{ id: "a1", tipus: "set_dies", enviat_at: fa(5000), escalat_at: fa(3000), vehicle_id: "v1", matricula: "1111AAA", estat_vehicle: "assegurat" }] },
      ARA,
    );
    expect(r).toMatchObject([{ tipus: "avis_sense_resposta", avisId: "a1", tipusAvis: "set_dies", matricula: "1111AAA", data: fa(3000) }]);
  });

  it("avís en excepció: amagat si el vehicle té baixa en curs o ja no està assegurat; un per vehicle", () => {
    const av = (id: string, min: number, estat_vehicle = "assegurat") => ({
      id, tipus: "set_dies", enviat_at: fa(min), escalat_at: null, vehicle_id: "v1", matricula: "1111AAA", estat_vehicle,
    });
    expect(construeixIncidencies({ ...buit, avisos: [av("a1", 100)], baixes: [baixa({ estat: "enviada" })] }, ARA)).toEqual([]);
    expect(construeixIncidencies({ ...buit, avisos: [av("a1", 100, "donat_de_baixa")] }, ARA)).toEqual([]);
    expect(construeixIncidencies({ ...buit, avisos: [av("a1", 900), av("a2", 100)] }, ARA)).toMatchObject([{ avisId: "a2" }]);
  });

  it("baixa pendent de pòlissa, amb enllaç a Vehicles", () => {
    const r = construeixIncidencies({ ...buit, baixes: [baixa({ estat: "pendent_polissa" })] }, ARA);
    expect(r).toMatchObject([{ tipus: "baixa_pendent_polissa", enllac: "/admin/vehicles?veure=tots" }]);
  });

  it("baixa fallida només si és la darrera del vehicle i continua assegurat", () => {
    expect(construeixIncidencies({ ...buit, baixes: [baixa({ estat: "fallida" })] }, ARA)).toHaveLength(1);
    expect(
      construeixIncidencies({ ...buit, baixes: [baixa({ estat: "fallida" }), baixa({ estat: "enviada", created_at: fa(10) })] }, ARA),
    ).toEqual([]);
    expect(construeixIncidencies({ ...buit, baixes: [baixa({ estat: "fallida", estat_vehicle: "donat_de_baixa" })] }, ARA)).toEqual([]);
  });

  it("baixa 'enviant' és incerta només passats 15 minuts", () => {
    expect(construeixIncidencies({ ...buit, baixes: [baixa({ estat: "enviant", updated_at: fa(5) })] }, ARA)).toEqual([]);
    expect(construeixIncidencies({ ...buit, baixes: [baixa({ estat: "enviant", updated_at: fa(20) })] }, ARA)).toMatchObject([
      { tipus: "baixa_fallida" },
    ]);
  });

  it("alta amb enviament incert passats 15 minuts", () => {
    const f = (min: number) => ({ ...buit, altesEnviant: [{ id: "v2", matricula: "2222BBB", updated_at: fa(min) }] });
    expect(construeixIncidencies(f(5), ARA)).toEqual([]);
    expect(construeixIncidencies(f(30), ARA)).toMatchObject([{ tipus: "alta_incerta", enllac: "/validar" }]);
  });

  it("darrer enviament a Proassa fallit o incert", () => {
    expect(construeixIncidencies({ ...buit, darrerFlota: { estat: "fallit", created_at: fa(60) } }, ARA)).toMatchObject([
      { tipus: "flota_fallida", enllac: "/admin/flota" },
    ]);
    expect(construeixIncidencies({ ...buit, darrerFlota: { estat: "enviant", created_at: fa(5) } }, ARA)).toEqual([]);
    expect(construeixIncidencies({ ...buit, darrerFlota: { estat: "enviat", created_at: fa(60) } }, ARA)).toEqual([]);
  });

  it("vehicle assegurat sense Motiu", () => {
    const r = construeixIncidencies(
      { ...buit, senseMotiu: [{ id: "v3", matricula: "3333CCC", data_alta: "2026-10-01", created_at: fa(10) }] },
      ARA,
    );
    expect(r).toMatchObject([{ tipus: "sense_motiu", data: "2026-10-01T00:00:00Z" }]);
  });

  it("ordena per antiguitat (la més antiga primer)", () => {
    const r = construeixIncidencies(
      {
        ...buit,
        darrerFlota: { estat: "fallit", created_at: fa(100) },
        baixes: [baixa({ estat: "pendent_polissa", created_at: fa(9000) })],
        altesEnviant: [{ id: "v2", matricula: "2222BBB", updated_at: fa(500) }],
      },
      ARA,
    );
    expect(r.map((i) => i.tipus)).toEqual(["baixa_pendent_polissa", "alta_incerta", "flota_fallida"]);
  });
});

describe("extorns i rebuts", () => {
  it("extorn pendent a partir dels 60 dies de la data de baixa", () => {
    // ARA = 26/11/2026; 60 dies abans = 27/09/2026.
    expect(construeixIncidencies({ ...buit, baixes: [baixa({ data_baixa: "2026-09-28" })] }, ARA)).toEqual([]);
    expect(construeixIncidencies({ ...buit, baixes: [baixa({ data_baixa: "2026-09-27" })] }, ARA)).toMatchObject([
      { tipus: "extorn_pendent", baixaId: "b1", matricula: "1111AAA", perReclamar: true },
    ]);
    // Reclamada fa 3 dies: continua pendent però no es pot tornar a reclamar encara.
    expect(
      construeixIncidencies({ ...buit, baixes: [baixa({ data_baixa: "2026-09-27", reclamada_at: fa(3 * 24 * 60) })] }, ARA),
    ).toMatchObject([{ tipus: "extorn_pendent", perReclamar: false }]);
    // Amb un extorn enllaçat (encara que no quadri, o positiu) ja no és pendent sinó incorrecte.
    expect(
      construeixIncidencies({ ...buit, baixes: [baixa({ data_baixa: "2026-01-01", extorn_liquidat: -20 })] }, ARA),
    ).toMatchObject([{ tipus: "extorn_incorrecte" }]);
    // Ja liquidada, anul·lada o fallida: res.
    expect(
      construeixIncidencies({ ...buit, baixes: [baixa({ data_baixa: "2026-01-01", liquidada_at: fa(10), extorn_liquidat: 100 })] }, ARA),
    ).toEqual([]);
    expect(construeixIncidencies({ ...buit, baixes: [baixa({ data_baixa: "2026-01-01", estat: "anullada" })] }, ARA)).toEqual([]);
  });

  it("extorn incorrecte amb les dues xifres", () => {
    const r = construeixIncidencies({ ...buit, baixes: [baixa({ extorn_esperat: 130.25, extorn_liquidat: 120 })] }, ARA);
    expect(r).toMatchObject([{ tipus: "extorn_incorrecte", baixaId: "b1" }]);
    expect(r[0].descripcio).toContain("130,25");
    expect(r[0].descripcio).toContain("120,00");
  });

  it("rebuts sense casar: extorn no identificat i emissió sense vehicle", () => {
    const rebut = (p: Partial<Fonts["rebuts"][number]>): Fonts["rebuts"][number] => ({
      id: "r1",
      num_rebut: "100000001-A",
      tipus: "extorn",
      matricula: "2222BBB",
      prima_total: -50,
      inici: "2026-04-01",
      created_at: fa(100),
      vehicle_id: null,
      baixa_id: null,
      ...p,
    });
    expect(construeixIncidencies({ ...buit, rebuts: [rebut({})] }, ARA)).toMatchObject([{ tipus: "extorn_no_identificat", rebutId: "r1" }]);
    expect(construeixIncidencies({ ...buit, rebuts: [rebut({ tipus: "emissio", prima_total: 50 })] }, ARA)).toMatchObject([
      { tipus: "rebut_sense_vehicle" },
    ]);
    expect(construeixIncidencies({ ...buit, rebuts: [rebut({ tipus: "emissio", vehicle_id: "v1" })] }, ARA)).toEqual([]);
    expect(construeixIncidencies({ ...buit, rebuts: [rebut({ baixa_id: "b1" })] }, ARA)).toEqual([]);
  });

  it("una baixa reclamada fa menys de 15 dies no es torna a reclamar", () => {
    const b = baixa({ data_baixa: "2026-01-01" });
    expect(esPerReclamar(b, ARA)).toBe(true);
    expect(esPerReclamar({ ...b, reclamada_at: fa(14 * 24 * 60) }, ARA)).toBe(false);
    expect(esPerReclamar({ ...b, reclamada_at: fa(15 * 24 * 60) }, ARA)).toBe(true);
    expect(esPerReclamar(baixa({ data_baixa: "2026-11-01" }), ARA)).toBe(false);
  });
});
