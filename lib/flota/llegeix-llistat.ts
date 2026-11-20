import * as XLSX from "xlsx";
import { esMatriculaValida, normalitzaMatricula } from "../estoc/matricula";

export type CoberturaVehicle = "tot_risc" | "tercers";

export type VehicleLlistat = {
  matricula: string;
  polissa: string | null;
  /** "assegurat" si la Corredoria ja l'ha emès (té prima); "enviat" si és una alta afegida a mà. */
  estat: "assegurat" | "enviat";
  cobertura: CoberturaVehicle;
  franquicia: number | null;
  /** "YYYY-MM-DD" */
  data_alta: string | null;
  data_venciment: string | null;
  prima_neta: number | null;
  prima_total: number | null;
  marca_model: string | null;
  nota: string | null;
};

export type FilaDescartada = { fila: number; text: string; motiu: "matricula" | "repetida" };

export type ResultatLlistat =
  | { ok: true; vehicles: VehicleLlistat[]; descartades: FilaDescartada[] }
  | { ok: false; error: "illegible" }
  | { ok: false; error: "sense-capcaleres" }
  | { ok: false; error: "massa-files"; maxim: number }
  | { ok: false; error: "format"; falten: string[] }
  | { ok: false; error: "buit" };

/** Capçaleres obligatòries del Llistat de flota de la Corredoria ("Datos de la Flota"). */
export const CAPCALERES_FLOTA = [
  "Póliza",
  "Matrícula/Bastidor",
  "Prima neta",
  "Prima total",
  "Fecha de efecto",
  "Fecha de vencimiento",
  "Grupo de tarifa",
  "Marca - modelo - versión",
] as const;
type Capcalera = (typeof CAPCALERES_FLOTA)[number];

const MAX_FILES = 5_000;
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

/** Import en format espanyol ("1.031,45 €") o número. Qualsevol altra cosa → null. */
export function llegeixImport(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
  const s = String(v ?? "")
    .replace(/€/g, "")
    .replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  return Number(s.replace(/\./g, "").replace(",", "."));
}

const dues = (n: number) => String(n).padStart(2, "0");
function dataValida(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Primera data dd/mm/aaaa dins el text (també "ALTA 12/11/2026"), o data d'Excel. */
export function llegeixData(v: unknown): string | null {
  if (typeof v === "number" && v > 30000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    return p && dataValida(p.y, p.m, p.d) ? `${p.y}-${dues(p.m)}-${dues(p.d)}` : null;
  }
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v ?? ""));
  if (!m) return null;
  const [d, mes, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return dataValida(y, mes, d) ? `${y}-${dues(mes)}-${dues(d)}` : null;
}

/**
 * Separa matrícula i nota d'una cel·la com "0245 NSZ  SUSAN SABATÉ" o "7404NTT- MITA SABATÉ".
 * Accepta matrícules actuals (0000 AAA) i antigues provincials (B 5865 GW).
 */
export function separaMatricula(v: unknown): { matricula: string; nota: string | null } {
  const s = String(v ?? "").trim();
  const actual = /^(\d{4})[\s-]*([A-Za-z]{3})(?![A-Za-z0-9])(.*)$/.exec(s);
  const antiga = /^([A-Za-z]{1,2})[\s-]*(\d{4})[\s-]*([A-Za-z]{1,2})(?![A-Za-z0-9])(.*)$/.exec(s);
  let matricula: string;
  let resta: string;
  if (actual) {
    matricula = normalitzaMatricula(actual[1] + actual[2]);
    resta = actual[3];
  } else if (antiga) {
    matricula = normalitzaMatricula(antiga[1] + antiga[2] + antiga[3]);
    resta = antiga[4];
  } else {
    // Sense format de matrícula reconegut (p. ex. "TOTAL", un bastidor o "0245NSZ2"): no és una matrícula.
    matricula = "";
    resta = s;
  }
  const nota = resta.replace(/^[\s\-–—:·,]+/, "").replace(/\s+/g, " ").trim();
  return { matricula, nota: nota.length ? nota : null };
}

/** Cobertura i franquícia a partir del grup de tarifa (o del text escrit a mà). Sense text → Tot risc. */
export function llegeixCobertura(v: unknown): { cobertura: CoberturaVehicle; franquicia: number | null } {
  const s = String(v ?? "").toUpperCase();
  const totRisc = !s.trim() || /\bDP|DA[ÑN]OS PROPIOS|TOT RISC|TODO RIESGO/.test(s);
  const fq = /(?:FRQ|FQ)\s*(\d{2,5})/.exec(s);
  return { cobertura: totRisc ? "tot_risc" : "tercers", franquicia: totRisc && fq ? Number(fq[1]) : null };
}

