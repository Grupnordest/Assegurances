import * as XLSX from "xlsx";
import { esMatriculaValida, normalitzaMatricula } from "../estoc/matricula";
import { primaAnualDeRebut } from "../extorns/calcula";

/** Emissió (Clase 00/02), extorn (Clase 93) o qualsevol altra (no s'importa: cal decidir-ho abans). */
export type TipusRebut = "emissio" | "extorn" | "desconeguda";

export type LiniaRebut = {
  num_rebut: string;
  polissa: string | null;
  clase: string;
  tipus: TipusRebut;
  /** "YYYY-MM-DD" */
  inici: string;
  fi: string;
  prima_total: number;
  prima_neta: number | null;
  liquid: number | null;
  situacio: string | null;
  data_situacio: string | null;
  matricula: string;
  /** Prima anual equivalent (només emissions): prima × 365 ÷ dies del rebut. */
  prima_anual: number | null;
};

export type ResultatRebuts =
  | { ok: true; linies: LiniaRebut[]; ignorades: number; desconegudes: LiniaRebut[] }
  | { ok: false; error: "illegible" }
  | { ok: false; error: "sense-capcaleres" }
  | { ok: false; error: "massa-files"; maxim: number }
  | { ok: false; error: "format"; falten: string[] }
  | { ok: false; error: "dades"; fila: number; camp: string }
  | { ok: false; error: "buit" };

/** Capçaleres de l'Excel de rebuts de la Corredoria. */
export const CAPCALERES_REBUTS = [
  "Recibo",
  "Póliza",
  "Clase",
  "Inicio cobertura",
  "Fin cobertura",
  "Prima total",
  "Prima Neta",
  "Líquido",
  "Situación",
  "Fecha situación",
  "Datos adicionales",
] as const;
type Capcalera = (typeof CAPCALERES_REBUTS)[number];

const MAX_FILES = 2_000;
const FILES_CAPCALERA = 20;

const clau = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

const text = (v: unknown): string | null => {
  const s = v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim();
  return s.length ? s : null;
};

