"use server";

import { revalidatePath } from "next/cache";
import { destinatarisProassa } from "@/lib/correu/config";
import { configCorreu, enviaCorreu, ErrorCorreu } from "@/lib/correu/graph";
import { correuEstocProassa } from "@/lib/correu/plantilles";
import { generaExcel, llegeixLlistaFlota, type ResultatLlista } from "@/lib/flota/comunicacio";
import { MIME } from "@/lib/pdf";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";
import { CATEGORIES, llegeixEstatFlota, type Categoria } from "./dades";

export type EstatAccio = { error?: string; ok?: string };

const e = t.flota.errors;
const MIDA = 2.5 * 1024 * 1024;
const RUTA = "/admin/flota";

/** Llegeix l'Excel del formulari en format Proassa. */
async function llistaDelFormulari(valor: FormDataEntryValue | null): Promise<ResultatLlista | string> {
  if (!(valor instanceof File) || valor.size === 0) return e.senseFitxer;
  if (valor.size > MIDA) return e.mida;
  if (!/\.xlsx?$/i.test(valor.name)) return e.tipus;
  return llegeixLlistaFlota(new Uint8Array(await valor.arrayBuffer()));
}

const errorLectura = (r: Extract<ResultatLlista, { ok: false }>) =>
  r.error === "sense-matricules" ? e.senseMatricules : e.illegible;

function missatgeBd(err: { code?: string; message?: string }): string {
  const m = err.message ?? "";
  if (err.code === "42501") return e.permis;
  if (m.includes("ja_inicial")) return e.jaInicial;
  if (m.includes("pendent_confirmar") || err.code === "23505") return e.pendentConfirmar;
  if (m.includes("base_canviada")) return e.canviat;
  if (m.includes("ja_resolt")) return e.jaResolt;
  return e.generic;
}

/** Puja o substitueix una llista addicional (immobilitzats o campers). */
export async function pujaLlista(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };
  const categoria = formData.get("categoria") as Categoria;
  if (!CATEGORIES.includes(categoria)) return { error: e.generic };

  const fitxer = formData.get("fitxer");
  const r = await llistaDelFormulari(fitxer);
  if (typeof r === "string") return { error: r };
  if (!r.ok) return { error: errorLectura(r) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("desa_llista_flota", {
      p_categoria: categoria,
      p_nom_fitxer: (fitxer as File).name,
      p_vehicles: r.vehicles,
    });
    if (error) {
      console.error("Error desant la llista de flota", error);
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    console.error("Error desant la llista de flota", err);
    return { error: e.generic };
  }
  revalidatePath(RUTA);
  return { ok: t.flota.llistes.ok(r.vehicles.length) };
}

/** Buida una llista addicional (p. ex. ja no queda cap immobilitzat). */
export async function buidaLlista(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };
  const categoria = formData.get("categoria") as Categoria;
  if (!CATEGORIES.includes(categoria)) return { error: e.generic };
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("esborra_llista_flota", { p_categoria: categoria });
    if (error) {
      console.error("Error buidant la llista de flota", error);
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    console.error("Error buidant la llista de flota", err);
    return { error: e.generic };
  }
  revalidatePath(RUTA);
  return { ok: t.flota.llistes.buidada };
}

/** Registra l'últim Excel enviat a mà com a punt de partida (sense correu). */
export async function registraInicial(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };
  const fitxer = formData.get("fitxer");
  const r = await llistaDelFormulari(fitxer);
  if (typeof r === "string") return { error: r };
  if (!r.ok) return { error: errorLectura(r) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("registra_enviament_inicial", {
      p_nom_fitxer: (fitxer as File).name,
      p_vehicles: r.vehicles,
    });
    if (error) {
      console.error("Error registrant el punt de partida", error);
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    console.error("Error registrant el punt de partida", err);
    return { error: e.generic };
  }
  revalidatePath(RUTA);
  return { ok: t.flota.inicial.ok(r.vehicles.length) };
}

/**
 * Envia la llista a Proassa (FR-27). La llista i els canvis es tornen a calcular al servidor.
 * Dues fases: prepara (reserva) → envia → confirma. Error segur → es descarta; incert → pendent de confirmar.
 */
