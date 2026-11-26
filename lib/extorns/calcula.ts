/**
 * Extorn esperat d'una baixa (PRD FR-23).
 * El Període de cartera va del 04/06 al 04/12 i del 04/12 al 04/06. La prima del Llistat
 * de flota és anual, i la companyia prorrateja per dies: extorn = prima anual × dies que
 * queden fins al final del període ÷ 365. Les dates són "YYYY-MM-DD".
 */

const DIA = 86_400_000;

function aUtc(data: string): number {
  const [y, m, d] = data.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function aText(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Final del Període de cartera que conté `data`: el pròxim 04/06 o 04/12 estrictament posterior. */
export function fiPeriodeCartera(data: string): string {
  const t = aUtc(data);
  const y = new Date(t).getUTCFullYear();
  const candidats = [Date.UTC(y, 5, 4), Date.UTC(y, 11, 4), Date.UTC(y + 1, 5, 4)];
  return aText(candidats.find((c) => c > t)!);
}

/** Dies des de la data de baixa (inclosa) fins al final del període (exclòs). */
export function diesNoConsumits(dataBaixa: string): number {
  return Math.round((aUtc(fiPeriodeCartera(dataBaixa)) - aUtc(dataBaixa)) / DIA);
}

/** Extorn esperat en euros, arrodonit a cèntims. null si no es coneix la prima ("pendent de prima"). */
export function extornEsperat(primaAnual: number | null, dataBaixa: string): number | null {
  if (primaAnual === null || !Number.isFinite(primaAnual) || primaAnual <= 0) return null;
  return Math.round((primaAnual * diesNoConsumits(dataBaixa) * 100) / 365) / 100;
}

/** Tolerància de la conciliació d'extorns (en euros, inclosa). */
export const TOLERANCIA_EXTORN = 1;

/**
 * Prima anual equivalent d'un Rebut d'alta (FR-23/FR-24): el rebut cobreix des de `inici` (inclòs)
 * fins a `fi` (exclòs), així que prima anual = prima × 365 ÷ dies del rebut. Arrodonit a cèntims.
 * null si la prima no és positiva o el període no té cap dia.
 */
export function primaAnualDeRebut(prima: number, inici: string, fi: string): number | null {
  const dies = Math.round((aUtc(fi) - aUtc(inici)) / DIA);
  if (!Number.isFinite(prima) || prima <= 0 || !(dies > 0)) return null;
  return Math.round((prima * 365 * 100) / dies) / 100;
}

/**
 * L'extorn liquidat (import del rebut, negatiu) quadra amb l'esperat si la diferència en valor absolut
 * és ≤ 1 €. Un import positiu o zero no quadra mai. Treballa en cèntims.
 */
export function quadra(esperat: number, liquidat: number): boolean {
  if (!(liquidat < 0)) return false;
  const c = (x: number) => Math.round(Math.abs(x) * 100);
  return Math.abs(c(esperat) - c(liquidat)) <= TOLERANCIA_EXTORN * 100;
}
