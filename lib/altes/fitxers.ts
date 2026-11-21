/** Fitxers del circuit d'altes: fotos (JPG/PNG) i documents (foto o PDF). */
import { esPdf } from "../pdf";

export type TipusAdjunt = "jpg" | "png" | "pdf";

export const MIME_ADJUNT: Record<TipusAdjunt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
};

/** Tipus pel contingut (no ens fiem de l'extensió): JPEG "FF D8 FF", PNG "89 50 4E 47" o PDF. */
export function tipusAdjunt(c: Uint8Array): TipusAdjunt | null {
  if (c.length > 3 && c[0] === 0xff && c[1] === 0xd8 && c[2] === 0xff) return "jpg";
  if (c.length > 4 && c[0] === 0x89 && c[1] === 0x50 && c[2] === 0x4e && c[3] === 0x47) return "png";
  if (esPdf(c)) return "pdf";
  return null;
}

/** Extensió a partir d'un camí desat ("altes/…/davant.jpg" → "jpg"). */
export function extensio(path: string): TipusAdjunt {
  const e = path.split(".").pop()?.toLowerCase();
  return e === "png" || e === "pdf" ? e : "jpg";
}
