/** Regles pures del circuit d'altes (PRD FR-5, FR-6). */
import { z } from "zod";
import type { Rol } from "../acces";

export const MOTIUS_ALTA = ["vs", "prova", "client", "demo", "familia", "personal"] as const;
export type MotiuAlta = (typeof MOTIUS_ALTA)[number];
export const COBERTURES = ["tot_risc", "tercers"] as const;

/** Posicions de les 4 fotos, en l'ordre en què es desen i s'adjunten. */
export const FOTOS = ["davant", "darrere", "dret", "esquerre"] as const;

/** Adjunts del correu d'alta: per sota de ~4 MB un cop en base64 (Graph). */
export const MIDA_TOTAL_ADJUNTS = 2.9 * 1024 * 1024;
/** Cada fitxer pujat (abans de reduir, al navegador; al servidor ja ha d'estar reduït). */
export const MIDA_FITXER = 2.5 * 1024 * 1024;

/** Rol que valida cada Motiu (Administració ho pot validar tot). */
export function rolValidador(motiu: MotiuAlta): Rol {
  return motiu === "vs" ? "cap_postvenda" : "validador";
}

export function potValidar(rols: Rol[], motiu: MotiuAlta): boolean {
  return rols.includes("administracio") || rols.includes(rolValidador(motiu));
}

/** Pot veure la pantalla "Pendents de validar". */
export function esValidadorDeQualsevol(rols: Rol[]): boolean {
  return rols.some((r) => r === "administracio" || r === "validador" || r === "cap_postvenda");
}

const esDataReal = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};
const buitANull = (v: unknown) => (v === "" || v === null || v === undefined ? null : v);

export function altaSchema(missatges: {
  matricula: string;
  motiu: string;
  data: string;
  dataPrevista: string;
  centre: string;
  cobertura: string;
}) {
  return z
    .object({
      matricula: z.string().regex(/^[A-Z0-9]{4,10}$/, missatges.matricula),
      motiu: z.enum(MOTIUS_ALTA, { errorMap: () => ({ message: missatges.motiu }) }),
      dataAlta: z.string().refine(esDataReal, missatges.data),
      centre: z.coerce.number({ invalid_type_error: missatges.centre }).int(missatges.centre).positive(missatges.centre),
      cobertura: z.enum(COBERTURES, { errorMap: () => ({ message: missatges.cobertura }) }),
      dataPrevista: z.preprocess(buitANull, z.string().refine(esDataReal, missatges.dataPrevista).nullable()),
      comentari: z.preprocess(buitANull, z.string().trim().max(500).nullable()),
    })
    .refine((d) => d.dataPrevista === null || d.dataPrevista >= d.dataAlta, {
      message: missatges.dataPrevista,
      path: ["dataPrevista"],
    });
}
