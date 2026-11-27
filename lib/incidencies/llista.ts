import type { SupabaseClient } from "@supabase/supabase-js";
import { sumaDies } from "../avisos/regles";
import { avuiMadrid } from "../dies-laborables";

/** Incidències (PRD FR-17): situacions que l'eina no resol sola, derivades de l'estat de les taules. */
export type TipusIncidencia =
  | "avis_sense_resposta"
  | "baixa_pendent_polissa"
  | "baixa_fallida"
  | "alta_incerta"
  | "flota_fallida"
  | "sense_motiu"
  | "extorn_pendent"
  | "extorn_incorrecte"
  | "extorn_no_identificat"
  | "rebut_sense_vehicle"
  | "cartera_sense_control"
  | "cartera_absent"
  | "cartera_no_quadra"
  | "cartera_extorn_pendent";

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
  /** Baixa afectada (extorn pendent o incorrecte). */
  baixaId?: string;
  /** Instant de la darrera reclamació (extorn pendent). */
  reclamadaAt?: string | null;
  /** Extorn pendent que es pot incloure ara a la reclamació. */
  perReclamar?: boolean;
  /** Línia de rebut sense casar (es pot descartar amb un comentari). */
  rebutId?: string;
  /** Línia del Rebut de cartera (es pot descartar; si és sense control, també crear el vehicle). */
  carteraLiniaId?: string;
};

export const NOM_TIPUS: Record<TipusIncidencia, string> = {
  avis_sense_resposta: "Avís sense resposta",
  baixa_pendent_polissa: "Baixa pendent de pòlissa",
  baixa_fallida: "Baixa fallida o incerta",
  alta_incerta: "Alta amb enviament incert",
  flota_fallida: "Enviament a Proassa fallit",
  sense_motiu: "Vehicle sense Motiu",
  extorn_pendent: "Extorn pendent",
  extorn_incorrecte: "Extorn incorrecte",
  extorn_no_identificat: "Extorn no identificat",
  rebut_sense_vehicle: "Rebut sense vehicle",
  cartera_sense_control: "Assegurat sense control",
  cartera_absent: "No és al rebut de cartera",
  cartera_no_quadra: "Rebut de cartera no quadra",
  cartera_extorn_pendent: "Extorn de cartera pendent",
};

/** Dies després de la data de baixa a partir dels quals un extorn no liquidat és pendent (FR-25). */
export const DIES_EXTORN_PENDENT = 60;
/** Una baixa reclamada fa menys d'això no es torna a incloure a la reclamació. */
export const DIES_ENTRE_RECLAMACIONS = 15;

const eur = new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" });
const dataCurta = (d: string) => d.split("-").reverse().join("/");

type BaixaExtorn = {
  estat: string;
  data_baixa: string;
  extorn_liquidat: number | null;
  liquidada_at: string | null;
};

/** Baixa enviada sense cap extorn liquidat 60 dies (o més) després de la data de baixa. */
export function esExtornPendent(b: BaixaExtorn, ara: Date = new Date()): boolean {
  return (
    b.estat === "enviada" &&
    b.liquidada_at === null &&
    b.extorn_liquidat === null &&
    avuiMadrid(ara) >= sumaDies(b.data_baixa, DIES_EXTORN_PENDENT)
  );
}

