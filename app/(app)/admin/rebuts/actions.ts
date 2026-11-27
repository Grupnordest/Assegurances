"use server";

import { revalidatePath } from "next/cache";
import { llegeixRebuts, separaCartera } from "@/lib/rebuts/llegeix-rebuts";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";
import { MAX_FITXERS, MIDA_MAXIMA, missatgeErrorCartera, missatgeErrorRebuts } from "./regles";

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

/** Resum de la conciliació del Rebut de cartera (FR-22). */
export type ResumCartera = {
  ok: number;
  sense_control: number;
  cobrat_despres_baixa: number;
  absent: number;
  quadra: boolean;
};

export type ResultatFitxer = {
  nom: string;
  error?: string;
  resum?: ResumImportacio & { ignorades: number };
  cartera?: ResumCartera;
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

    // Rebut de cartera (Clase 30): va a la seva taula de conciliació, mai a `rebuts`.
    const cartera = separaCartera(lectura.linies, lectura.mares);
    if (cartera && !cartera.ok) {
      resultats.push({ nom, error: e.dosPeriodes });
      continue;
    }
    // La prima anual dels rebuts la torna a calcular la base de dades (mateixa fórmula).
    const rebuts = lectura.linies.filter((l) => l.tipus !== "cartera").map((l) => ({ ...l, prima_anual: undefined }));

    if (cartera) {
      // Cartera i resta de rebuts en una sola transacció: si falla, no s'importa res del fitxer.
      try {
        const { data, error } = await supabase.rpc("importa_cartera", {
          p_linies: cartera.linies,
          p_mare: cartera.mare,
          p_fitxer: nom,
          p_rebuts: rebuts.length ? rebuts : null,
        });
        if (error) {
          console.error("Error important el Rebut de cartera", nom, error);
          resultats.push({ nom, error: missatgeErrorCartera(error) });
          continue;
        }
        const { rebuts: resumRebuts, ...resumCartera } = data as ResumCartera & { rebuts: Partial<ResumImportacio> | null };
        resultats.push({
          nom,
          // Un fitxer només de cartera no mostra el resum de rebuts (tot serien zeros).
          resum: resumRebuts ? { ...buit, ...resumRebuts, ignorades: lectura.ignorades } : undefined,
          cartera: resumCartera,
          desconegudes,
        });
      } catch (err) {
        console.error("Error important el Rebut de cartera", nom, err);
        resultats.push({ nom, error: e.carteraGeneric });
      }
      continue;
    }

    if (rebuts.length === 0) {
      resultats.push({ nom, resum: { ...buit, ignorades: lectura.ignorades }, desconegudes });
      continue;
    }
    try {
      const { data, error } = await supabase.rpc("importa_rebuts", { p_rebuts: rebuts, p_fitxer: nom });
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
