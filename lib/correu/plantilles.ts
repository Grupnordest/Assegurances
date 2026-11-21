/** Correus a la Corredoria (PRD FR-9 i anul·lació de FR-11). Format del que envia avui Administració. */

export type Correu = { assumpte: string; cos: string };

/** "YYYY-MM-DD" → "dd/mm/aaaa" */
export function dataCurta(data: string): string {
  return data.split("-").reverse().join("/");
}

/** S'adjunta sempre la pòlissa AXA del vehicle (Certificat de pòlissa). */
export function correuBaixa(p: { matricula: string; dataBaixa: string; signatura: string }): Correu {
  return {
    assumpte: `Baixa flota tot risc – ${p.matricula}`,
    cos: [
      "Bones,",
      "",
      `Sol·licitem la baixa de la matrícula ${p.matricula} amb data ${dataCurta(p.dataBaixa)}.`,
      "Adjunto pòlissa AXA.",
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