/** Extorn pendent que es pot incloure a la reclamació (no reclamat els darrers 15 dies). */
export function esPerReclamar(b: BaixaExtorn & { reclamada_at: string | null }, ara: Date = new Date()): boolean {
  if (!esExtornPendent(b, ara)) return false;
  return b.reclamada_at === null || new Date(b.reclamada_at).getTime() <= ara.getTime() - DIES_ENTRE_RECLAMACIONS * 86_400_000;
}

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
    id: string;
    vehicle_id: string;
    estat: string;
    data_baixa: string;
    extorn_esperat: number | null;
    extorn_liquidat: number | null;
    liquidada_at: string | null;
    reclamada_at: string | null;
    created_at: string;
    updated_at: string;
    matricula: string;
    estat_vehicle: string;
  }[];
  /** Línies de rebut sense casar: emissions sense vehicle i extorns sense baixa. */
  rebuts: {
    id: string;
    num_rebut: string;
    tipus: string;
    matricula: string;
    prima_total: number;
    inici: string;
    created_at: string;
    vehicle_id: string | null;
    baixa_id: string | null;
  }[];
  altesEnviant: { id: string; matricula: string; updated_at: string }[];
  darrerFlota: { estat: string; created_at: string } | null;
  senseMotiu: { id: string; matricula: string; data_alta: string | null; created_at: string }[];
  /** Rebut de cartera (FR-22). Opcional: sense conciliacions no hi ha res a mostrar. */
  cartera?: {
    /** Línies que no són 'ok'. */
    linies: {
      id: string;
      tipus: string;
      num_rebut: string | null;
      matricula: string;
      prima_total: number | null;
      extorn_esperat: number | null;
      extorn_rebut_id: string | null;
      liquidat_at: string | null;
      descartat_at: string | null;
      vehicle_id: string | null;
      /** Inici del període ("YYYY-MM-DD"). */
      inici: string;
      created_at: string;
    }[];
    /** Conciliació més recent (la del darrer període). */
    darrera: { inici: string; prima_mare: number | null; suma_linies: number; quadra: boolean; created_at: string } | null;
  };
};