const dues = (n: number) => String(n).padStart(2, "0");
function dataValida(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Data "dd.mm.aaaa" (o "dd/mm/aaaa", o data d'Excel) → "YYYY-MM-DD". Qualsevol altra cosa → null. */
export function llegeixDataRebut(v: unknown): string | null {
  if (typeof v === "number" && v > 30000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    return p && dataValida(p.y, p.m, p.d) ? `${p.y}-${dues(p.m)}-${dues(p.d)}` : null;
  }
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const [d, mes, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return dataValida(y, mes, d) ? `${y}-${dues(mes)}-${dues(d)}` : null;
}

/**
 * Import amb signe, arrodonit a cèntims. Accepta números, punt decimal ("-130.24")
 * i format espanyol ("-1.234,56"). Qualsevol altra cosa → null.
 */
export function llegeixImportRebut(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const s = String(v ?? "")
    .replace(/€/g, "")
    .replace(/\s/g, "");
  if (/^-?\d+(\.\d{1,2})?$/.test(s)) return Math.round(Number(s) * 100) / 100;
  if (/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(s)) {
    return Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100) / 100;
  }
  return null;
}

/** Tipus pel prefix de "Clase": "00-Nueva Produccion" → emissió, "93-Recibo de Extorno" → extorn. */
export function classificaClase(clase: string): TipusRebut {
  const m = /^\s*(?:\d+\/)?(\d{1,2})\b/.exec(clase);
  if (!m) return "desconeguda";
  const n = Number(m[1]);
  if (n === 0 || n === 2) return "emissio";
  if (n === 93) return "extorn";
  return "desconeguda";
}

/** Llegeix un Excel de rebuts de la Corredoria (PRD FR-24). Funció pura. */
export function llegeixRebuts(fitxer: ArrayBuffer | Uint8Array): ResultatRebuts {
  let files: unknown[][];
  try {
    const llibre = XLSX.read(fitxer, { type: "array", cellDates: false, dense: true, sheetRows: MAX_FILES });
    const full = llibre.Sheets[llibre.SheetNames[0]];
    if (!full) return { ok: false, error: "illegible" };
    const rang = full["!fullref"] ?? full["!ref"];
    if (rang && XLSX.utils.decode_range(rang).e.r + 1 > MAX_FILES) {
      return { ok: false, error: "massa-files", maxim: MAX_FILES };
    }
    files = XLSX.utils.sheet_to_json<unknown[]>(full, { header: 1, raw: true, defval: null, blankrows: true });
  } catch {
    return { ok: false, error: "illegible" };
  }

  // La capçalera és la fila que comença per "Recibo" i porta "Datos adicionales" (la fila 1 és "Recibo NNN").
  const filaCap = files
    .slice(0, FILES_CAPCALERA)
    .findIndex((f) => clau(f[0]) === clau("Recibo") && f.some((c) => clau(c) === clau("Datos adicionales")));
  if (filaCap < 0) return { ok: false, error: "sense-capcaleres" };

  const capcaleres = files[filaCap].map(clau);
  const index = {} as Record<Capcalera, number>;
  const falten: string[] = [];
  for (const c of CAPCALERES_REBUTS) {
    const i = capcaleres.indexOf(clau(c));
    if (i < 0) falten.push(c);
    else index[c] = i;
  }
  if (falten.length) return { ok: false, error: "format", falten };

  const linies: LiniaRebut[] = [];
  const desconegudes: LiniaRebut[] = [];
  let ignorades = 0;

  for (let i = filaCap + 1; i < files.length; i++) {
    const fila = files[i];
    const valor = (c: Capcalera) => fila[index[c]];
    const numFila = i + 1;
    const num = text(valor("Recibo"));
    if (!num) {
      if (fila.some((c) => text(c) !== null)) return { ok: false, error: "dades", fila: numFila, camp: "Recibo" };
      continue; // línia en blanc
    }
    // Sense matrícula és la línia de la pòlissa mare (p. ex. BIFR0192): no és de cap vehicle.
    const matricula = normalitzaMatricula(valor("Datos adicionales"));
    if (!matricula) {
      ignorades++;
      continue;
    }
    if (!esMatriculaValida(matricula)) return { ok: false, error: "dades", fila: numFila, camp: "Datos adicionales" };

    const inici = llegeixDataRebut(valor("Inicio cobertura"));
    if (!inici) return { ok: false, error: "dades", fila: numFila, camp: "Inicio cobertura" };
    const fi = llegeixDataRebut(valor("Fin cobertura"));
    if (!fi) return { ok: false, error: "dades", fila: numFila, camp: "Fin cobertura" };
    const primaTotal = llegeixImportRebut(valor("Prima total"));
    if (primaTotal === null) return { ok: false, error: "dades", fila: numFila, camp: "Prima total" };
    const clase = text(valor("Clase")) ?? "";
    const tipus = classificaClase(clase);
    const polissa = text(valor("Póliza"));

    const linia: LiniaRebut = {
      num_rebut: num.slice(0, 50),
      polissa: polissa ? polissa.replace(/\.0+$/, "").slice(0, 50) : null,
      clase: clase.slice(0, 100),
      tipus,
      inici,
      fi,
      prima_total: primaTotal,
      prima_neta: llegeixImportRebut(valor("Prima Neta")),
      liquid: llegeixImportRebut(valor("Líquido")),
      situacio: text(valor("Situación"))?.slice(0, 100) ?? null,
      data_situacio: llegeixDataRebut(valor("Fecha situación")),
      matricula,
      prima_anual: tipus === "emissio" ? primaAnualDeRebut(primaTotal, inici, fi) : null,
    };
    if (tipus === "desconeguda") desconegudes.push(linia);
    else linies.push(linia);
  }

  // Un fitxer amb només la línia de la pòlissa mare és vàlid: 0 línies de vehicle.
  if (linies.length === 0 && desconegudes.length === 0 && ignorades === 0) return { ok: false, error: "buit" };
  return { ok: true, linies, ignorades, desconegudes };
}
