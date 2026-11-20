/**
 * Relació de Flota VO: PDF d'AXA "Relación de vehículos asegurados a dd/mm/aaaa".
 * La lectura del text és pura (testejable); l'extracció del PDF és a `extreuTextPdf`.
 */

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