type LiniaCartera = NonNullable<Fonts["cartera"]>["linies"][number];

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

  for (const b of f.baixes) {
    if (b.estat !== "enviada" || b.liquidada_at !== null) continue;
    if (b.extorn_liquidat !== null) {
      r.push({
        tipus: "extorn_incorrecte",
        vehicle: b.vehicle_id,
        matricula: b.matricula,
        data: b.updated_at,
        descripcio: `Baixa del ${dataCurta(b.data_baixa)}: extorn esperat ${
          b.extorn_esperat === null ? "pendent de prima" : eur.format(b.extorn_esperat)
        }, liquidat ${eur.format(b.extorn_liquidat)}. La diferència és de més d'1 €.`,
        baixaId: b.id,
      });
    } else if (esExtornPendent(b, ara)) {
      r.push({
        tipus: "extorn_pendent",
        vehicle: b.vehicle_id,
        matricula: b.matricula,
        data: `${sumaDies(b.data_baixa, DIES_EXTORN_PENDENT)}T00:00:00Z`,
        descripcio: `Baixa del ${dataCurta(b.data_baixa)} sense extorn liquidat després de ${DIES_EXTORN_PENDENT} dies (esperat: ${
          b.extorn_esperat === null ? "pendent de prima" : eur.format(b.extorn_esperat)
        }).${b.reclamada_at ? ` Reclamat el ${dataCurta(avuiMadrid(new Date(b.reclamada_at)))}.` : ""}`,
        baixaId: b.id,
        reclamadaAt: b.reclamada_at,
        perReclamar: esPerReclamar(b, ara),
      });
    }
  }

  for (const x of f.rebuts) {
    if (x.tipus === "extorn" && x.baixa_id === null) {
      r.push({
        tipus: "extorn_no_identificat",
        vehicle: x.vehicle_id ?? undefined,
        matricula: x.matricula,
        data: x.created_at,
        rebutId: x.id,
        descripcio: `Rebut ${x.num_rebut}: extorn de ${eur.format(Math.abs(x.prima_total))} amb data ${dataCurta(x.inici)} sense cap baixa enviada pendent de liquidar.`,
        enllac: "/admin/rebuts",
      });
    } else if (x.tipus === "emissio" && x.vehicle_id === null) {
      r.push({
        tipus: "rebut_sense_vehicle",
        matricula: x.matricula,
        data: x.created_at,
        rebutId: x.id,
        descripcio: `Rebut ${x.num_rebut} de ${eur.format(x.prima_total)} amb data ${dataCurta(x.inici)}: la matrícula no és a cap vehicle de l'eina.`,
        enllac: "/admin/rebuts",
      });
    }
  }

  const c = f.cartera;
  if (c?.darrera && !c.darrera.quadra) {
    const d = c.darrera;
    r.push({
      tipus: "cartera_no_quadra",
      data: d.created_at,
      descripcio: `Rebut de cartera del ${dataCurta(d.inici)}: la suma de les línies (${eur.format(d.suma_linies)}) no quadra amb la pòlissa mare (${
        d.prima_mare === null ? "no hi és" : eur.format(d.prima_mare)
      }).`,
      enllac: "/admin/rebuts",
    });
  }
  for (const l of c?.linies ?? []) {
    if (l.descartat_at !== null || l.liquidat_at !== null) continue;
    const base = { vehicle: l.vehicle_id ?? undefined, matricula: l.matricula, carteraLiniaId: l.id };
    if (l.tipus === "sense_control") {
      r.push({
        ...base,
        tipus: "cartera_sense_control",
        data: l.created_at,
        descripcio: `Rebut de cartera del ${dataCurta(l.inici)} (rebut ${l.num_rebut ?? "—"}, ${
          l.prima_total === null ? "sense prima" : eur.format(l.prima_total)
        }): la matrícula no té cap vehicle obert a l'eina.`,
      });
    } else if (l.tipus === "absent") {
      r.push({
        ...base,
        tipus: "cartera_absent",
        data: l.created_at,
        descripcio: `Vehicle assegurat que no surt al Rebut de cartera del ${dataCurta(l.inici)}.`,
        enllac: VEHICLES,
      });
    } else if (l.tipus === "cobrat_despres_baixa") {
      const esperat = l.extorn_esperat === null ? "pendent de prima" : eur.format(l.extorn_esperat);
      // Cobrat el mateix dia de la baixa (sense extorn esperat propi): excepció visible de seguida, sense reclamar.
      if (l.extorn_esperat === null && l.extorn_rebut_id === null) {
        r.push({
          ...base,
          tipus: "cartera_extorn_pendent",
          data: l.created_at,
          descripcio: `Cobrat al Rebut de cartera del ${dataCurta(l.inici)} el mateix dia de la baixa; l'extorn es controla a la baixa.`,
        });
        continue;
      }
      // Extorn rebut que no quadra: es mostra de seguida. Si no n'ha arribat cap, passats 60 dies de l'inici del període (el cobrament).
      if (l.extorn_rebut_id !== null) {
        r.push({
          ...base,
          tipus: "cartera_extorn_pendent",
          data: l.created_at,
          descripcio: `Cobrat al Rebut de cartera del ${dataCurta(l.inici)} després de la baixa: l'extorn rebut no quadra amb l'esperat (${esperat}).`,
        });
      } else if (avuiMadrid(ara) >= sumaDies(l.inici, DIES_EXTORN_PENDENT)) {
        r.push({
          ...base,
          tipus: "cartera_extorn_pendent",
          data: `${sumaDies(l.inici, DIES_EXTORN_PENDENT)}T00:00:00Z`,
          descripcio: `Cobrat al Rebut de cartera del ${dataCurta(l.inici)} després de la baixa i sense extorn després de ${DIES_EXTORN_PENDENT} dies (esperat: ${esperat}).`,
        });
      }
    }
  }

  return r.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
}

type FilaLiniaCartera = Omit<LiniaCartera, "inici" | "prima_total" | "extorn_esperat"> & {
  prima_total: number | string | null;
  extorn_esperat: number | string | null;
  cartera_conciliacions: { inici: string };
};

/** Línies de cartera obertes (no 'ok', ni descartades ni liquidades), per pàgines per no topar amb el límit de l'API. */
async function liniesCarteraObertes(client: SupabaseClient): Promise<FilaLiniaCartera[]> {
  const PAGINA = 1000;
  const totes: FilaLiniaCartera[] = [];
  for (let des = 0; ; des += PAGINA) {
    const { data, error } = await client
      .from("cartera_linies")
      .select(
        "id, tipus, num_rebut, matricula, prima_total, extorn_esperat, extorn_rebut_id, liquidat_at, descartat_at, vehicle_id, created_at, cartera_conciliacions!inner(inici)",
      )
      .neq("tipus", "ok")
      .is("descartat_at", null)
      .is("liquidat_at", null)
      .order("id")
      .range(des, des + PAGINA - 1)
      .returns<FilaLiniaCartera[]>();
    if (error) throw error;
    totes.push(...data);
    if (data.length < PAGINA) return totes;
  }
}

