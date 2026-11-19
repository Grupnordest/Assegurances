import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { esIdentitatDeConfianca, normalitzaEmail, type Identitat, type Rol } from "./acces";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";

export type UsuariActual = {
  id: string;
  email: string;
  nom: string;
  actiu: boolean;
  centre: { id: number; nom: string } | null;
  rols: Rol[];
};

type FilaUsuari = {
  id: string;
  email: string;
  nom: string;
  actiu: boolean;
  centres: { id: number; nom: string } | null;
  usuari_rols: { rol: Rol }[];
};

/** Identitat del compte de Supabase Auth (correu, proveïdor i directori de Microsoft). */
export function identitatDe(user: User): Identitat {
  const meta = user.user_metadata ?? {};
  const tenant = (meta.custom_claims?.tid ?? meta.tid ?? null) as string | null;
  return { email: user.email, proveidor: user.app_metadata?.provider, tenant };
}

export function tenantEsperat(): string | undefined {
  return process.env.AZURE_TENANT_ID || undefined;
}

/** Busca un usuari per correu, saltant RLS (també troba els desactivats). */
export async function buscaUsuariPerEmail(email: string): Promise<UsuariActual | null> {
  const { data, error } = await createAdminClient()
    .from("usuaris")
    .select("id, email, nom, actiu, centres(id, nom), usuari_rols(rol)")
    .eq("email", normalitzaEmail(email))
    .maybeSingle<FilaUsuari>();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    nom: data.nom,
    actiu: data.actiu,
    centre: data.centres,
    rols: data.usuari_rols.map((r) => r.rol),
  };
}

/**
 * Usuari de la sessió actual, o null si no hi ha sessió vàlida o no és a `usuaris`.
 * Es consulta a cada petició perquè un usuari desactivat perdi l'accés de seguida.
 * Un error de xarxa o de base de dades es llança (pantalla d'error), no tanca la sessió.
 */
export const obtenirUsuariActual = cache(async (): Promise<UsuariActual | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError" && error.status !== 401 && error.status !== 403) {
    throw error;
  }
  if (!user?.email || !esIdentitatDeConfianca(identitatDe(user), tenantEsperat())) return null;
  return buscaUsuariPerEmail(user.email);
});

/** Per a cada pàgina protegida: retorna l'usuari actiu o el treu de l'eina. */
export async function exigeixUsuariActiu(): Promise<UsuariActual> {
  const usuari = await obtenirUsuariActual();
  if (!usuari) redirect("/auth/sortir?motiu=no-alta");
  if (!usuari.actiu) redirect("/auth/sortir?motiu=desactivat");
  return usuari;
}

export function esAdmin(usuari: UsuariActual | null): boolean {
  return !!usuari && usuari.actiu && usuari.rols.includes("administracio");
}
