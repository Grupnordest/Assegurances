/**
 * Relació de Flota VO: PDF d'AXA "Relación de vehículos asegurados a dd/mm/aaaa",
 * o l'Excel de Proassa "Comunicación de stock de matrículas…" (la data va al nom del fitxer).
 * La lectura del text és pura (testejable); l'extracció del PDF és a `extreuTextPdf`.
 */
import * as XLSX from "xlsx";
import { normalitzaMatricula } from "../estoc/matricula";

export type ResultatRelacio =
  | { ok: true; data: string; matricules: string[] }
  | { ok: false; error: "sense-data" | "sense-matricules" | "illegible" };

// Actuals (0000AAA) i antigues provincials (B5865GW, GI1234AB). Fronteres explícites
// perquè no es prengui un tros d'un número més llarg (DNI, número de pòlissa…).
const MATRICULA = /(?<![A-Z0-9])(\d{4}[A-Z]{3}|[A-Z]{1,2}\d{4}[A-Z]{1,2})(?![A-Z0-9])/g;
const DATA = /asegurados\s+a\s+(\d{2})\/(\d{2})\/(\d{4})/i;

export function llegeixRelacio(text: string): ResultatRelacio {
  const d = DATA.exec(text);
  if (!d) return { ok: false, error: "sense-data" };
  const [dia, mes, any] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const dt = new Date(Date.UTC(any, mes - 1, dia));
  if (dt.getUTCFullYear() !== any || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) {
    return { ok: false, error: "sense-data" };
  }

  const matricules = [...new Set([...text.matchAll(MATRICULA)].map((m) => m[1]))].sort();
  if (matricules.length === 0) return { ok: false, error: "sense-matricules" };
  return { ok: true, data: `${d[3]}-${d[2]}-${d[1]}`, matricules };
}

/** "YYYY-MM-DD" si és una data real; si no, null. */
function dataValida(any: number, mes: number, dia: number): string | null {
  const dt = new Date(Date.UTC(any, mes - 1, dia));
  if (dt.getUTCFullYear() !== any || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return null;
  return `${any}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Data del nom del fitxer: "2026-11-18" o "18-11-2026" (amb -, _, . o /). */
export function dataDelNom(nom: string): string | null {
  const iso = /(?<!\d)(\d{4})[-_./](\d{2})[-_./](\d{2})(?!\d)/.exec(nom);
  if (iso) return dataValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const eu = /(?<!\d)(\d{2})[-_./](\d{2})[-_./](\d{4})(?!\d)/.exec(nom);
  if (eu) return dataValida(Number(eu[3]), Number(eu[2]), Number(eu[1]));
  return null;
}

const MATRICULA_CEL = /^(\d{4}[A-Z]{3}|[A-Z]{1,2}\d{4}[A-Z]{1,2})$/;

/** Excel de la relació: matrícules = celes que són una matrícula sencera; data = nom del fitxer. */
export function llegeixRelacioExcel(bytes: Uint8Array, nomFitxer: string): ResultatRelacio {
  let celes: unknown[];
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    celes = wb.SheetNames.flatMap((n) =>
      XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: null }).flat(),
    );
  } catch {
    return { ok: false, error: "illegible" };
  }
  const data = dataDelNom(nomFitxer);
  if (!data) return { ok: false, error: "sense-data" };
  const matricules = [
    ...new Set(celes.map(normalitzaMatricula).filter((m) => MATRICULA_CEL.test(m))),
  ].sort();
  if (matricules.length === 0) return { ok: false, error: "sense-matricules" };
  return { ok: true, data, matricules };
}

/** Text d'un PDF (totes les pàgines). Llança si el fitxer no és un PDF llegible. */
export async function extreuTextPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Llegeix el PDF de la relació; qualsevol error de lectura → "illegible". */
export async function llegeixRelacioPdf(bytes: Uint8Array): Promise<ResultatRelacio> {
  try {
    return llegeixRelacio(await extreuTextPdf(bytes));
  } catch {
    return { ok: false, error: "illegible" };
  }
}
