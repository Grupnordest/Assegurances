"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tancaExcepcio } from "@/lib/avisos/servidor";
import { configCorreu, enviaCorreu, ErrorCorreu } from "@/lib/correu/graph";
import { correuReclamacioExtorns } from "@/lib/correu/plantilles";
import { esPerReclamar } from "@/lib/incidencies/llista";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";

const acceptaSchema = z.object({
  baixa: z.string().uuid(t.extorns.errors.dades),
  comentari: z
    .string({ invalid_type_error: t.extorns.errors.comentari })
    .trim()
    .min(1, t.extorns.errors.comentari)
    .max(1000, t.extorns.errors.comentari),
});

const descartaSchema = z.object({
  rebut: z.string().uuid(t.extorns.errors.dades),
  comentari: z
    .string({ invalid_type_error: t.extorns.errors.comentari })
    .trim()
    .min(1, t.extorns.errors.comentari)
    .max(1000, t.extorns.errors.comentari),
});

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

export type EstatExtorn = { ok?: string; error?: string };

/** Reclama a la Corredoria tots els extorns pendents (FR-25). Si el correu no surt, no es marca res. */
export async function reclamaExtorns(): Promise<EstatExtorn> {
  const te = t.extorns;
  if (!esAdmin(await obtenirUsuariActual())) return { error: te.errors.permis };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("baixes")
    .select("id, estat, data_baixa, extorn_esperat, extorn_liquidat, liquidada_at, reclamada_at, vehicles_assegurats!inner(matricula, polissa)")
    .eq("estat", "enviada")
    .is("liquidada_at", null)
    .is("extorn_liquidat", null)
    .order("data_baixa")
    .returns<
      {
        id: string;
        estat: string;
        data_baixa: string;
        extorn_esperat: number | string | null;
        extorn_liquidat: null;
        liquidada_at: null;
        reclamada_at: string | null;
        vehicles_assegurats: { matricula: string; polissa: string | null };
      }[]
    >();
  if (error) {
    console.error("Error llegint els extorns pendents", error);
    return { error: error.code === "42501" ? te.errors.permis : te.errors.generic };
  }
  const ara = new Date();
  const candidates = data.filter((b) => esPerReclamar(b, ara));
  if (candidates.length === 0) return { error: te.capPerReclamar };

  // Reserva amb bloqueig: només es reclamen les que encara són elegibles (un doble clic no duplica el correu).
  const { data: reservades, error: errR } = await supabase.rpc("reserva_reclamacio", { p_baixes: candidates.map((b) => b.id) });
  if (errR) {
    console.error("Error reservant la reclamació d'extorns", errR);
    return { error: errR.code === "42501" ? te.errors.permis : te.errors.generic };
  }
  const ids = new Set((reservades as string[] | null) ?? []);
  const baixes = candidates.filter((b) => ids.has(b.id));
  if (baixes.length === 0) return { error: te.capPerReclamar };

  try {
    const config = configCorreu();
    await enviaCorreu(
      correuReclamacioExtorns({
        files: baixes.map((b) => ({
          matricula: b.vehicles_assegurats.matricula,
          polissa: b.vehicles_assegurats.polissa,
          dataBaixa: b.data_baixa,
          esperat: b.extorn_esperat === null ? null : Number(b.extorn_esperat),
        })),
        signatura: config.signatura,
      }),
    );
  } catch (err) {
    console.error("Error enviant la reclamació d'extorns", err);
    revalidatePath("/", "layout");
    // Si no se sap si ha sortit, es manté la reserva: millor no reclamar dues vegades.
    if (err instanceof ErrorCorreu && err.incert) return { error: te.errors.correuIncert };
    const { error: errA } = await supabase.rpc("allibera_reclamacio", { p_baixes: [...ids] });
    if (errA) console.error("Error alliberant la reclamació d'extorns", errA);
    return { error: te.errors.correu };
  }

  revalidatePath("/", "layout");
  return { ok: te.reclamats(baixes.length) };
}

