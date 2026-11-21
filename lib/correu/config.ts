/** Configuració dels correus a la Corredoria, des de les variables d'entorn. */

export type ConfigCorreu = {
  tenant: string;
  clientId: string;
  clientSecret: string;
  remitent: string;
  gestorPrincipal: string;
  gestorSuplent: string[];
  copiaAdmin: string[];
  signatura: string;
  /** Si té valor, tots els correus van només aquí (mode de proves). */
  proves: string | null;
  /** Proassa (Pòlissa Flota VO): destinataris de l'enviament d'estoc. */
  proassa: string[];
};

export type Destinataris = { to: string[]; cc: string[] };

type Entorn = Record<string, string | undefined>;

const valor = (e: Entorn, k: string) => e[k]?.trim() || null;
/** Una o diverses adreces separades per comes o punts i comes. */
const llista = (e: Entorn, k: string) =>
  (e[k] ?? "")
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Llegeix la configuració. Retorna les variables que falten si n'hi ha cap d'obligatòria buida. */
export function llegeixConfigCorreu(e: Entorn): { ok: true; config: ConfigCorreu } | { ok: false; falten: string[] } {
  const obligatories = [
    "AZURE_TENANT_ID",
    "MS_GRAPH_CLIENT_ID",
    "MS_GRAPH_CLIENT_SECRET",
    "CORREU_REMITENT",
    "CORREU_GESTOR_PRINCIPAL",
  ];
  const falten = obligatories.filter((k) => !valor(e, k));
  if (falten.length) return { ok: false, falten };
  return {
    ok: true,
    config: {
      tenant: valor(e, "AZURE_TENANT_ID")!,
      clientId: valor(e, "MS_GRAPH_CLIENT_ID")!,
      clientSecret: valor(e, "MS_GRAPH_CLIENT_SECRET")!,
      remitent: valor(e, "CORREU_REMITENT")!,
      gestorPrincipal: valor(e, "CORREU_GESTOR_PRINCIPAL")!,
      gestorSuplent: llista(e, "CORREU_GESTOR_SUPLENT"),
      copiaAdmin: llista(e, "CORREU_COPIA_ADMIN"),
      signatura: valor(e, "CORREU_SIGNATURA") ?? "Administració",
      proves: valor(e, "CORREU_PROVES"),
      proassa: llista(e, "CORREU_PROASSA"),
    },
  };
}

/** Destinataris d'un correu a la Corredoria. En mode de proves, només l'adreça de proves. */
export function destinataris(c: ConfigCorreu): Destinataris {
  if (c.proves) return { to: [c.proves], cc: [] };
  const principal = c.gestorPrincipal.toLowerCase();
  const cc = [...new Set([...c.gestorSuplent, ...c.copiaAdmin].map((x) => x.toLowerCase()))];
  return { to: [c.gestorPrincipal], cc: cc.filter((x) => x !== principal) };
}

/** Destinataris de l'enviament d'estoc a Proassa: Proassa i còpia a Administració. En proves, només l'adreça de proves. */
export function destinatarisProassa(c: ConfigCorreu): Destinataris | null {
  if (c.proves) return { to: [c.proves], cc: [] };
  if (c.proassa.length === 0) return null;
  const to = [...new Set(c.proassa.map((x) => x.toLowerCase()))];
  return { to, cc: [...new Set(c.copiaAdmin.map((x) => x.toLowerCase()))].filter((x) => !to.includes(x)) };
}

/** Destinataris d'un Avís a usuaris de l'eina. En proves, només l'adreça de proves. */
export function destinatarisAvis(c: ConfigCorreu, adreces: string[]): Destinataris | null {
  if (c.proves) return { to: [c.proves], cc: [] };
  const to = [...new Set(adreces.map((x) => x.trim().toLowerCase()).filter(Boolean))];
  return to.length ? { to, cc: [] } : null;
}
