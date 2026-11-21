"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { enviaAvis } from "@/lib/altes/avisos";
import { extensio, MIME_ADJUNT, tipusAdjunt } from "@/lib/altes/fitxers";
import { COBERTURES, FOTOS, MIDA_FITXER, MIDA_TOTAL_ADJUNTS } from "@/lib/altes/regles";
import { configCorreu, enviaCorreu, ErrorCorreu, type Adjunt } from "@/lib/correu/graph";
import { avisResolucioAlta, correuAlta } from "@/lib/correu/plantilles";
import { descarregaPdf, esborraPdf, pujaPdf } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";

export type EstatAccio = { error?: string; ok?: string };

const e = t.validar.errors;
const RUTA = "/validar";
const esUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

type Supabase = Awaited<ReturnType<typeof createClient>>;

function missatgeBd(err: { code?: string; message?: string }): string {
  const m = err.message ?? "";
  if (err.code === "42501") return e.permis;
  if (m.includes("pendent_confirmar")) return e.pendentConfirmar;
  if (m.includes("ja_resolt") || m.includes("no_trobat")) return e.jaResolt;
  if (m.includes("motiu_rebuig")) return e.motiu;
  if (m.includes("enviant_ara")) return e.enviantAra;
  if (m.includes("falten_documents")) return e.faltenDocuments;
  return e.generic;
}

async function rpc(supabase: Supabase, fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw error;
}

type Alta = {
  matricula: string;
  marca_model: string | null;
  color: string | null;
  vin: string | null;
  cobertura: "tot_risc" | "tercers";
  data_alta: string;
  fotos: string[];
  pc_path: string;
  ft_path: string;
  sollicitant: { email: string } | null;
};

/** Avisa el Sol·licitant. Mai fa fallar l'acció: el canvi d'estat ja està desat. */
async function avisaSollicitant(id: string, validada: boolean, motiu?: string) {
  try {
    const [alta, usuari] = await Promise.all([llegeixAlta(id), obtenirUsuariActual()]);
    if (!alta.sollicitant?.email || !usuari) return;
    const origen = (await headers()).get("origin") ?? "";
    await enviaAvis(
      avisResolucioAlta({ matricula: alta.matricula, validada, qui: usuari.nom, motiuRebuig: motiu, enllac: `${origen}/altes` }),
      [alta.sollicitant.email],
    );
  } catch (err) {
    console.error("No s'ha pogut avisar el sol·licitant", id, err);
  }
}

async function llegeixAlta(id: string): Promise<Alta> {
  const { data, error } = await createAdminClient()
    .from("vehicles_assegurats")
    .select(
      "matricula, marca_model, color, vin, cobertura, data_alta, fotos, pc_path, ft_path, sollicitant:usuaris!vehicles_assegurats_sollicitant_id_fkey(email)",
    )
    .eq("id", id)
    .single<Alta>();
  if (error) throw error;
  return data;
}

/**
 * Valida una Sol·licitud d'alta i envia el correu a la Corredoria (FR-6 + FR-8).
 * Dues fases: prepara → envia → confirma. Error segur → descarta; incert → pendent de confirmar.
 */
export async function validaAlta(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!(await obtenirUsuariActual())?.actiu) return { error: e.permis };
  const id = formData.get("id");
  const cobertura = formData.get("cobertura");
  if (!esUuid(id) || !COBERTURES.includes(cobertura as (typeof COBERTURES)[number])) return { error: e.generic };

  const supabase = await createClient();
  let reservat = false;
  let alta: Alta;
  try {
    configCorreu(); // si falta configuració, que no quedi res reservat
    const { error } = await supabase.rpc("prepara_validacio_alta", { p_id: id, p_cobertura: cobertura });
    if (error) {
      console.error("Error preparant la validació", error);
      return { error: missatgeBd(error) };
    }
    reservat = true;
    alta = await llegeixAlta(id);

    let adjunts: Adjunt[];
    try {
      const fitxers = [...alta.fotos.map((p, i) => ({ p, nom: `${alta.matricula} ${FOTOS[i] ?? i + 1}` })),
        { p: alta.pc_path, nom: `${alta.matricula} PC` }, { p: alta.ft_path, nom: `${alta.matricula} FT` }];
      adjunts = await Promise.all(
        fitxers.map(async (f) => {
          const ext = extensio(f.p);
          return { nom: `${f.nom}.${ext}`, contingut: await descarregaPdf(f.p), tipus: MIME_ADJUNT[ext] };
        }),
      );
    } catch (err) {
      console.error("No s'han pogut descarregar els adjunts de l'alta", id, err);
      await rpc(supabase, "descarta_alta", { p_id: id }).catch((x) => console.error(x));
      return { error: e.documents };
    }
    // Graph no accepta correus de més de ~4 MB: millor no intentar-ho.
    if (adjunts.reduce((s, a) => s + a.contingut.length, 0) > MIDA_TOTAL_ADJUNTS) {
      await rpc(supabase, "descarta_alta", { p_id: id }).catch((x) => console.error(x));
      return { error: e.mida };
    }

    try {
      await enviaCorreu(
        correuAlta({
          matricula: alta.matricula,
          marcaModel: alta.marca_model,
          color: alta.color,
          vin: alta.vin,
          cobertura: cobertura as Alta["cobertura"],
          dataAlta: alta.data_alta,
        }),
        adjunts,
      );
    } catch (err) {
      console.error("Error enviant el correu d'alta", id, err);
      if (err instanceof ErrorCorreu && err.incert) {
        revalidatePath(RUTA);
        return { error: e.correuIncert };
      }
      await rpc(supabase, "descarta_alta", { p_id: id }).catch((x) => console.error(x));
      return { error: e.correu };
    }
    reservat = false; // el correu ha sortit: ja no es descarta

    try {
      await rpc(supabase, "confirma_alta", { p_id: id });
    } catch (err) {
      console.error("Alta enviada però no confirmada", id, err);
      revalidatePath(RUTA);
      return { error: e.correuEnviatSenseDesar };
    }
  } catch (err) {
    console.error("Error validant l'alta", err);
    if (reservat) await rpc(supabase, "descarta_alta", { p_id: id }).catch((x) => console.error(x));
    return { error: err instanceof ErrorCorreu ? e.correu : e.generic };
  }

  await avisaSollicitant(id, true);
  revalidatePath(RUTA);
  revalidatePath("/admin/vehicles");
  return { ok: t.validar.okValida };
}