/** Llegeix el Llistat de flota de la Corredoria (PRD FR-21). Funció pura. */
export function llegeixLlistatFlota(fitxer: ArrayBuffer | Uint8Array): ResultatLlistat {
  let files: unknown[][];
  try {
    const llibre = XLSX.read(fitxer, { type: "array", cellDates: false, dense: true, sheetRows: MAX_FILES });
    const full = llibre.Sheets[llibre.SheetNames[0]];
    if (!full) return { ok: false, error: "illegible" };
    // Amb sheetRows, "!fullref" conserva el rang real: si n'hi ha més, no es talla en silenci.
    const rang = full["!fullref"] ?? full["!ref"];
    if (rang && XLSX.utils.decode_range(rang).e.r + 1 > MAX_FILES) {
      return { ok: false, error: "massa-files", maxim: MAX_FILES };
    }
    files = XLSX.utils.sheet_to_json<unknown[]>(full, { header: 1, raw: true, defval: null, blankrows: true });
  } catch {
    return { ok: false, error: "illegible" };
  }

  const filaCap = files
    .slice(0, FILES_CAPCALERA)
    .findIndex((f) => f.some((c) => clau(c) === clau("Matrícula/Bastidor")));
  if (filaCap < 0) return { ok: false, error: "sense-capcaleres" };

  const capcaleres = files[filaCap].map(clau);
  const index = {} as Record<Capcalera, number>;
  const falten: string[] = [];
  for (const c of CAPCALERES_FLOTA) {
    const i = capcaleres.indexOf(clau(c));
    if (i < 0) falten.push(c);
    else index[c] = i;
  }
  if (falten.length) return { ok: false, error: "format", falten };
  // Opcional: "Estado" informat vol dir pòlissa emesa.
  const iEstat = capcaleres.indexOf(clau("Estado"));

  const vehicles: VehicleLlistat[] = [];
  const descartades: FilaDescartada[] = [];
  const vistes = new Set<string>();

  files.slice(filaCap + 1).forEach((fila, i) => {
    const valor = (c: Capcalera) => fila[index[c]];
    const cel = text(valor("Matrícula/Bastidor"));
    if (!cel && !text(valor("Póliza"))) return; // línia en blanc
    const numFila = filaCap + 2 + i; // número de fila d'Excel (1 = primera)

    const { matricula, nota: notaMatricula } = separaMatricula(cel);
    if (!esMatriculaValida(matricula)) {
      descartades.push({ fila: numFila, text: cel ?? "", motiu: "matricula" });
      return;
    }
    if (vistes.has(matricula)) {
      descartades.push({ fila: numFila, text: cel ?? "", motiu: "repetida" });
      return;
    }
    vistes.add(matricula);

    const primaNeta = llegeixImport(valor("Prima neta"));
    const primaTotal = llegeixImport(valor("Prima total"));
    // A les altes afegides a mà, la columna de prima pot portar text ("2-3 SETMANES"): és una nota.
    const notesExtra = [valor("Prima neta"), valor("Prima total")]
      .filter((v) => text(v) && llegeixImport(v) === null)
      .map((v) => text(v)!);
    const nota = [notaMatricula, ...notesExtra].filter(Boolean).join(" · ");
    const { cobertura, franquicia } = llegeixCobertura(valor("Grupo de tarifa"));
    const polissa = text(valor("Póliza"));

    vehicles.push({
      matricula,
      polissa: polissa ? polissa.replace(/\.0+$/, "") : null,
      // Emesa si la Corredoria la marca com a tal (Estado) o si ja té prima; si no, és una alta afegida a mà.
      estat: (iEstat >= 0 && text(fila[iEstat]) !== null) || primaTotal !== null ? "assegurat" : "enviat",
      cobertura,
      franquicia,
      data_alta: llegeixData(valor("Fecha de efecto")),
      data_venciment: llegeixData(valor("Fecha de vencimiento")),
      prima_neta: primaNeta,
      prima_total: primaTotal,
      marca_model: text(valor("Marca - modelo - versión")),
      nota: nota.length ? nota : null,
    });
  });

  if (vehicles.length === 0) return { ok: false, error: "buit" };
  return { ok: true, vehicles, descartades };
}
