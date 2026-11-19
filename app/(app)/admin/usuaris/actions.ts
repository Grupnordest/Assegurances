"use server";

import { revalidatePath } from "next/cache";
import type { Rol } from "@/lib/acces";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";
import {
  canviActiuSchema,
  esCorreuDuplicat,
  missatgeErrorBd,
  quedaAlgunAdmin,
  usuariSchema,
  type UsuariRegles,
} from "./regles";

export type EstatFormulari = { error?: string; ok?: boolean };

type Fila = { id: string; email: string; actiu: boolean; usuari_rols: { rol: Rol }[] };

async function carregaUsuaris(supabase: Awaited<ReturnType<typeof createClient>>): Promise<UsuariRegles[]> {
  const { data, error } = await supabase.from("usuaris").select("id, email, actiu, usuari_rols(rol)").returns<Fila[]>();
  if (error) throw error;
  return data.map((u) => ({ id: u.id, email: u.email, actiu: u.actiu, rols: u.usuari_rols.map((r) => r.rol) }));
}

/** Alta o edició d'un usuari (FR-2). */
export async function desaUsuari(_prev: EstatFormulari, formData: FormData): Promise<EstatFormulari> {
  const jo = await obtenirUsuariActual();
  if (!esAdmin(jo)) return { error: t.usuaris.errors.permis };

  const parsed = usuariSchema.safeParse({
    id: formData.get("id") || undefined,
    nom: formData.get("nom") ?? "",
    email: formData.get("email") ?? "",
    centreId: formData.get("centreId") ?? "",
    rols: formData.getAll("rols"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t.usuaris.errors.generic };
  const dades = parsed.data;

  try {
    const supabase = await createClient();
    // Comprovacions prèvies per donar un missatge clar; la base de dades les torna a fer.
    const usuaris = await carregaUsuaris(supabase);
    if (esCorreuDuplicat(usuaris, dades.email, dades.id)) return { error: t.usuaris.errors.duplicat };
    if (dades.id) {
      if (!usuaris.some((u) => u.id === dades.id)) return { error: t.usuaris.errors.noTrobat };
      if (!quedaAlgunAdmin(usuaris, { id: dades.id, rols: dades.rols })) return { error: t.usuaris.errors.ultimAdmin };
      // Canviar el propi correu tallaria la sessió (l'accés va per correu).
      if (dades.id === jo!.id && dades.email !== jo!.email) return { error: t.usuaris.errors.propiCorreu };
    }

    // Usuari i rols en una sola transacció (RLS de qui crida).
    const { error } = await supabase.rpc("desa_usuari", {
      p_id: dades.id ?? null,
      p_nom: dades.nom,
      p_email: dades.email,
      p_centre_id: dades.centreId,
      p_rols: dades.rols,
    });
    if (error) {
      console.error("Error desant usuari", error);
      return { error: missatgeErrorBd(error) };
    }
  } catch (err) {
    console.error("Error desant usuari", err);
    return { error: t.usuaris.errors.generic };
  }

  revalidatePath("/admin/usuaris");
  return { ok: true };
}

/** Desactiva o reactiva un usuari (FR-2). */
export async function canviaActiu(id: unknown, actiu: unknown): Promise<EstatFormulari> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: t.usuaris.errors.permis };

  const parsed = canviActiuSchema.safeParse({ id, actiu });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t.usuaris.errors.generic };
  const dades = parsed.data;

  try {
    const supabase = await createClient();
    const usuaris = await carregaUsuaris(supabase);
    if (!usuaris.some((u) => u.id === dades.id)) return { error: t.usuaris.errors.noTrobat };
    if (!dades.actiu && !quedaAlgunAdmin(usuaris, { id: dades.id, actiu: false })) {
      return { error: t.usuaris.errors.ultimAdmin };
    }

    const { data, error } = await supabase.from("usuaris").update({ actiu: dades.actiu }).eq("id", dades.id).select("id");
    if (error) {
      console.error("Error canviant l'estat de l'usuari", error);
      return { error: missatgeErrorBd(error) };
    }
    // RLS pot filtrar la fila sense donar error: llavors no s'ha desat res.
    if (!data?.length) return { error: t.usuaris.errors.permis };
  } catch (err) {
    console.error("Error canviant l'estat de l'usuari", err);
    return { error: t.usuaris.errors.generic };
  }

  revalidatePath("/admin/usuaris");
  return { ok: true };
}
