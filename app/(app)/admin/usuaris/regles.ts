import { z } from "zod";
import { esDelDomini, normalitzaEmail, ROLS, type Rol } from "@/lib/acces";
import { t } from "@/lib/textos";

export type UsuariRegles = { id: string; email: string; actiu: boolean; rols: Rol[] };

const e = t.usuaris.errors;

export const usuariSchema = z.object({
  id: z.string().uuid(e.noTrobat).optional(),
  nom: z.string({ invalid_type_error: e.nom }).trim().min(1, e.nom),
  email: z
    .string({ invalid_type_error: e.email })
    .transform(normalitzaEmail)
    .refine((v) => z.string().email().safeParse(v).success && esDelDomini(v), e.email),
  // Buit = tots els centres (p. ex. el Cap de postvenda o Administració). La validesa real la dona la clau forana.
  centreId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number({ invalid_type_error: e.centre }).int(e.centre).positive(e.centre).nullable(),
  ),
  rols: z.array(z.enum(ROLS, { errorMap: () => ({ message: e.rols }) })).min(1, e.rols),
});

export type DadesUsuari = z.infer<typeof usuariSchema>;

export const canviActiuSchema = z.object({
  id: z.string().uuid(e.noTrobat),
  actiu: z.boolean({ invalid_type_error: e.generic }),
});

/** Un altre usuari ja té aquest correu (comparació en minúscules). */
export function esCorreuDuplicat(usuaris: UsuariRegles[], email: string, idPropi?: string): boolean {
  const v = normalitzaEmail(email);
  return usuaris.some((u) => normalitzaEmail(u.email) === v && u.id !== idPropi);
}

/**
 * Després d'aplicar el canvi a l'usuari `id` (nou estat i/o rols),
 * queda com a mínim un administrador actiu? (La base de dades ho torna a comprovar.)
 */
export function quedaAlgunAdmin(
  usuaris: UsuariRegles[],
  canvi: { id: string; actiu?: boolean; rols?: Rol[] },
): boolean {
  return usuaris
    .map((u) => (u.id === canvi.id ? { ...u, actiu: canvi.actiu ?? u.actiu, rols: canvi.rols ?? u.rols } : u))
    .some((u) => u.actiu && u.rols.includes("administracio"));
}

export function hiHaCapPostvendaActiu(usuaris: UsuariRegles[]): boolean {
  return usuaris.some((u) => u.actiu && u.rols.includes("cap_postvenda"));
}

/** Tradueix un error de la base de dades a un missatge per a l'usuari. */
export function missatgeErrorBd(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return e.generic;
  if (error.code === "23505") return e.duplicat;
  if (error.code === "23503") return e.centre;
  if (error.code === "42501") return e.permis;
  if (error.code === "P0001") {
    if (error.message?.includes("ultim_admin")) return e.ultimAdmin;
    if (error.message?.includes("no_trobat")) return e.noTrobat;
    if (error.message?.includes("sense_rols")) return e.rols;
  }
  return e.generic;
}
