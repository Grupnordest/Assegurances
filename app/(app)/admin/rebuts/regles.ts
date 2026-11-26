import type { ResultatRebuts } from "@/lib/rebuts/llegeix-rebuts";
import { t } from "@/lib/textos";

export { MIDA_MAXIMA } from "../vehicles/regles";
/** Fitxers per pujada (els rebuts arriben d'un en un o en pocs). */
export const MAX_FITXERS = 20;

const e = t.rebuts.errors;

export function missatgeErrorRebuts(r: Extract<ResultatRebuts, { ok: false }>): string {
  switch (r.error) {
    case "illegible":
      return e.illegible;
    case "sense-capcaleres":
      return e.senseCapcaleres;
    case "massa-files":
      return e.massaFiles(r.maxim);
    case "format":
      return e.format(r.falten);
    case "dades":
      return e.dades(r.fila, r.camp);
    case "buit":
      return e.buit;
  }
}
