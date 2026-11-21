/**
 * "Comunicación de stock de matrículas" de la Pòlissa Flota VO (AXA, gestionada per Proassa).
 * Format de l'Excel que Proassa ja rep: Nº Póliza, Marca, Tipo, Matrícula. Funcions pures.
 */
import * as XLSX from "xlsx";
import { esMatriculaValida, normalitzaMatricula } from "../estoc/matricula";

export const POLISSA_FLOTA_VO = 6897837;

export type VehicleFlota = { matricula: string; marca: string | null; tipo: string };

export type ResultatLlista =
  | { ok: true; vehicles: VehicleFlota[] }
  | { ok: false; error: "illegible" | "sense-matricules" };

const MATRICULA = /^(\d{4}[A-Z]{3}|[A-Z]{1,2}\d{4}[A-Z]{1,2})$/;
const FURGONETES = /\b(kangoo|trafic|master|express|dokker|jumpy|partner|berlingo|vivaro|transit|expert|doblo|caddy|transporter|citan|vito|combo|rifter|nv200|nv300|primastar|townstar)\b/i;

const text = (v: unknown) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/** FURGONETA si el model és una furgoneta coneguda; si no, TURISMO. */
export function tipusDeModel(model: string | null): string {
  return model && FURGONETES.test(model) ? "FURGONETA" : "TURISMO";
}

/** Posició de la matrícula a la fila: 3 cel·les després del número de pòlissa; si no n'hi ha, la primera cel·la amb forma de matrícula. */
function posicioMatricula(fila: unknown[]): number {
  const p = fila.findIndex((c) => normalitzaMatricula(c) === String(POLISSA_FLOTA_VO));
  if (p >= 0 && esMatriculaValida(normalitzaMatricula(fila[p + 3]))) return p + 3;
  return fila.findIndex((c) => MATRICULA.test(normalitzaMatricula(c)));
}

/**
 * Llegeix un Excel en format Proassa (amb títol i capçalera o sense), només els fulls visibles.
 * Matrícula: la cel·la 3 posicions després de la pòlissa (accepta qualsevol format: plaques, ciclomotors…)
 * o, sense pòlissa, la primera cel·la amb forma de matrícula. Marca i Tipo: les dues cel·les d'abans.
 */
export function llegeixLlistaFlota(bytes: Uint8Array): ResultatLlista {
  let files: unknown[][];
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    const amagat = (i: number) => !!wb.Workbook?.Sheets?.[i]?.Hidden;
    files = wb.SheetNames.filter((_, i) => !amagat(i)).flatMap((n) =>
      XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: null }),
    );
  } catch {
    return { ok: false, error: "illegible" };
  }
  const vistes = new Map<string, VehicleFlota>();
  for (const fila of files) {
    const i = posicioMatricula(fila);
    if (i < 0) continue;
    const matricula = normalitzaMatricula(fila[i]);
    if (vistes.has(matricula)) continue;
    const tipo = i >= 1 ? text(fila[i - 1]) : null;
    const marca = i >= 2 ? text(fila[i - 2]) : null;
    vistes.set(matricula, {
      matricula,
      marca: marca && !/^\d+$/.test(marca) ? marca.toUpperCase() : null,
      tipo: tipo && !/^\d+$/.test(tipo) ? tipo.toUpperCase() : "TURISMO",
    });
  }
  if (vistes.size === 0) return { ok: false, error: "sense-matricules" };
  return { ok: true, vehicles: [...vistes.values()] };
}

/** Vehicles de l'Estoc en format Flota VO. */
export function desDeEstoc(estoc: { matricula: string; marca: string | null; model: string | null }[]): VehicleFlota[] {
  return estoc.map((v) => ({
    matricula: v.matricula,
    marca: text(v.marca)?.toUpperCase() ?? null,
    tipo: tipusDeModel(v.model),
  }));
}

/** Uneix llistes sense repetir matrícules; mana la primera on surt (l'Estoc primer). Ordenat per matrícula. */
export function uneixLlistes(...llistes: VehicleFlota[][]): VehicleFlota[] {
  const m = new Map<string, VehicleFlota>();
  for (const l of llistes) for (const v of l) if (!m.has(v.matricula)) m.set(v.matricula, v);
  return [...m.values()].sort((a, b) => a.matricula.localeCompare(b.matricula));
}

/** Altes = a l'actual i no a l'anterior; baixes = a l'anterior i no a l'actual. Ordenades. */
export function diferencies(anterior: string[], actual: string[]): { altes: string[]; baixes: string[] } {
  const a = new Set(anterior);
  const b = new Set(actual);
  return {
    altes: [...b].filter((m) => !a.has(m)).sort(),
    baixes: [...a].filter((m) => !b.has(m)).sort(),
  };
}

/** Excel per a Proassa, amb el mateix títol i capçalera que l'actual. */
export function generaExcel(vehicles: VehicleFlota[]): Uint8Array {
  const files = [
    ["COMUNICACION DE STOCK DE MATRICULAS PARA POLIZAS DE VEHICULOS DE OCASION"],
    ["Nº Poliza", "Marca", "Tipo", "Matricula Vehiculo"],
    ...vehicles.map((v) => [POLISSA_FLOTA_VO, v.marca ?? "", v.tipo, v.matricula]),
  ];
  const full = XLSX.utils.aoa_to_sheet(files);
  full["!cols"] = [{ wch: 13 }, { wch: 22 }, { wch: 12 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, full, "Hoja1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
