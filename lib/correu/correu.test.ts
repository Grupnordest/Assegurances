import { describe, expect, it } from "vitest";
import { destinataris, destinatarisProassa, llegeixConfigCorreu } from "./config";
import { correuAnullacio, correuBaixa, correuEstocProassa } from "./plantilles";

const ENTORN = {
  AZURE_TENANT_ID: "tenant",
  MS_GRAPH_CLIENT_ID: "client",
  MS_GRAPH_CLIENT_SECRET: "secret",
  CORREU_REMITENT: "assegurances@example.com",
  CORREU_GESTOR_PRINCIPAL: "principal@example.com",
  CORREU_GESTOR_SUPLENT: "suplent@example.com",
  CORREU_COPIA_ADMIN: "assegurances@example.com",
  CORREU_SIGNATURA: "Nuri",
};

describe("correuBaixa", () => {
  it("segueix el format d'Administració i adjunta la pòlissa AXA", () => {
    const c = correuBaixa({ matricula: "0246NSZ", dataBaixa: "2026-11-25", signatura: "Nuri" });
    expect(c.assumpte).toBe("Baixa flota tot risc – 0246NSZ");
    expect(c.cos).toBe(
      "Bones,\n\nSol·licitem la baixa de la matrícula 0246NSZ amb data 25/11/2026.\nAdjunto pòlissa AXA.\n\nSalutacions\nNuri",
    );
  });
});

describe("correuAnullacio", () => {
  it("diu matrícula, data i que el vehicle continua assegurat", () => {
    const c = correuAnullacio({ matricula: "0246NSZ", dataBaixa: "2026-11-25", signatura: "Nuri" });
    expect(c.assumpte).toBe("Anul·lació baixa flota tot risc – 0246NSZ");
    expect(c.cos).toContain("anul·leu la baixa de la matrícula 0246NSZ amb data 25/11/2026");
    expect(c.cos).toContain("El vehicle continua assegurat.");
  });
});

describe("configuració i destinataris", () => {
  it("principal, amb el suplent i Administració en còpia", () => {
    const r = llegeixConfigCorreu(ENTORN);
    expect(r.ok && destinataris(r.config)).toEqual({
      to: ["principal@example.com"],
      cc: ["suplent@example.com", "assegurances@example.com"],
    });
  });

  it("mode de proves: només l'adreça de proves, sense còpies", () => {
    const r = llegeixConfigCorreu({ ...ENTORN, CORREU_PROVES: "proves@example.com" });
    expect(r.ok && destinataris(r.config)).toEqual({ to: ["proves@example.com"], cc: [] });
  });

  it("diu quines variables obligatòries falten", () => {
    expect(llegeixConfigCorreu({ ...ENTORN, MS_GRAPH_CLIENT_SECRET: " ", CORREU_REMITENT: undefined })).toEqual({
      ok: false,
      falten: ["MS_GRAPH_CLIENT_SECRET", "CORREU_REMITENT"],
    });
  });

  it("accepta diverses adreces separades per comes i treu repetides", () => {
    const r = llegeixConfigCorreu({
      ...ENTORN,
      CORREU_GESTOR_SUPLENT: "a@example.com, b@example.com;Assegurances@example.com",
    });
    expect(r.ok && destinataris(r.config).cc).toEqual(["a@example.com", "b@example.com", "assegurances@example.com"]);
  });

  it("signatura per defecte i còpies opcionals", () => {
    const r = llegeixConfigCorreu({ ...ENTORN, CORREU_SIGNATURA: "", CORREU_GESTOR_SUPLENT: "", CORREU_COPIA_ADMIN: "" });
    expect(r.ok && r.config.signatura).toBe("Administració");
    expect(r.ok && destinataris(r.config).cc).toEqual([]);
  });
});

describe("enviament d'estoc a Proassa", () => {
  it("destinataris: Proassa amb còpia a Administració; en proves només proves; sense adreça → null", () => {
    const amb = llegeixConfigCorreu({ ...ENTORN, CORREU_PROASSA: "flota@example.com" });
    expect(amb.ok && destinatarisProassa(amb.config)).toEqual({ to: ["flota@example.com"], cc: ["assegurances@example.com"] });
    const proves = llegeixConfigCorreu({ ...ENTORN, CORREU_PROASSA: "flota@example.com", CORREU_PROVES: "jo@example.com" });
    expect(proves.ok && destinatarisProassa(proves.config)).toEqual({ to: ["jo@example.com"], cc: [] });
    const dues = llegeixConfigCorreu({ ...ENTORN, CORREU_PROASSA: "Flota@example.com; altra@example.com" });
    expect(dues.ok && destinatarisProassa(dues.config)?.to).toEqual(["flota@example.com", "altra@example.com"]);
    const sense = llegeixConfigCorreu(ENTORN);
    expect(sense.ok && destinatarisProassa(sense.config)).toBeNull();
  });

  it("el cos porta data, total, altes i baixes", () => {
    const c = correuEstocProassa({ data: "2026-11-18", total: 270, altes: ["1111AAA"], baixes: ["2222BBB", "3333CCC"], signatura: "Nuri" });
    expect(c.assumpte).toContain("18/11/2026");
    expect(c.cos).toContain("a data 18/11/2026 (270 vehicles)");
    expect(c.cos).toContain("Altes (1):\n- 1111AAA");
    expect(c.cos).toContain("Baixes (2):\n- 2222BBB\n- 3333CCC");
  });

  it("sense canvis ho diu", () => {
    const c = correuEstocProassa({ data: "2026-11-18", total: 1, altes: [], baixes: [], signatura: "Nuri" });
    expect(c.cos).toContain("Sense canvis");
  });
});
