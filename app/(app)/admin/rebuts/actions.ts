"use server";

import { revalidatePath } from "next/cache";
import { llegeixRebuts } from "@/lib/rebuts/llegeix-rebuts";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";
import { MAX_FITXERS, MIDA_MAXIMA, missatgeErrorRebuts } from "./regles";

export type ResumImportacio = {
  importades: number;
  repetides: number;
  recasades: number;
  emissions: number;
  primes: number;
  sense_vehicle: number;
  liquidats: number;
  incorrectes: number;
  no_identificats: number;
};

export type ResultatFitxer = {
  nom: string;
  error?: string;
  resum?: ResumImportacio & { ignorades: number };
  /** Números de rebut amb una Clase desconeguda (no importats). */
  desconegudes?: string[];
};

export type EstatImportacio = { error?: string; fitxers?: ResultatFitxer[] };

/** Importa un o diversos Excel de rebuts de la Corredoria (FR-24). Cada fitxer és una transacció a part. */
export async function importaRebuts(_prev: EstatImportacio, formData: FormData): Promise<EstatImportacio> {
  const e = t.rebuts.errors;
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };

  const fitxers = formData.getAll("fitxers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fitxers.length === 0) return { error: e.senseFitxer };
  if (fitxers.length > MAX_FITXERS) return { error: e.massaFitxers(MAX_FITXERS) };

  const supabase = await createClient();
  const resultats: ResultatFitxer[] = [];
  for (const fitxer of fitxers) {
    const nom = fitxer.name.slice(0, 200);
    if (fitxer.size > MIDA_MAXIMA) {
      resultats.push({ nom, error: e.mida });
      continue;
    }
    if (!/\.xlsx?$/i.test(fitxer.name)) {
      resultats.push({ nom, error: e.tipus });
      continue;
    }
    const lectura = llegeixRebuts(new Uint8Array(await fitxer.arrayBuffer()));
    if (!lectura.ok) {
      resultats.push({ nom, error: missatgeErrorRebuts(lectura) });
      continue;
    }
    const desconegudes = lectura.desconegudes.map((d) => d.num_rebut);
    const buit = { importades: 0, repetides: 0, recasades: 0, emissions: 0, primes: 0, sense_vehicle: 0, liquidats: 0, incorrectes: 0, no_identificats: 0 };
    if (lectura.linies.length === 0) {
      resultats.push({ nom, resum: { ...buit, ignorades: lectura.ignorades }, desconegudes });
      continue;
    }
    try {
      const { data, error } = await supabase.rpc("importa_rebuts", {
        // La prima anual la torna a calcular la base de dades (mateixa fórmula).
        p_rebuts: lectura.linies.map((l) => ({ ...l, prima_anual: undefined })),
        p_fitxer: nom,
      });
      if (error) {
        console.error("Error important rebuts", nom, error);
        resultats.push({ nom, error: error.code === "42501" ? e.permis : e.generic });
        continue;
      }
      resultats.push({ nom, resum: { ...buit, ...(data as Partial<ResumImportacio>), ignorades: lectura.ignorades }, desconegudes });
    } catch (err) {
      console.error("Error important rebuts", nom, err);
      resultats.push({ nom, error: e.generic });
    }
  }

  revalidatePath("/", "layout");
  return { fitxers: resultats };
}
