import { createHash, randomBytes } from "node:crypto";

/** Enllaços dels correus d'Avís: testimoni aleatori (només se'n desa el hash), caducat als 7 dies. */
export const DIES_CADUCITAT = 7;

export function nouTestimoni(ara = new Date()): { testimoni: string; hash: string; caduca: string } {
  const testimoni = randomBytes(32).toString("base64url");
  return {
    testimoni,
    hash: hashTestimoni(testimoni),
    caduca: new Date(ara.getTime() + DIES_CADUCITAT * 86_400_000).toISOString(),
  };
}

export function hashTestimoni(testimoni: string): string {
  return createHash("sha256").update(testimoni).digest("hex");
}

/** Forma vàlida d'un testimoni (43 caràcters base64url). */
export function esTestimoni(valor: unknown): valor is string {
  return typeof valor === "string" && /^[A-Za-z0-9_-]{43}$/.test(valor);
}
