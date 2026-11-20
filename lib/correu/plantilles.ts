/** Correus a la Corredoria (PRD FR-9 i anul·lació de FR-11). Format del que envia avui Administració. */

export type Correu = { assumpte: string; cos: string };
export type TipusJustificant = "relacio" | "nou_titular";

/** "YYYY-MM-DD" → "dd/mm/aaaa" */
export function dataCurta(data: string): string {
  return data.split("-").reverse().join("/");
}

export function correuBaixa(p: {
  matricula: string;
  dataBaixa: string;
  justificant: TipusJustificant;
  signatura: string;
}): Correu {
  const adjunt = p.justificant === "relacio" ? "Adjunto pòlissa AXA." : "Adjunto justificant del nou titular.";
  return {
    assumpte: `Baixa flota tot risc – ${p.matricula}`,
    cos: [
      "Bones,",
      "",
      `Sol·licitem la baixa de la matrícula ${p.matricula} amb data ${dataCurta(p.dataBaixa)}.`,
      adjunt,
      "",
      "Salutacions",
      p.signatura,
    ].join("\n"),
  };
}

export function correuAnullacio(p: { matricula: string; dataBaixa: string; signatura: string }): Correu {
  return {
    assumpte: `Anul·lació baixa flota tot risc – ${p.matricula}`,
    cos: [
      "Bones,",
      "",
      `Us demanem que anul·leu la baixa de la matrícula ${p.matricula} amb data ${dataCurta(p.dataBaixa)}.`,
      "El vehicle continua assegurat.",
      "",
      "Salutacions",
      p.signatura,
    ].join("\n"),
  };
}
