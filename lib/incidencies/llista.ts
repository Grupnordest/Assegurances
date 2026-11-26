import type { SupabaseClient } from "@supabase/supabase-js";

/** Incidències (PRD FR-17): situacions que l'eina no resol sola, derivades de l'estat de les taules. */
export type TipusIncidencia =
  | "avis_sense_resposta"
  | "baixa_pendent_polissa"
  | "baixa_fallida"
  | "alta_incerta"
  | "flota_fallida"
  | "sense_motiu";

export type Incidencia = {
  tipus: TipusIncidencia;
  vehicle?: string;
  matricula?: string;
  /** Instant ISO a partir del qual la situació està oberta (per ordenar per antiguitat). */
  data: string;
  descripcio: string;
  enllac?: string;
  avisId?: string;
  tipusAvis?: string;
};

export const NOM_TIPUS: Record<TipusIncidencia, string> = {
  avis_sense_resposta: "Avís sense resposta",
  baixa_pendent_polissa: "Baixa pendent de pòlissa",
  baixa_fallida: "Baixa fallida o incerta",
  alta_incerta: "Alta amb enviament incert",
  flota_fallida: "Enviament a Proassa fallit",
  sense_motiu: "Vehicle sense Motiu",
};

/** Un enviament en curs més antic que això es considera incert. */
export const MINUTS_INCERT = 15;

const VEHICLES = "/admin/vehicles?veure=tots";

export type Fonts = {
  avisos: {
    id: string;
    tipus: string;
    enviat_at: string;
    escalat_at: string | null;
    vehicle_id: string;
    matricula: string;
    estat_vehicle: string;
  }[];
  /** Totes les baixes (per saber quina és la darrera de cada vehicle). */
  baixes: {
    vehicle_id: string;
    estat: string;
    created_at: string;
    updated_at: string;
    matricula: string;
    estat_vehicle: string;
  }[];
  altesEnviant: { id: string; matricula: string; updated_at: string }[];
  darrerFlota: { estat: string; created_at: string } | null;
  senseMotiu: { id: string; matricula: string; data_alta: string | null; created_at: string }[];
};

/** Construeix la llista a partir de les fonts. Pura: es pot provar sense base de dades. */
export function construeixIncidencies(f: Fonts, ara: Date = new Date()): Incidencia[] {
  const llindar = ara.getTime() - MINUTS_INCERT * 60_000;
  const antic = (iso: string) => new Date(iso).getTime() < llindar;
  const r: Incidencia[] = [];

  // Un avís en excepció deixa de ser obert si el vehicle ja no està assegurat o té una baixa en curs;
  // si el vehicle en té més d'un, només es mostra el més recent.
  const baixaEnCurs = new Set(
    f.baixes.filter((b) => ["pendent_polissa", "enviant", "enviada", "anullant"].includes(b.estat)).map((b) => b.vehicle_id),
  );
  const avisPerVehicle = new Map<string, Fonts["avisos"][number]>();
  for (const a of f.avisos) {
    if (a.estat_vehicle !== "assegurat" || baixaEnCurs.has(a.vehicle_id)) continue;
    const prev = avisPerVehicle.get(a.vehicle_id);
    if (!prev || a.enviat_at > prev.enviat_at) avisPerVehicle.set(a.vehicle_id, a);
  }
  for (const a of avisPerVehicle.values()) {
    r.push({
      tipus: "avis_sense_resposta",
      vehicle: a.vehicle_id,
      matricula: a.matricula,
      data: a.escalat_at ?? a.enviat_at,
      descripcio: "Ningú ha respost l'avís, ni el Responsable ni l'escalat.",
      avisId: a.id,
      tipusAvis: a.tipus,
    });
  }

  // Només compta la darrera baixa de cada vehicle: si se n'ha fet una altra després, la fallida ja no és oberta.
  const darrera = new Map<string, Fonts["baixes"][number]>();
  for (const b of f.baixes) {
    const prev = darrera.get(b.vehicle_id);
    if (!prev || b.created_at > prev.created_at) darrera.set(b.vehicle_id, b);
  }
  for (const b of darrera.values()) {
    if (b.estat === "pendent_polissa") {
      r.push({
        tipus: "baixa_pendent_polissa",
        vehicle: b.vehicle_id,
        matricula: b.matricula,
        data: b.created_at,
        descripcio: "Baixa demanada però el vehicle no té la pòlissa desada. Puja-la per enviar-la.",
        enllac: VEHICLES,
      });
    } else if ((b.estat === "fallida" && b.estat_vehicle === "assegurat") || (b.estat === "enviant" && antic(b.updated_at))) {
      r.push({
        tipus: "baixa_fallida",
        vehicle: b.vehicle_id,
        matricula: b.matricula,
        data: b.updated_at,
        descripcio:
          b.estat === "fallida"
            ? "L'enviament de la baixa a la corredoria ha fallat."
            : "No se sap si la baixa ha arribat a la corredoria.",
        enllac: VEHICLES,
      });
    }
  }

  for (const v of f.altesEnviant) {
    if (!antic(v.updated_at)) continue;
    r.push({
      tipus: "alta_incerta",
      vehicle: v.id,
      matricula: v.matricula,
      data: v.updated_at,
      descripcio: "No se sap si l'alta ha arribat a la corredoria.",
      enllac: "/validar",
    });
  }

  const fl = f.darrerFlota;
  if (fl && (fl.estat === "fallit" || (fl.estat === "enviant" && antic(fl.created_at)))) {
    r.push({
      tipus: "flota_fallida",
      data: fl.created_at,
      descripcio: fl.estat === "fallit" ? "El darrer enviament de l'estoc a Proassa ha fallat." : "No se sap si el darrer enviament a Proassa ha sortit.",
      enllac: "/admin/flota",
    });
  }

  for (const v of f.senseMotiu) {
    r.push({
      tipus: "sense_motiu",
      vehicle: v.id,
      matricula: v.matricula,
      data: v.data_alta ? `${v.data_alta}T00:00:00Z` : v.created_at,
      descripcio: "Vehicle assegurat sense Motiu: no rebrà avisos.",
      enllac: VEHICLES,
    });
  }

  return r.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
}

