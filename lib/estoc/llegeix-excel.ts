import * as XLSX from "xlsx";
import { esMatriculaValida, normalitzaMatricula } from "./matricula";

export type VehicleEstoc = {
  matricula: string;
  vin: string | null;
  marca: string | null;
  model: string | null;
  color: string | null;
  dies_estoc: number | null;
};

export type AvisLectura = "data-no-trobada";

export type ResultatLectura =
  | {
      ok: true;
      /** Hora local de l'Excel, "YYYY-MM-DDTHH:MM", o null si no s'ha trobat. */
      dataEstoc: string | null;
      vehicles: VehicleEstoc[];
      descartats: number;
      avisos: AvisLectura[];
    }
  | { ok: false; error: "illegible" }
  | { ok: false; error: "format"; falten: string[] }
  | { ok: false; error: "buit" };

/** Capçaleres obligatòries de l'Excel "Stock VO" de Spiga (tal com hi surten). */
export const CAPCALERES = ["VIN", "Matrícula", "Marca", "Modelo", "Color", "Días en Stock"] as const;
type Capcalera = (typeof CAPCALERES)[number];

const clau = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const text = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s.length ? s : null;
};

/** Dies en estoc: enter entre 0 i 100.000; qualsevol altra cosa → null (no fa caure la càrrega). */
const MAX_DIES = 100_000;
const enter = (v: unknown): number | null => {
  let n: number;
  if (typeof v === "number") n = v;
  else {
    const s = String(v ?? "").trim();
    if (!/^\d+$/.test(s)) return null;
    n = Number(s);
  }
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 0 && r <= MAX_DIES ? r : null;
};

const dues = (n: number) => String(n).padStart(2, "0");

function dataValida(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Data d'una cel·la: text "dd/mm/aaaa" o data d'Excel (número de sèrie). */
function llegeixDia(cel: unknown): string | null {
  if (typeof cel === "number" && cel > 30000 && cel < 80000) {
    const p = XLSX.SSF.parse_date_code(cel);
    return p && dataValida(p.y, p.m, p.d) ? `${p.y}-${dues(p.m)}-${dues(p.d)}` : null;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(cel ?? "").trim());
  if (!m) return null;
  const [d, mes, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return dataValida(y, mes, d) ? `${y}-${dues(mes)}-${dues(d)}` : null;
}

/** Hora d'una cel·la: text "hh:mm[:ss]" o fracció de dia d'Excel. */
function llegeixHora(cel: unknown): string | null {
  if (typeof cel === "number" && cel >= 0 && cel < 1) {
    const minuts = Math.round(cel * 24 * 60);
    return `${dues(Math.floor(minuts / 60) % 24)}:${dues(minuts % 60)}`;
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(cel ?? "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${dues(Number(m[1]))}:${m[2]}`;
}

/** Busca la primera data i la primera hora vàlides a les files de sobre de les capçaleres. */
function buscaData(files: unknown[][]): string | null {
  let data: string | null = null;
  let hora: string | null = null;
  for (const fila of files) {
    for (const cel of fila) {
      data ??= llegeixDia(cel);
      hora ??= llegeixHora(cel);
    }
  }
  return data ? `${data}T${hora ?? "00:00"}` : null;
}

/** Límit de files llegides: evita que un rang declarat enorme (A1:XFD1048576) bloquegi el servidor. */
const MAX_FILES = 20_000;
/** Fins a quina fila es busquen les capçaleres. */
const FILES_CAPCALERA = 20;

/**
 * Llegeix l'Excel d'Estoc de Spiga (PRD FR-3). Funció pura: no toca la base de dades.
 * "Modelo" i "Color" surten dues vegades; es fa servir l'última (codificació secundària).
 */
export function llegeixEstoc(fitxer: ArrayBuffer | Uint8Array): ResultatLectura {
  let files: unknown[][];
  try {
    const llibre = XLSX.read(fitxer, { type: "array", cellDates: false, dense: true, sheetRows: MAX_FILES });
    const full = llibre.Sheets[llibre.SheetNames[0]];
    if (!full) return { ok: false, error: "illegible" };
    files = XLSX.utils.sheet_to_json<unknown[]>(full, { header: 1, raw: true, defval: null, blankrows: true });
  } catch {
    return { ok: false, error: "illegible" };
  }

  const filaCap = files.slice(0, FILES_CAPCALERA).findIndex((f) => f.some((c) => clau(c) === clau("Matrícula")));
  if (filaCap < 0) return { ok: false, error: "format", falten: [...CAPCALERES] };

  const capcaleres = files[filaCap].map(clau);
  const index = {} as Record<Capcalera, number>;
  const falten: string[] = [];
  for (const c of CAPCALERES) {
    const i = capcaleres.lastIndexOf(clau(c));
    if (i < 0) falten.push(c);
    else index[c] = i;
  }
  if (falten.length) return { ok: false, error: "format", falten };

  const vehicles: VehicleEstoc[] = [];
  const vistes = new Set<string>();
  let descartats = 0;

  for (const fila of files.slice(filaCap + 1)) {
    const valor = (c: Capcalera) => fila[index[c]];
    const esVehicle = [valor("Matrícula"), valor("VIN"), valor("Marca"), valor("Modelo")].some((v) => text(v));
    if (!esVehicle) continue; // línia en blanc o de recompte

    const matricula = normalitzaMatricula(valor("Matrícula"));
    if (!esMatriculaValida(matricula) || vistes.has(matricula)) {
      descartats++;
      continue;
    }
    vistes.add(matricula);
    vehicles.push({
      matricula,
      vin: text(valor("VIN")),
      marca: text(valor("Marca")),
      model: text(valor("Modelo")),
      color: text(valor("Color")),
      dies_estoc: enter(valor("Días en Stock")),
    });
  }

  if (vehicles.length === 0) return { ok: false, error: "buit" };

  const dataEstoc = buscaData(files.slice(0, filaCap));
  return { ok: true, dataEstoc, vehicles, descartats, avisos: dataEstoc ? [] : ["data-no-trobada"] };
}
