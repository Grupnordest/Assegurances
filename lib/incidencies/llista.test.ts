import { describe, expect, it } from "vitest";
import { construeixIncidencies, type Fonts } from "./llista";

const ARA = new Date("2026-11-26T09:00:00Z");
const fa = (min: number) => new Date(ARA.getTime() - min * 60_000).toISOString();
const buit: Fonts = { avisos: [], baixes: [], altesEnviant: [], darrerFlota: null, senseMotiu: [] };
const baixa = (p: Partial<Fonts["baixes"][number]>): Fonts["baixes"][number] => ({
  vehicle_id: "v1",
  estat: "enviada",
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
