import type { ResultatLectura } from "@/lib/estoc/llegeix-excel";
import { t } from "@/lib/textos";

/** Per sota del límit de les Server Actions (5 MB a next.config.ts), que inclou la capçalera del formulari. */
export const MIDA_MAXIMA = 4 * 1024 * 1024;

/** El fitxer nou té menys de la meitat de vehicles que l'estoc vigent. */
export function esCaigudaForta(abans: number, ara: number): boolean {
  return abans > 0 && ara < abans / 2;
}

export function missatgeErrorLectura(r: Extract<ResultatLectura, { ok: false }>): string {
  switch (r.error) {
    case "illegible":
      return t.estoc.errors.illegible;
    case "format":
      return t.estoc.errors.format(r.falten);
    case "buit":
      return t.estoc.errors.buit;
  }
}
