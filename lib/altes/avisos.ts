import "server-only";
import { destinatarisAvis } from "../correu/config";
import { configCorreu, enviaCorreu } from "../correu/graph";
import type { Correu } from "../correu/plantilles";
import { createAdminClient } from "../supabase/admin";
import type { Rol } from "../acces";

/** Correus actius dels usuaris amb algun d'aquests rols. */
export async function correusAmbRol(rols: Rol[]): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from("usuaris")
    .select("email, usuari_rols!inner(rol)")
    .eq("actiu", true)
    .in("usuari_rols.rol", rols)
    .returns<{ email: string }[]>();
  if (error) throw error;
  return [...new Set(data.map((u) => u.email))];
}

/**
 * Envia un Avís per correu. Mai fa fallar l'acció que l'ha provocat: si no surt, només es registra
 * (els Avisos amb safata i reintents arribaran amb FR-13…).
 */
export async function enviaAvis(correu: Correu, adreces: string[]): Promise<void> {
  try {
    const dest = destinatarisAvis(configCorreu(), adreces);
    if (!dest) return;
    await enviaCorreu(correu, [], dest);
  } catch (err) {
    console.error("No s'ha pogut enviar l'avís", correu.assumpte, err);
  }
}
