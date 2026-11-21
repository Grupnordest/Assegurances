import "server-only";
import { desDeEstoc, diferencies, uneixLlistes, type VehicleFlota } from "@/lib/flota/comunicacio";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Categoria = "immobilitzats" | "campers";
export const CATEGORIES: Categoria[] = ["immobilitzats", "campers"];

export type Llista = { categoria: Categoria; nom_fitxer: string; vehicles: VehicleFlota[]; updated_at: string };
export type Enviament = {
  id: string;
  origen: "inicial" | "eina";
  estat: "enviant" | "enviat" | "fallit";
  num_vehicles: number;
  altes: string[];
  baixes: string[];
  nom_fitxer: string | null;
  created_at: string;
  enviat_at: string | null;
  proves: boolean;
};

export type EstatFlota = {
  estoc: { data_estoc: string; num_vehicles: number } | null;
  llistes: Llista[];
  /** Llista que s'enviaria ara: Estoc vigent ∪ llistes addicionals. */
  actual: VehicleFlota[];
  /** Últim enviament confirmat (base de les altes i baixes). */
  ultim: (Enviament & { vehicles: VehicleFlota[] }) | null;
  altes: string[];
  baixes: string[];
  pendent: Enviament | null;
  historial: Enviament[];
};

const COLUMNES = "id, origen, estat, num_vehicles, altes, baixes, nom_fitxer, created_at, enviat_at, proves";

/** Llegeix tot el que cal per a la pantalla i per enviar. Llança si falla qualsevol consulta. */
export async function llegeixEstatFlota(supabase: Supabase): Promise<EstatFlota> {
  const [estocR, vehiclesR, llistesR, ultimR, historialR] = await Promise.all([
    supabase
      .from("estoc_carregues")
      .select("data_estoc, num_vehicles")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle<{ data_estoc: string; num_vehicles: number }>(),
    supabase
      .from("estoc_vigent")
      .select("matricula, marca, model")
      .range(0, 4999)
      .returns<{ matricula: string; marca: string | null; model: string | null }[]>(),
    supabase.from("flota_llistes").select("categoria, nom_fitxer, vehicles, updated_at").returns<Llista[]>(),
    supabase
      .from("flota_enviaments")
      .select(`${COLUMNES}, vehicles`)
      .eq("estat", "enviat")
      .eq("proves", false) // els enviaments de proves no són la base de les altes i baixes
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Enviament & { vehicles: VehicleFlota[] }>(),
    supabase
      .from("flota_enviaments")
      .select(COLUMNES)
      .order("created_at", { ascending: false })
      .limit(15)
      .returns<Enviament[]>(),
  ]);
  for (const r of [estocR, vehiclesR, llistesR, ultimR, historialR]) if (r.error) throw r.error;
  // Si l'API retalla files (max_rows), els vehicles que falten sortirien com a baixes: millor fallar.
  if (estocR.data && vehiclesR.data!.length !== estocR.data.num_vehicles) {
    throw new Error(`Estoc incomplet: ${vehiclesR.data!.length} de ${estocR.data.num_vehicles} vehicles`);
  }

  const llistes = CATEGORIES.map((c) => llistesR.data!.find((l) => l.categoria === c)).filter(
    (l): l is Llista => !!l,
  );
  const actual = estocR.data
    ? uneixLlistes(desDeEstoc(vehiclesR.data!), ...llistes.map((l) => l.vehicles))
    : [];
  const ultim = ultimR.data ?? null;
  const { altes, baixes } = ultim
    ? diferencies(
        ultim.vehicles.map((v) => v.matricula),
        actual.map((v) => v.matricula),
      )
    : { altes: [], baixes: [] };
  const historial = historialR.data!;

  return {
    estoc: estocR.data ?? null,
    llistes,
    actual,
    ultim,
    altes,
    baixes,
    pendent: historial.find((e) => e.estat === "enviant") ?? null,
    historial,
  };
}
