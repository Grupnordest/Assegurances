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
