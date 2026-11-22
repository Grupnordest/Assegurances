"use server";

import { revalidatePath } from "next/cache";
import { revisaAvisos } from "@/lib/avisos/servidor";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";

export type EstatRevisio = { ok?: string; error?: string };

/** Administració: executa ara la revisió diària dels Avisos (la mateixa que fa la tasca programada). */
export async function revisaAra(): Promise<EstatRevisio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: "No tens permís per fer aquesta acció." };
  try {
    const r = await revisaAvisos();
    revalidatePath("/");
    return {
      ok: `Revisió feta: ${r.creats} avisos nous, ${r.escalats} escalats, ${r.excepcions} excepcions${r.errors ? `, ${r.errors} errors (mira els registres)` : ""}.`,
    };
  } catch (err) {
    console.error("Error a la revisió manual d'avisos", err);
    return { error: "No s'ha pogut fer la revisió. Comprova que APP_URL estigui configurada." };
  }
}
