import { normalitzaMatricula } from "../estoc/matricula";

/**
 * Matrícules de la llista que apareixen dins un text (nom de fitxer o text d'un PDF).
 * Es compara amb el text normalitzat (sense espais ni guions), així "POL. 1234 ABC.pdf"
 * troba 1234ABC. Retorna les diferents trobades, ordenades.
 */
export function matriculesConegudesA(text: string, conegudes: Iterable<string>): string[] {
  const net = normalitzaMatricula(text);
  const trobades = new Set<string>();
  for (const m of conegudes) {
    if (m.length >= 5 && net.includes(m)) trobades.add(m);
  }
  return [...trobades].sort();
}

/** Matrícula del nom d'un fitxer (sense extensió); null si no n'hi ha exactament una. */
export function matriculaDelNom(nom: string, conegudes: Iterable<string>): string | null {
  const senseExt = nom.replace(/\.pdf$/i, "");
  const t = matriculesConegudesA(senseExt, conegudes);
  return t.length === 1 ? t[0] : null;
}

// Al text del PDF, la matrícula ha d'anar separada de la resta (pot portar un espai o guió a dins):
// no es busca dins del text enganxat perquè un número de pòlissa o un CIF no doni un fals positiu.
const MATRICULA_TEXT = /(?<![A-Z0-9])(\d{4}[ -]?[A-Z]{3}|[A-Z]{1,2}[ -]?\d{4}[ -]?[A-Z]{1,2})(?![A-Z0-9])/g;

/** Matrícules de la llista que surten com a paraula pròpia al text d'un PDF. */
export function matriculesDelText(text: string, conegudes: Iterable<string>): string[] {
  const llista = new Set(conegudes);
  const net = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const trobades = new Set<string>();
  for (const m of net.matchAll(MATRICULA_TEXT)) {
    const c = m[1].replace(/[ -]/g, "");
    if (llista.has(c)) trobades.add(c);
  }
  return [...trobades].sort();
}
