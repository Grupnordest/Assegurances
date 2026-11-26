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

/** Avís a Administració: a una Sol·licitud d'alta li falten el PC i/o la FT. */
export function avisFaltenDocuments(p: { matricula: string; falten: string[]; sollicitant: string; enllac: string }): Correu {
  return {
    assumpte: `Falta documentació – alta ${p.matricula}`,
    cos: [
      "Hola,",
      "",
      `${p.sollicitant} ha demanat l'alta del ${p.matricula}, però falta: ${p.falten.join(" i ")}.`,
      "Sense aquests documents no es pot enviar a la corredoria.",
      "",
      `Afegeix-los aquí: ${p.enllac}`,
      "",
      "Control d'assegurances",
    ].join("\n"),
  };
}

export type TipusAvisCorreu = "set_dies" | "data_prevista" | "vs_12m" | "demo_4m";

/** Avís al Responsable (o escalat) amb els dos enllaços de resposta (FR-13, FR-14, FR-15, FR-16, FR-32). */
export function correuAvis(p: {
  tipus: TipusAvisCorreu;
  matricula: string;
  marcaModel: string | null;
  dataAlta: string | null;
  dataPrevista: string | null;
  /** Escalat: nom de qui no ha respost. */
  senseResposta?: string | null;
  enllac: string;
}): Correu {
  const vehicle = `${p.matricula}${p.marcaModel ? ` (${p.marcaModel})` : ""}`;
  const desDe = p.dataAlta ? ` des del ${dataCurta(p.dataAlta)}` : "";
  const pregunta = {
    set_dies: `El ${vehicle} està assegurat${desDe} i no té data prevista de baixa. Encara el necessiteu?`,
    data_prevista: `Ha arribat la data prevista de baixa del ${vehicle}${p.dataPrevista ? ` (${dataCurta(p.dataPrevista)})` : ""}. Es pot donar de baixa?`,
    vs_12m: `El VS ${vehicle} està assegurat${desDe}. El donem de baixa o es manté?`,
    demo_4m: `El ${vehicle} està assegurat${desDe} i no té data prevista de baixa. El donem de baixa o es manté?`,
  }[p.tipus];
  const opcions =
    p.tipus === "vs_12m"
      ? [`- Donar-lo de baixa: ${p.enllac}?r=baixa`, `- Es manté: ${p.enllac}?r=mante`]
      : p.tipus === "demo_4m"
        ? [`- Donar-lo de baixa: ${p.enllac}?r=baixa`, `- Es manté fins a una data: ${p.enllac}?r=mante_fins`]
        : [`- Ja es pot donar de baixa: ${p.enllac}?r=baixa`, `- Encara el necessito fins a una data: ${p.enllac}?r=mante_fins`];
  return {
    assumpte: `${p.senseResposta ? "Sense resposta: " : ""}Assegurança del ${p.matricula} – cal una resposta`,
    cos: [
      "Hola,",
      "",
      ...(p.senseResposta ? [`${p.senseResposta} no ha respost aquest avís; te'l fem arribar a tu.`, ""] : []),
      pregunta,
      "",
      ...opcions,
      "",
      "Cada enllaç obre una pàgina on pots triar la data abans de confirmar. Caduca d'aquí a 7 dies.",
      "",
      "Control d'assegurances",
    ].join("\n"),
  };
}

/** Resum diari a Administració de les Incidències obertes (FR-17). `data` en ISO; `tipus` és el nom visible. */
export function correuResumIncidencies(p: {
  incidencies: { tipus: string; matricula?: string; data: string }[];
  enllac: string;
}): Correu {
  const n = p.incidencies.length;
  const perTipus = new Map<string, number>();
  for (const i of p.incidencies) perTipus.set(i.tipus, (perTipus.get(i.tipus) ?? 0) + 1);
  return {
    assumpte: `Incidències obertes: ${n}`,
    cos: [
      "Hola,",
      "",
      n === 1 ? "Hi ha 1 incidència oberta:" : `Hi ha ${n} incidències obertes:`,
      ...[...perTipus].map(([t, c]) => `- ${t}: ${c}`),
      "",
      ...p.incidencies.map((i) => `${dataCurta(i.data.slice(0, 10))}  ${i.matricula ?? "—"}  ${i.tipus}`),
      "",
      p.enllac,
      "",
      "Control d'assegurances",
    ].join("\n"),
  };
}

/** Avís a Administració: baixa demanada des d'un Avís d'un vehicle sense pòlissa desada. */
export function correuBaixaPendentPolissa(p: { matricula: string; dataBaixa: string; qui: string; enllac: string }): Correu {
  return {
    assumpte: `Baixa pendent de pòlissa – ${p.matricula}`,
    cos: [
      "Hola,",
      "",
      `${p.qui} ha demanat la baixa del ${p.matricula} amb data ${dataCurta(p.dataBaixa)}, però el vehicle no té la pòlissa desada.`,
      "Puja-la a la fila del vehicle i la baixa s'enviarà a la corredoria.",
      "",
      p.enllac,
      "",
      "Control d'assegurances",
    ].join("\n"),
  };
}

/** Avís a Administració: la baixa demanada des d'un Avís no s'ha pogut enviar a la corredoria. */
export function correuBaixaAvisFallida(p: { matricula: string; dataBaixa: string; enllac: string }): Correu {
  return {
    assumpte: `No s'ha pogut enviar la baixa – ${p.matricula}`,
    cos: [
      "Hola,",
      "",
      `S'ha demanat la baixa del ${p.matricula} amb data ${dataCurta(p.dataBaixa)} des d'un avís, però el correu a la corredoria ha fallat.`,
      "L'avís torna a estar pendent. Fes la baixa des de la fila del vehicle.",
      "",
      p.enllac,
      "",
      "Control d'assegurances",
    ].join("\n"),
  };
}
