"use server";

import { revalidatePath } from "next/cache";
import { llegeixEstoc } from "@/lib/estoc/llegeix-excel";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";
import { esCaigudaForta, MIDA_MAXIMA, missatgeErrorLectura } from "./regles";

export type EstatCarrega = {
  error?: string;
  /** Cal confirmar: el fitxer té molts menys vehicles que l'estoc vigent. */
  confirmacio?: { abans: number; ara: number };
  ok?: { vehicles: number; descartats: number; senseData: boolean };
};

/** Carrega un Excel d'Estoc i el converteix en l'Estoc vigent (FR-3). */
export async function pujaEstoc(_prev: EstatCarrega, formData: FormData): Promise<EstatCarrega> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: t.estoc.errors.permis };

  const fitxer = formData.get("fitxer");
  if (!(fitxer instanceof File) || fitxer.size === 0) return { error: t.estoc.errors.senseFitxer };
  if (fitxer.size > MIDA_MAXIMA) return { error: t.estoc.errors.mida };
  if (!/\.xlsx?$/i.test(fitxer.name)) return { error: t.estoc.errors.tipus };

  const lectura = llegeixEstoc(new Uint8Array(await fitxer.arrayBuffer()));
  if (!lectura.ok) return { error: missatgeErrorLectura(lectura) };

  try {
    const supabase = await createClient();
    const { data: vigent, error: errVigent } = await supabase
      .from("estoc_carregues")
      .select("num_vehicles")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle<{ num_vehicles: number }>();
    if (errVigent) throw errVigent;

    const abans = vigent?.num_vehicles ?? 0;
    const ara = lectura.vehicles.length;
    if (esCaigudaForta(abans, ara) && formData.get("confirma") !== "1") {
      return { confirmacio: { abans, ara } };
    }

    const { error } = await supabase.rpc("carrega_estoc", {
      p_data_estoc: lectura.dataEstoc,
      p_fitxer: fitxer.name.slice(0, 200),
      p_descartats: lectura.descartats,
      p_vehicles: lectura.vehicles,
    });
    if (error) {
      console.error("Error desant l'estoc", error);
      return { error: error.code === "42501" ? t.estoc.errors.permis : t.estoc.errors.generic };
    }
  } catch (err) {
    console.error("Error carregant l'estoc", err);
    return { error: t.estoc.errors.generic };
  }

  revalidatePath("/admin/estoc");
  return {
    ok: { vehicles: lectura.vehicles.length, descartats: lectura.descartats, senseData: !lectura.dataEstoc },
  };
}
