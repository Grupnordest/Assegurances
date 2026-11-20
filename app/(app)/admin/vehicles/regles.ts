import { z } from "zod";
import type { FilaDescartada, ResultatLlistat } from "@/lib/flota/llegeix-llistat";
import { t } from "@/lib/textos";

/** Per sota del límit de les Server Actions (5 MB a next.config.ts). */
export const MIDA_MAXIMA = 4 * 1024 * 1024;
/** PDF adjunts: el base64 hi suma un 33 % i Graph accepta com a molt ~4 MB per petició. */
export const MIDA_PDF = 2.5 * 1024 * 1024;
export const MOTIUS = ["vs", "prova", "client", "demo"] as const;

const e = t.vehicles.errors;
const buitANull = (v: unknown) => (v === "" || v === undefined || v === null ? null : v);

/** "YYYY-MM-DD" que existeix al calendari. */
export function esDataReal(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mes >= 1 && mes <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mes, 0)).getUTCDate();
}

export const classificacioSchema = z.object({
  id: z.string().uuid(e.noTrobat),
  versio: z.string().min(1, e.canviat),
  motiu: z.preprocess(buitANull, z.enum(MOTIUS, { errorMap: () => ({ message: e.dades }) }).nullable()),
  responsable: z.preprocess(buitANull, z.string().uuid(e.responsable).nullable()),
  centre: z.preprocess(buitANull, z.coerce.number().int().min(1, e.dades).max(32767, e.dades).nullable()),
  dataPrevista: z.preprocess(buitANull, z.string().refine(esDataReal, e.dades).nullable()),
});

export function missatgeErrorLlistat(r: Extract<ResultatLlistat, { ok: false }>): string {
  switch (r.error) {
    case "illegible":
      return e.illegible;
    case "sense-capcaleres":
      return e.senseCapcaleres;
    case "massa-files":
      return e.massaFiles(r.maxim);
    case "format":
      return e.format(r.falten);
    case "buit":
      return e.buit;
  }
}

export function textDescartades(d: FilaDescartada[]): string {
  return t.vehicles.carrega.descartades(d.length, d.map((x) => `fila ${x.fila} (${x.text || "—"})`).join(", "));
}

/** Tradueix errors de les funcions de la base de dades. */
export function missatgeErrorVehicles(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return e.generic;
  if (error.code === "42501") return e.permis;
  if (error.code === "23503") return e.dades;
  const m = error.message ?? "";
  if (m.includes("ja_carregat")) return e.jaCarregat;
  if (m.includes("canviat")) return e.canviat;
  if (m.includes("estat_invalid")) return e.estatInvalid;
  if (m.includes("responsable")) return e.responsable;
  if (m.includes("data_passada")) return e.dataPassada;
  if (m.includes("no_trobat")) return e.noTrobat;
  if (m.includes("sense_vehicles")) return e.buit;
  if (m.includes("ja_baixa")) return e.jaBaixa;
  if (m.includes("estat_baixa")) return e.estatBaixa;
  if (m.includes("sense_baixa")) return e.senseBaixa;
  if (m.includes("massa_tard")) return e.massaTard;
  if (m.includes("pendent_confirmar")) return e.pendentConfirmar;
  if (error.code === "23505") return e.jaBaixa;
  return e.generic;
}

export const baixaSchema = z.object({
  id: z.string().uuid(e.noTrobat),
  dataBaixa: z.string().refine(esDataReal, e.dataBaixa),
});

export const anullacioSchema = z.object({ id: z.string().uuid(e.noTrobat) });

export const resolucioSchema = z.object({
  id: z.string().uuid(e.noTrobat),
  tipus: z.enum(["baixa", "anullacio"]),
  resultat: z.enum(["enviat", "no_enviat"]),
});

export function missatgeErrorRelacio(error: "sense-data" | "sense-matricules" | "illegible"): string {
  if (error === "sense-data") return e.relacioSenseData;
  if (error === "sense-matricules") return e.relacioSenseMatricules;
  return e.relacioIllegible;
}