/** Llegeix les fonts amb el client donat (Administració amb sessió, o la clau de servei). */
export async function llegeixFonts(client: SupabaseClient): Promise<Fonts> {
  const [avisos, baixes, altes, flota, senseMotiu, rebuts, carteraLinies, carteraDarrera] = await Promise.all([
    client
      .from("avisos")
      .select("id, tipus, enviat_at, escalat_at, vehicle_id, vehicles_assegurats!inner(matricula, estat)")
      .eq("estat", "excepcio")
      .returns<{ id: string; tipus: string; enviat_at: string; escalat_at: string | null; vehicle_id: string; vehicles_assegurats: { matricula: string; estat: string } }[]>(),
    client
      .from("baixes")
      .select(
        "id, vehicle_id, estat, data_baixa, extorn_esperat, extorn_liquidat, liquidada_at, reclamada_at, created_at, updated_at, vehicles_assegurats!inner(matricula, estat)",
      )
      // No cal tot l'historial: les liquidades ja estan tancades. Les fallides i anul·lades sí que hi són
      // (per saber quina és la darrera baixa de cada vehicle).
      .is("liquidada_at", null)
      .returns<
        (Omit<Fonts["baixes"][number], "matricula" | "estat_vehicle" | "extorn_esperat" | "extorn_liquidat"> & {
          extorn_esperat: number | string | null;
          extorn_liquidat: number | string | null;
          vehicles_assegurats: { matricula: string; estat: string };
        })[]
      >(),
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
    client
      .from("rebuts")
      .select("id, num_rebut, tipus, matricula, prima_total, inici, created_at, vehicle_id, baixa_id")
      .is("baixa_id", null)
      .is("descartat_at", null)
      // Els extorns enllaçats a una línia de cartera no són "no identificats" encara que no tinguin baixa.
      .is("cartera_linia_id", null)
      .or("vehicle_id.is.null,tipus.eq.extorn")
      .returns<(Omit<Fonts["rebuts"][number], "prima_total"> & { prima_total: number | string })[]>(),
    liniesCarteraObertes(client),
    client
      .from("cartera_conciliacions")
      .select("inici, prima_mare, suma_linies, quadra, created_at")
      .order("inici", { ascending: false })
      .limit(1)
      .returns<{ inici: string; prima_mare: number | string | null; suma_linies: number | string; quadra: boolean; created_at: string }[]>(),
  ]);
  for (const q of [avisos, baixes, altes, flota, senseMotiu, rebuts, carteraDarrera]) if (q.error) throw q.error;
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  const darrera = carteraDarrera.data![0];
  return {
    avisos: avisos.data!.map(({ vehicles_assegurats: v, ...a }) => ({ ...a, matricula: v.matricula, estat_vehicle: v.estat })),
    baixes: baixes.data!.map(({ vehicles_assegurats: v, ...b }) => ({
      ...b,
      extorn_esperat: num(b.extorn_esperat),
      extorn_liquidat: num(b.extorn_liquidat),
      matricula: v.matricula,
      estat_vehicle: v.estat,
    })),
    rebuts: rebuts.data!.map((x) => ({ ...x, prima_total: Number(x.prima_total) })),
    altesEnviant: altes.data!,
    darrerFlota: flota.data![0] ?? null,
    senseMotiu: senseMotiu.data!,
    cartera: {
      linies: carteraLinies.map(({ cartera_conciliacions: c, ...l }) => ({
        ...l,
        prima_total: num(l.prima_total),
        extorn_esperat: num(l.extorn_esperat),
        inici: c.inici,
      })),
      darrera: darrera ? { ...darrera, prima_mare: num(darrera.prima_mare), suma_linies: Number(darrera.suma_linies) } : null,
    },
  };
}

export async function llistaIncidencies(client: SupabaseClient, ara: Date = new Date()): Promise<Incidencia[]> {
  return construeixIncidencies(await llegeixFonts(client), ara);
}

export async function compta(client: SupabaseClient): Promise<number> {
  return (await llistaIncidencies(client)).length;
}