/** Rebutja una Sol·licitud d'alta amb motiu (FR-6). */
export async function rebutjaAlta(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!(await obtenirUsuariActual())?.actiu) return { error: e.permis };
  const id = formData.get("id");
  const motiu = String(formData.get("motiu") ?? "").trim();
  if (!esUuid(id)) return { error: e.generic };
  if (!motiu) return { error: e.motiu };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("rebutja_alta", { p_id: id, p_motiu: motiu.slice(0, 500) });
    if (error) {
      console.error("Error rebutjant l'alta", error);
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    console.error("Error rebutjant l'alta", err);
    return { error: e.generic };
  }
  await avisaSollicitant(id, false, motiu);
  revalidatePath(RUTA);
  return { ok: t.validar.okRebutja };
}

/** Resol un enviament d'alta incert: s'ha mirat a Elements enviats. */
export async function resolAlta(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!(await obtenirUsuariActual())?.actiu) return { error: e.permis };
  const id = formData.get("id");
  const resultat = formData.get("resultat");
  if (!esUuid(id) || (resultat !== "enviat" && resultat !== "no_enviat")) return { error: e.generic };
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("resol_alta", { p_id: id, p_enviat: resultat === "enviat" });
    if (error) {
      console.error("Error resolent l'alta", error);
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    console.error("Error resolent l'alta", err);
    return { error: e.generic };
  }
  if (resultat === "enviat") await avisaSollicitant(id, true);
  revalidatePath(RUTA);
  return { ok: t.vehicles.desat };
}

/** Administració afegeix el PC i/o la FT que falten a una Sol·licitud d'alta. */
export async function afegeixDocuments(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };
  const id = formData.get("id");
  if (!esUuid(id)) return { error: e.generic };

  const llegeix = async (valor: FormDataEntryValue | null) => {
    if (!(valor instanceof File) || valor.size === 0) return null;
    if (valor.size > MIDA_FITXER) return "mida" as const;
    const bytes = new Uint8Array(await valor.arrayBuffer());
    const tipus = tipusAdjunt(bytes);
    return tipus ? { bytes, tipus } : ("tipus" as const);
  };
  const pc = await llegeix(formData.get("pc"));
  const ft = await llegeix(formData.get("ft"));
  if (pc === "mida" || ft === "mida") return { error: t.altes.errors.mida };
  if (pc === "tipus" || ft === "tipus") return { error: t.altes.errors.fitxer };
  if (!pc && !ft) return { error: t.altes.errors.documents };

  const pujats: string[] = [];
  try {
    const { data: fila, error: errF } = await createAdminClient()
      .from("vehicles_assegurats")
      .select("fotos")
      .eq("id", id)
      .single<{ fotos: string[] }>();
    if (errF) throw errF;
    const carpeta = fila.fotos[0].split("/").slice(0, 2).join("/");
    const puja = async (nom: "pc" | "ft", x: { bytes: Uint8Array; tipus: keyof typeof MIME_ADJUNT }) => {
      const path = `${carpeta}/${nom}-${crypto.randomUUID()}.${x.tipus}`;
      await pujaPdf(path, x.bytes, MIME_ADJUNT[x.tipus]);
      pujats.push(path);
      return path;
    };
    const pcPath = pc ? await puja("pc", pc) : null;
    const ftPath = ft ? await puja("ft", ft) : null;

    const supabase = await createClient();
    const { error } = await supabase.rpc("afegeix_documents_alta", { p_id: id, p_pc: pcPath, p_ft: ftPath });
    if (error) {
      console.error("Error afegint documents", error);
      await Promise.all(pujats.map(esborraPdf));
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    console.error("Error afegint documents", err);
    return { error: e.generic };
  }
  revalidatePath(RUTA);
  return { ok: t.validar.okDocuments };
}
