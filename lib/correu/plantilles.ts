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

/** Enviament de l'estoc a Proassa (Pòlissa Flota VO): data, total i matrícules que entren i surten. */
export function correuEstocProassa(p: {
  data: string;
  total: number;
  altes: string[];
  baixes: string[];
  signatura: string;
}): Correu {
  const llista = (titol: string, m: string[]) => (m.length ? [`${titol} (${m.length}):`, ...m.map((x) => `- ${x}`), ""] : []);
  const canvis =
    p.altes.length || p.baixes.length
      ? [...llista("Altes", p.altes), ...llista("Baixes", p.baixes)]
      : ["Sense canvis respecte a l'últim enviament.", ""];
  return {
    assumpte: `Stock VO Grup Nordest ${dataCurta(p.data)} – pòlissa flota VO`,
    cos: [
      "Bones,",
      "",
      `Us adjuntem l'estoc de vehicles d'ocasió a data ${dataCurta(p.data)} (${p.total} vehicles).`,
      "",
      ...canvis,
      "Salutacions",
      p.signatura,
    ].join("\n"),
  };
}

/** Correu d'alta a la Corredoria (FR-8), en el format que envia avui Administració. */
export function correuAlta(p: {
  matricula: string;
  marcaModel: string | null;
  color: string | null;
  vin: string | null;
  cobertura: "tot_risc" | "tercers";
  dataAlta: string;
}): Correu {
  return {
    assumpte: `Alta flota tot risc – ${p.matricula}`,
    cos: [
      "Bon dia,",
      "",
      `Sol·licitem una alta a la flota ${p.cobertura === "tot_risc" ? "tot risc + fq 300 €" : "a tercers"}`,
      (p.marcaModel ?? "").toUpperCase(),
      (p.color ?? "").toUpperCase(),
      `Matrícula: ${p.matricula} · Data d'alta: ${dataCurta(p.dataAlta)}`,
      ...(p.vin ? [`Bastidor: ${p.vin}`] : []),
      "Adjunto documentació.",
      "",
      "Gràcies",
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n"),
  };
}

/** Avís als Validadors: hi ha una Sol·licitud d'alta per validar. */
export function avisSollicitudAlta(p: {
  matricula: string;
  marcaModel: string | null;
  motiu: string;
  sollicitant: string;
  dataAlta: string;
  enllac: string;
}): Correu {
  return {
    assumpte: `Alta per validar – ${p.matricula}`,
    cos: [
      "Hola,",
      "",
      `${p.sollicitant} demana assegurar el ${p.matricula}${p.marcaModel ? ` (${p.marcaModel})` : ""} a partir del ${dataCurta(p.dataAlta)}.`,
      `Motiu: ${p.motiu}.`,
      "",
      `Valida-la o rebutja-la aquí: ${p.enllac}`,
      "",
      "Control d'assegurances",
    ].join("\n"),
  };
}

/** Avís al Sol·licitant: la seva Sol·licitud d'alta s'ha validat o rebutjat. */
export function avisResolucioAlta(p: {
  matricula: string;
  validada: boolean;
  qui: string;
  motiuRebuig?: string | null;
  enllac: string;
}): Correu {
  return {
    assumpte: `${p.validada ? "Alta validada" : "Alta rebutjada"} – ${p.matricula}`,
    cos: [
      "Hola,",
      "",
      p.validada
        ? `${p.qui} ha validat l'alta del ${p.matricula}. S'ha enviat a la corredoria; quan arribi la pòlissa, el vehicle quedarà assegurat.`
        : `${p.qui} ha rebutjat l'alta del ${p.matricula}. Motiu: ${p.motiuRebuig ?? "—"}.`,
      "",
      `Les teves sol·licituds: ${p.enllac}`,
      "",
      "Control d'assegurances",
    ].join("\n"),
  };
}
