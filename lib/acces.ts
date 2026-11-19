export const ROLS = ["sollicitant", "validador", "cap_postvenda", "administracio"] as const;
export type Rol = (typeof ROLS)[number];

export const DOMINI = "@grupnordest.com";
export const PROVEIDOR = "azure";

export type MotiuDenegacio = "domini" | "no-alta" | "desactivat";

export type DecisioAcces =
  | { tipus: "permet" }
  | { tipus: "crea-admin" }
  | { tipus: "denega"; motiu: MotiuDenegacio };

/** Identitat que arriba de Supabase Auth després d'iniciar sessió. */
export type Identitat = {
  email: string | null | undefined;
  proveidor: string | null | undefined;
  /** Inquilí (tenant) de Microsoft del compte, si Supabase el proporciona. */
  tenant?: string | null;
};

export function normalitzaEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function esDelDomini(email: string): boolean {
  return normalitzaEmail(email).endsWith(DOMINI);
}

/** Llegeix ADMIN_EMAILS ("a@x.com, b@x.com") en una llista normalitzada. */
export function parseAdminEmails(valor: string | undefined): string[] {
  if (!valor) return [];
  return valor
    .split(",")
    .map(normalitzaEmail)
    .filter((e) => e.length > 0);
}

/**
 * El correu només es fa servir si ve de Microsoft (i, si s'ha configurat
 * AZURE_TENANT_ID, del directori de Grup Nordest). Evita que un compte d'un
 * altre proveïdor o d'un altre directori es faci passar per un usuari.
 */
export function esIdentitatDeConfianca(id: Identitat, tenantEsperat?: string): boolean {
  if (id.proveidor !== PROVEIDOR) return false;
  if (tenantEsperat && id.tenant?.toLowerCase() !== tenantEsperat.toLowerCase()) return false;
  return true;
}

/**
 * Decideix si un compte pot entrar a l'eina (FR-1).
 * `usuari` és la fila de `usuaris` amb aquest correu, o null si no existeix.
 */
export function decideixAcces(
  id: Identitat,
  usuari: { actiu: boolean; rols: Rol[] } | null,
  adminEmails: string[],
  tenantEsperat?: string,
): DecisioAcces {
  const email = id.email;
  if (!email || !esDelDomini(email) || !esIdentitatDeConfianca(id, tenantEsperat)) {
    return { tipus: "denega", motiu: "domini" };
  }
  const esAdminInicial = adminEmails.includes(normalitzaEmail(email));
  if (usuari) {
    if (!usuari.actiu) return { tipus: "denega", motiu: "desactivat" };
    // Repara un primer administrador que es va crear sense rols.
    if (usuari.rols.length === 0 && esAdminInicial) return { tipus: "crea-admin" };
    return { tipus: "permet" };
  }
  if (esAdminInicial) return { tipus: "crea-admin" };
  return { tipus: "denega", motiu: "no-alta" };
}
