const ZONA = "Europe/Madrid";

/** Data (any, mes, dia) d'un instant a l'hora de Madrid. */
function dataLocal(d: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/**
 * Dies laborables (dilluns a divendres, sense festius) que han passat des de `des`
 * fins a `ara`, sense comptar el dia de `des`. Ex.: dilluns → dijous = 3.
 */
export function diesLaborablesDes(des: Date, ara: Date): number {
  const a = dataLocal(des);
  const b = dataLocal(ara);
  const inici = Date.UTC(a.y, a.m - 1, a.d);
  const fi = Date.UTC(b.y, b.m - 1, b.d);
  let dies = 0;
  for (let t = inici + 86_400_000; t <= fi; t += 86_400_000) {
    const diaSetmana = new Date(t).getUTCDay();
    if (diaSetmana !== 0 && diaSetmana !== 6) dies++;
  }
  return dies;
}

/** L'estoc és antic si fa més de 3 dies laborables (PRD FR-3). */
export const MAX_DIES_ESTOC = 3;

/** Data d'avui a Madrid ("YYYY-MM-DD"). */
export function avuiMadrid(ara: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(ara);
}
