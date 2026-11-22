/** Regles pures dels Avisos (PRD FR-13, FR-14, FR-15, FR-16, FR-32). Dates "YYYY-MM-DD" (Madrid). */
import { avuiMadrid, diesLaborablesDes } from "../dies-laborables";

export type TipusAvis = "set_dies" | "data_prevista" | "vs_12m" | "demo_4m";
export type Resposta = "baixa" | "mante" | "mante_fins";

export type VehicleAvis = {
  motiu: string | null;
  estat: string;
  data_alta: string | null;
  data_prevista_baixa: string | null;
  /** Té una baixa pendent de pòlissa, enviant, enviada o anul·lant. */
  baixaEnCurs: boolean;
};

export type AvisPrevi = {
  tipus: TipusAvis;
  clau: string;
  estat: "pendent" | "resolt" | "cancelat" | "excepcio";
  resposta: Resposta | null;
  resolt_at: string | null;
};

export const DIES_PUNTUAL = 7;
export const MESOS_LLARG = 4;
export const MESOS_VS = 12;
export const MESOS_REPETICIO_VS = 3;
/** "Es manté fins al": com a molt un any (evita silenciar un vehicle per sempre). */
export const MAX_DIES_MANTE = 366;

/** Data "YYYY-MM-DD" que existeix al calendari. */
export function esDataReal(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** Data vàlida per a "Es manté fins al": posterior a avui i com a molt d'aquí a un any. */
export function esDataMante(data: unknown, avui: string): data is string {
  return esDataReal(data) && data > avui && data <= sumaDies(avui, MAX_DIES_MANTE);
}

const PUNTUALS = new Set(["prova", "client"]);
/** DEMO i els que es tracten com a DEMO (decisió de l'usuari, 21/11/2026). */
const LLARGS = new Set(["demo", "familia", "personal"]);

/** Suma dies a una data. */
export function sumaDies(data: string, dies: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dies);
  return d.toISOString().slice(0, 10);
}

/** Suma mesos; si el dia no existeix al mes final, l'últim dia del mes (31/01 + 1 mes = 28/02). */
export function sumaMesos(data: string, mesos: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const total = a * 12 + (m - 1) + mesos;
  const any = Math.floor(total / 12);
  const mes = total % 12;
  const ultim = new Date(Date.UTC(any, mes + 1, 0)).getUTCDate();
  return `${any}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(d, ultim)).padStart(2, "0")}`;
}

/** Quin Avís toca avui per a aquest vehicle (o cap). Idempotent: mai torna una clau ja creada. */
export function avisQueToca(v: VehicleAvis, previs: AvisPrevi[], avui: string): { tipus: TipusAvis; clau: string } | null {
  if (v.estat !== "assegurat" || v.baixaEnCurs || !v.data_alta || !v.motiu) return null;
  if (previs.some((a) => a.estat === "pendent")) return null;
  // Un Avís cancel·lat, o resolt amb una baixa que no ha prosperat (el vehicle continua assegurat),
  // no compta: si no, el vehicle no tornaria a rebre cap Avís.
  const vigents = previs.filter((a) => a.estat !== "cancelat" && a.resposta !== "baixa");
  const existeix = (clau: string) => vigents.some((a) => a.clau === clau);
  const nou = (tipus: TipusAvis, clau: string) => (existeix(clau) ? null : { tipus, clau });

  const puntual = PUNTUALS.has(v.motiu);
  const llarg = LLARGS.has(v.motiu);

  if ((puntual || llarg) && v.data_prevista_baixa) {
    return v.data_prevista_baixa <= avui ? nou("data_prevista", `data_prevista:${v.data_prevista_baixa}`) : null;
  }
  if (puntual) {
    return sumaDies(v.data_alta, DIES_PUNTUAL) <= avui ? nou("set_dies", "set_dies") : null;
  }
  if (llarg) {
    return sumaMesos(v.data_alta, MESOS_LLARG) <= avui ? nou("demo_4m", "demo_4m") : null;
  }
  if (v.motiu === "vs") {
    // Primer als 12 mesos; si es manté, cada 3 mesos des de la resposta.
    const vs = vigents.filter((a) => a.tipus === "vs_12m").sort((a, b) => a.clau.localeCompare(b.clau));
    const darrer = vs.at(-1);
    if (darrer && darrer.estat !== "resolt") return null; // sense resposta (excepció): no s'insisteix
    const venciment =
      darrer?.resposta === "mante" && darrer.resolt_at
        ? sumaMesos(avuiMadrid(new Date(darrer.resolt_at)), MESOS_REPETICIO_VS)
        : darrer
          ? null
          : sumaMesos(v.data_alta, MESOS_VS);
    return venciment && venciment <= avui ? nou("vs_12m", `vs_12m:${venciment}`) : null;
  }
  return null;
}

/** Què cal fer amb un Avís pendent: escalar-lo (1 dia laborable sense resposta) o passar-lo a excepció. */
export function passaEscalat(
  a: { nivell: number; enviat_at: string; escalat_at: string | null },
  ara: Date,
): "escala" | "excepcio" | null {
  if (a.nivell === 0) return diesLaborablesDes(new Date(a.enviat_at), ara) >= 1 ? "escala" : null;
  return a.escalat_at && diesLaborablesDes(new Date(a.escalat_at), ara) >= 1 ? "excepcio" : null;
}

/** Respostes possibles de cada tipus d'Avís. */
export function respostesDe(tipus: TipusAvis): Resposta[] {
  return tipus === "vs_12m" ? ["baixa", "mante"] : ["baixa", "mante_fins"];
}