/** Administració descarta una línia de rebut sense casar, amb un comentari (no s'esborra). */
export async function descartaRebut(_prev: EstatExtorn, formData: FormData): Promise<EstatExtorn> {
  const te = t.extorns;
  if (!esAdmin(await obtenirUsuariActual())) return { error: te.errors.permis };
  const parsed = descartaSchema.safeParse({ rebut: formData.get("rebut"), comentari: formData.get("comentari") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? te.errors.dades };
  try {
    const { error } = await (await createClient()).rpc("descarta_rebut", {
      p_rebut: parsed.data.rebut,
      p_comentari: parsed.data.comentari,
    });
    if (error) {
      console.error("Error descartant el rebut", error);
      if (error.code === "42501") return { error: te.errors.permis };
      const m = error.message ?? "";
      if (m.includes("comentari")) return { error: te.errors.comentari };
      if (m.includes("estat_rebut")) return { error: te.errors.estatRebut };
      return { error: te.errors.generic };
    }
  } catch (err) {
    console.error("Error descartant el rebut", err);
    return { error: te.errors.generic };
  }
  revalidatePath("/", "layout");
  return { ok: te.descartat };
}

const liniaCarteraSchema = z.object({ linia: z.string().uuid(t.extorns.errors.dades) });
const descartaCarteraSchema = liniaCarteraSchema.extend({ comentari: descartaSchema.shape.comentari });

/** Error d'una RPC de cartera → missatge per a Administració. */
function errorCartera(error: { code?: string; message?: string }): EstatExtorn {
  const te = t.extorns;
  if (error.code === "42501") return { error: te.errors.permis };
  const m = error.message ?? "";
  if (m.includes("comentari")) return { error: te.errors.comentari };
  if (m.includes("estat_linia")) return { error: te.errors.estatCartera };
  // 23505: l'índex únic de matrícula oberta (un altre cicle creat alhora).
  if (m.includes("matricula_oberta") || error.code === "23505") return { error: te.errors.matriculaOberta };
  return { error: te.errors.generic };
}

/** Administració descarta una línia del Rebut de cartera amb un comentari (no s'esborra). */
export async function descartaLiniaCartera(_prev: EstatExtorn, formData: FormData): Promise<EstatExtorn> {
  const te = t.extorns;
  if (!esAdmin(await obtenirUsuariActual())) return { error: te.errors.permis };
  const parsed = descartaCarteraSchema.safeParse({ linia: formData.get("linia"), comentari: formData.get("comentari") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? te.errors.dades };
  try {
    const { error } = await (await createClient()).rpc("descarta_linia_cartera", {
      p_linia: parsed.data.linia,
      p_comentari: parsed.data.comentari,
    });
    if (error) {
      console.error("Error descartant la línia de cartera", error);
      return errorCartera(error);
    }
  } catch (err) {
    console.error("Error descartant la línia de cartera", err);
    return { error: te.errors.generic };
  }
  revalidatePath("/", "layout");
  return { ok: te.descartat };
}

/** "Crear com a Assegurat": crea el vehicle d'una línia sense control amb la prima i la pòlissa del rebut. */
export async function creaVehicleDeCartera(_prev: EstatExtorn, formData: FormData): Promise<EstatExtorn> {
  const te = t.extorns;
  if (!esAdmin(await obtenirUsuariActual())) return { error: te.errors.permis };
  const parsed = liniaCarteraSchema.safeParse({ linia: formData.get("linia") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? te.errors.dades };
  try {
    const { error } = await (await createClient()).rpc("crea_vehicle_de_cartera", { p_linia: parsed.data.linia });
    if (error) {
      console.error("Error creant el vehicle des de la cartera", error);
      return errorCartera(error);
    }
  } catch (err) {
    console.error("Error creant el vehicle des de la cartera", err);
    return { error: te.errors.generic };
  }
  revalidatePath("/", "layout");
  return { ok: te.vehicleCreat };
}

/** Administració accepta un extorn que no quadra, amb un comentari: tanca la baixa. */
export async function acceptaExtorn(_prev: EstatExtorn, formData: FormData): Promise<EstatExtorn> {
  const te = t.extorns;
  if (!esAdmin(await obtenirUsuariActual())) return { error: te.errors.permis };
  const parsed = acceptaSchema.safeParse({ baixa: formData.get("baixa"), comentari: formData.get("comentari") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? te.errors.dades };
  try {
    const { error } = await (await createClient()).rpc("accepta_extorn", {
      p_baixa: parsed.data.baixa,
      p_comentari: parsed.data.comentari,
    });
    if (error) {
      console.error("Error acceptant l'extorn", error);
      if (error.code === "42501") return { error: te.errors.permis };
      const m = error.message ?? "";
      if (m.includes("comentari")) return { error: te.errors.comentari };
      if (m.includes("estat_baixa") || m.includes("no_trobat")) return { error: te.errors.estat };
      return { error: te.errors.generic };
    }
  } catch (err) {
    console.error("Error acceptant l'extorn", err);
    return { error: te.errors.generic };
  }
  revalidatePath("/", "layout");
  return { ok: te.acceptat };
}