/** Llegeix les fonts amb el client donat (Administració amb sessió, o la clau de servei). */
export async function llegeixFonts(client: SupabaseClient): Promise<Fonts> {
  const [avisos, baixes, altes, flota, senseMotiu] = await Promise.all([
    client
      .from("avisos")
      .select("id, tipus, enviat_at, escalat_at, vehicle_id, vehicles_assegurats!inner(matricula, estat)")
      .eq("estat", "excepcio")
      .returns<{ id: string; tipus: string; enviat_at: string; escalat_at: string | null; vehicle_id: string; vehicles_assegurats: { matricula: string; estat: string } }[]>(),
    client
      .from("baixes")
      .select("vehicle_id, estat, created_at, updated_at, vehicles_assegurats!inner(matricula, estat)")
      .returns<{ vehicle_id: string; estat: string; created_at: string; updated_at: string; vehicles_assegurats: { matricula: string; estat: string } }[]>(),
    client
      .from("vehicles_assegurats")
      .select("id, matricula, updated_at")
      .eq("enviament_alta", "enviant")
      .returns<Fonts["altesEnviant"]>(),
    client
      .from("flota_enviaments")
      .select("estat, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<{ estat: string; created_at: string }[]>(),
    client
      .from("vehicles_assegurats")
      .select("id, matricula, data_alta, created_at")
      .eq("estat", "assegurat")
      .is("motiu", null)
      .returns<Fonts["senseMotiu"]>(),
  ]);
  for (const q of [avisos, baixes, altes, flota, senseMotiu]) if (q.error) throw q.error;
  return {
    avisos: avisos.data!.map(({ vehicles_assegurats: v, ...a }) => ({ ...a, matricula: v.matricula, estat_vehicle: v.estat })),
    baixes: baixes.data!.map((b) => ({
      vehicle_id: b.vehicle_id,
      estat: b.estat,
      created_at: b.created_at,
      updated_at: b.updated_at,
      matricula: b.vehicles_assegurats.matricula,
      estat_vehicle: b.vehicles_assegurats.estat,
    })),
    altesEnviant: altes.data!,
    darrerFlota: flota.data![0] ?? null,
    senseMotiu: senseMotiu.data!,
  };
}

export async function llistaIncidencies(client: SupabaseClient, ara: Date = new Date()): Promise<Incidencia[]> {
  return construeixIncidencies(await llegeixFonts(client), ara);
}

export async function compta(client: SupabaseClient): Promise<number> {
  return (await llistaIncidencies(client)).length;
}
