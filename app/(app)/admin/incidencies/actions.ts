"use server";

import { revalidatePath } from "next/cache";
import { tancaExcepcio } from "@/lib/avisos/servidor";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";

export type EstatTancament = { ok?: string; error?: string };

/** Administració tanca un Avís en excepció amb un comentari. */
export async function tancaIncidencia(_prev: EstatTancament, formData: FormData): Promise<EstatTancament> {
  const usuari = await obtenirUsuariActual();
  if (!esAdmin(usuari)) return { error: "No tens permís per fer aquesta acció." };
  const avisId = formData.get("avis");
  const comentari = formData.get("comentari");
  if (typeof avisId !== "string" || !/^[0-9a-f-]{36}$/i.test(avisId)) return { error: "Incidència no vàlida." };
  if (typeof comentari !== "string" || !comentari.trim()) return { error: "Escriu un comentari." };
  const r = await tancaExcepcio(avisId, usuari!.id, comentari);
  if ("ok" in r) revalidatePath("/", "layout");
  return r;
}
