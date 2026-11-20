import "server-only";
import { createAdminClient } from "./supabase/admin";

/** Bucket privat de Supabase Storage per a relacions d'AXA i justificants. */
const BUCKET = "documents";

/** Puja un PDF. Només el servidor (clau de servei); qui crida ja ha comprovat que és admin. */
export async function pujaPdf(path: string, contingut: Uint8Array): Promise<void> {
  const { error } = await createAdminClient()
    .storage.from(BUCKET)
    .upload(path, contingut, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
}

export async function descarregaPdf(path: string): Promise<Uint8Array> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

/** Esborra un PDF que no s'ha arribat a fer servir. No llança: si falla, només queda un fitxer orfe. */
export async function esborraPdf(path: string): Promise<void> {
  const { error } = await createAdminClient().storage.from(BUCKET).remove([path]);
  if (error) console.error("No s'ha pogut esborrar el document", path, error);
}
