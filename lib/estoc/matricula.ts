/**
 * Matrícula en format únic: majúscules i només lletres i xifres
 * ("5855 hrt" → "5855HRT", "B-5865-GW" → "B5865GW").
 */
export function normalitzaMatricula(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Matrícules espanyoles actuals (0000AAA), antigues provincials (B5865GW) i similars. */
export function esMatriculaValida(matricula: string): boolean {
  return /^[A-Z0-9]{4,10}$/.test(matricula);
}