export async function enviaProassa(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };
  // El que l'usuari ha vist i confirmat: si ha canviat, no s'envia.
  const vist = ["total", "altes", "baixes"].map((k) => Number(formData.get(k)));
  const supabase = await createClient();
  let reserva: string | null = null;

  try {
    const estat = await llegeixEstatFlota(supabase);
    if (!estat.estoc || estat.actual.length === 0) return { error: e.senseEstoc };
    if (!estat.ultim) return { error: t.flota.previa.senseInicial };
    if (estat.pendent) return { error: e.pendentConfirmar };
    if (vist[0] !== estat.actual.length || vist[1] !== estat.altes.length || vist[2] !== estat.baixes.length) {
      revalidatePath(RUTA);
      return { error: e.canviat };
    }

    const config = configCorreu();
    const dest = destinatarisProassa(config);
    if (!dest) return { error: e.senseDesti };

    // Data de l'Estoc en hora de Madrid ("YYYY-MM-DD").
    const data = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date(estat.estoc.data_estoc));
    const nomFitxer = `VO PARA SEGURO ${data}.xlsx`;
    const excel = generaExcel(estat.actual);
    const { data: id, error: errP } = await supabase.rpc("prepara_enviament_flota", {
      p_base: estat.ultim.id,
      p_proves: !!config.proves,
      p_destinataris: [...dest.to, ...dest.cc].join(", "),
      p_vehicles: estat.actual,
      p_altes: estat.altes,
      p_baixes: estat.baixes,
      p_nom_fitxer: nomFitxer,
      p_data_estoc: estat.estoc.data_estoc,
    });
    if (errP) {
      console.error("Error preparant l'enviament", errP);
      return { error: missatgeBd(errP) };
    }
    reserva = String(id);

    try {
      await enviaCorreu(
        correuEstocProassa({
          data,
          total: estat.actual.length,
          altes: estat.altes,
          baixes: estat.baixes,
          signatura: config.signatura,
        }),
        [{ nom: nomFitxer, contingut: excel, tipus: MIME.xlsx }],
        dest,
      );
    } catch (err) {
      console.error("Error enviant l'estoc a Proassa", reserva, err);
      if (err instanceof ErrorCorreu && err.incert) {
        revalidatePath(RUTA);
        return { error: e.correuIncert };
      }
      await descarta(supabase, reserva);
      return { error: e.correu };
    }

    const enviat = reserva;
    reserva = null; // el correu ha sortit: ja no es descarta
    try {
      const { error: errC } = await supabase.rpc("confirma_enviament_flota", { p_id: enviat });
      if (errC) throw errC;
    } catch (err) {
      console.error("Estoc enviat però no confirmat", enviat, err);
      revalidatePath(RUTA);
      return { error: e.correuEnviatSenseDesar };
    }
  } catch (err) {
    console.error("Error a l'enviament a Proassa", err);
    if (reserva) await descarta(supabase, reserva);
    return { error: err instanceof ErrorCorreu ? e.correu : e.generic };
  }

  revalidatePath(RUTA);
  return { ok: t.flota.previa.ok };
}

async function descarta(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  try {
    const { error } = await supabase.rpc("descarta_enviament_flota", { p_id: id });
    if (error) console.error("Error descartant l'enviament", id, error);
  } catch (err) {
    console.error("Error descartant l'enviament", id, err);
  }
}

/** Resol un enviament incert: Administració ha mirat a Elements enviats. */
export async function resolEnviamentFlota(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };
  const id = String(formData.get("id") ?? "");
  const resultat = formData.get("resultat");
  if (!/^[0-9a-f-]{36}$/i.test(id) || (resultat !== "enviat" && resultat !== "no_enviat")) return { error: e.generic };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc(
      resultat === "enviat" ? "confirma_enviament_flota" : "descarta_enviament_flota",
      { p_id: id },
    );
    if (error) {
      console.error("Error resolent l'enviament", error);
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    console.error("Error resolent l'enviament", err);
    return { error: e.generic };
  }
  revalidatePath(RUTA);
  return { ok: t.vehicles.desat };
}
