"use server";

import { revalidatePath } from "next/cache";
import { llegeixLlistatFlota, type FilaDescartada } from "@/lib/flota/llegeix-llistat";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";
import { classificacioSchema, MIDA_MAXIMA, missatgeErrorLlistat, missatgeErrorVehicles } from "./regles";

export type EstatCarregaLlistat = { error?: string; ok?: { vehicles: number; descartades: FilaDescartada[] } };
export type EstatClassificacio = { error?: string; ok?: boolean };

/** Càrrega inicial des del Llistat de flota (FR-21). */
export async function carregaLlistat(_prev: EstatCarregaLlistat, formData: FormData): Promise<EstatCarregaLlistat> {
  const e = t.vehicles.errors;
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };

  const fitxer = formData.get("fitxer");
  if (!(fitxer instanceof File) || fitxer.size === 0) return { error: e.senseFitxer };
  if (fitxer.size > MIDA_MAXIMA) return { error: e.mida };
  if (!/\.xlsx?$/i.test(fitxer.name)) return { error: e.tipus };

  const lectura = llegeixLlistatFlota(new Uint8Array(await fitxer.arrayBuffer()));
  if (!lectura.ok) return { error: missatgeErrorLlistat(lectura) };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("carrega_inicial_flota", {
      p_vehicles: lectura.vehicles,
      p_descartades: lectura.descartades,
    });
    if (error) {
      console.error("Error a la càrrega inicial", error);
      return { error: missatgeErrorVehicles(error) };
    }
    revalidatePath("/admin/vehicles");
    return { ok: { vehicles: Number(data), descartades: lectura.descartades } };
  } catch (err) {
    console.error("Error a la càrrega inicial", err);
    return { error: e.generic };
  }
}

/** Assigna Motiu, Responsable, Centre i Data prevista de baixa (UJ-5). */
export async function classificaVehicle(_prev: EstatClassificacio, formData: FormData): Promise<EstatClassificacio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: t.vehicles.errors.permis };

  const parsed = classificacioSchema.safeParse({
    id: formData.get("id"),
    versio: formData.get("versio") ?? "",
    motiu: formData.get("motiu") ?? "",
    responsable: formData.get("responsable") ?? "",
    centre: formData.get("centre") ?? "",
    dataPrevista: formData.get("dataPrevista") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t.vehicles.errors.dades };
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("classifica_vehicle", {
      p_id: d.id,
      p_motiu: d.motiu,
      p_responsable: d.motiu === "vs" ? null : d.responsable,
      p_centre: d.centre,
      p_data_prevista_baixa: d.dataPrevista,
      p_versio: d.versio,
    });
    if (error) {
      console.error("Error classificant vehicle", error);
      return { error: missatgeErrorVehicles(error) };
    }
  } catch (err) {
    console.error("Error classificant vehicle", err);
    return { error: t.vehicles.errors.generic };
  }

  revalidatePath("/admin/vehicles");
  return { ok: true };
}
