"use server";

import { revalidatePath } from "next/cache";
import { configCorreu, enviaCorreu, ErrorCorreu, type Adjunt } from "@/lib/correu/graph";
import { correuAnullacio, correuBaixa, dataCurta } from "@/lib/correu/plantilles";
import { avuiMadrid } from "@/lib/dies-laborables";
import { descarregaPdf, esborraPdf, pujaPdf } from "@/lib/documents";
import { extornEsperat } from "@/lib/extorns/calcula";
import { llegeixRelacioExcel, llegeixRelacioPdf } from "@/lib/flota/llegeix-relacio";
import { esPdf, MIME, tipusDocument, type TipusDocument } from "@/lib/pdf";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";
import {
  anullacioSchema,
  baixaSchema,
  MIDA_PDF,
  missatgeErrorRelacio,
  missatgeErrorVehicles,
  resolucioSchema,
} from "./regles";

export type EstatAccio = { error?: string; ok?: string };

const e = t.vehicles.errors;

type Relacio = { fitxer: string; nom_fitxer: string; data_relacio: string; matricules: string[] };
type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Llegeix un PDF del formulari. null si falta; string si és un error. */
async function pdfDelFormulari(valor: FormDataEntryValue | null): Promise<Uint8Array | string | null> {
  if (!(valor instanceof File) || valor.size === 0) return null;
  if (valor.size > MIDA_PDF) return e.pdfMida;
  const bytes = new Uint8Array(await valor.arrayBuffer());
  return esPdf(bytes) ? bytes : e.pdf;
}

/** Crida una funció de reversió i en registra l'error (no es pot fer res més si falla). */
async function revertir(supabase: Supabase, fn: string, args: Record<string, unknown>) {
  try {
    const { error } = await supabase.rpc(fn, args);
    if (error) console.error(`Error a ${fn}`, args, error);
  } catch (err) {
    console.error(`Error a ${fn}`, args, err);
  }
}

/** Puja la Relació de Flota VO (PDF d'AXA o Excel de Proassa). La vigent és la de data d'AXA més recent. */
export async function carregaRelacio(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };

  const fitxer = formData.get("fitxer");
  if (!(fitxer instanceof File) || fitxer.size === 0) return { error: e.senseFitxer };
  if (fitxer.size > MIDA_PDF) return { error: e.pdfMida };
  const bytes = new Uint8Array(await fitxer.arrayBuffer());
  const tipus = tipusDocument(bytes);
  if (!tipus) return { error: e.relacioTipus };

  const lectura = tipus === "pdf" ? await llegeixRelacioPdf(bytes) : llegeixRelacioExcel(bytes, fitxer.name);
  if (!lectura.ok) return { error: missatgeErrorRelacio(lectura.error) };

  const path = `relacions/${crypto.randomUUID()}.${tipus}`;
  try {
    await pujaPdf(path, bytes, MIME[tipus]);
  } catch (err) {
    console.error("Error pujant la relació", err);
    return { error: e.document };
  }
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("registra_relacio", {
      p_data: lectura.data,
      p_fitxer: path,
      p_nom_fitxer: fitxer.name,
      p_matricules: lectura.matricules,
    });
    if (error) {
      console.error("Error registrant la relació", error);
      await esborraPdf(path);
      return { error: missatgeErrorVehicles(error) };
    }
  } catch (err) {
    console.error("Error registrant la relació", err);
    await esborraPdf(path);
    return { error: e.generic };
  }

  revalidatePath("/admin/vehicles");
  return { ok: t.vehicles.relacio.ok(dataCurta(lectura.data), lectura.matricules.length) };
}

/**
 * Baixa real (FR-11 + FR-9 + FR-23). Dues fases perquè correu i estat no es desquadrin:
 * prepara (reserva) → envia → confirma. Si és segur que el correu no ha sortit, es descarta;
 * si no se sap (timeout, o el correu ha sortit però no s'ha pogut desar), la reserva es queda
 * "pendent de confirmar" i Administració ho resol a la fila del vehicle.
 */
export async function donaDeBaixa(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };

  const parsed = baixaSchema.safeParse({ id: formData.get("id"), dataBaixa: formData.get("dataBaixa") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? e.dades };
  const { id, dataBaixa } = parsed.data;
  if (dataBaixa < avuiMadrid()) return { error: e.dataBaixa };

  const supabase = await createClient();
  let baixaId: string | null = null;
  let justificantNou: string | null = null;

  try {
    const [{ data: vehicle, error: errV }, { data: relacio, error: errR }] = await Promise.all([
      supabase
        .from("vehicles_assegurats")
        .select("matricula, estat, prima_total")
        .eq("id", id)
        .maybeSingle<{ matricula: string; estat: string; prima_total: number | null }>(),
      supabase
        .from("relacio_flota_vigent")
        .select("fitxer, nom_fitxer, data_relacio, matricules")
        .maybeSingle<Relacio>(),
    ]);
    if (errV) throw errV;
    if (errR) throw errR;
    if (!vehicle) return { error: e.noTrobat };
    if (vehicle.estat === "baixa_enviada" || vehicle.estat === "donat_de_baixa") return { error: e.jaBaixa };
    if (vehicle.estat !== "assegurat") return { error: e.estatBaixa };

    // Justificant: la relació vigent si hi surt la matrícula; si no, el PDF que s'adjunta.
    const ambRelacio = !!relacio && relacio.matricules.includes(vehicle.matricula);
    let adjunt: Adjunt;
    if (ambRelacio) {
      const ext = (relacio!.fitxer.split(".").pop() ?? "pdf") as TipusDocument;
      adjunt = {
        nom: `Relacio Flota VO ${dataCurta(relacio!.data_relacio).replaceAll("/", "-")}.${ext}`,
        contingut: await descarregaPdf(relacio!.fitxer),
        tipus: MIME[ext] ?? MIME.pdf,
      };
    } else {
      const pdf = await pdfDelFormulari(formData.get("justificant"));
      if (pdf === null) return { error: e.justificant };
      if (typeof pdf === "string") return { error: pdf };
      adjunt = { nom: `Justificant ${vehicle.matricula}.pdf`, contingut: pdf, tipus: "application/pdf" };
    }

    const config = configCorreu();

    const { data: reserva, error: errP } = await supabase.rpc("prepara_baixa", {
      p_vehicle: id,
      p_data: dataBaixa,
      p_tipus: ambRelacio ? "relacio" : "nou_titular",
      p_extorn: extornEsperat(vehicle.prima_total === null ? null : Number(vehicle.prima_total), dataBaixa),
    });
    if (errP) {
      console.error("Error preparant la baixa", errP);
      return { error: errP.message?.includes("data_passada") ? e.dataBaixa : missatgeErrorVehicles(errP) };
    }
    baixaId = String(reserva);

    // El justificant es desa abans d'enviar: si l'enviament queda incert, "Sí, ha sortit" el conserva.
    let justificantPath = relacio?.fitxer ?? null;
    if (!ambRelacio) {
      justificantPath = `justificants/${baixaId}.pdf`;
      await pujaPdf(justificantPath, adjunt.contingut);
      justificantNou = justificantPath;
    }
    const { error: errJ } = await supabase.rpc("desa_justificant", { p_baixa: baixaId, p_justificant: justificantPath });
    if (errJ) throw errJ;

    try {
      const correu = correuBaixa({
        matricula: vehicle.matricula,
        dataBaixa,
        justificant: ambRelacio ? "relacio" : "nou_titular",
        signatura: config.signatura,
      });
      await enviaCorreu(correu, [adjunt]);
    } catch (err) {
      console.error("Error enviant el correu de baixa", baixaId, err);
      if (err instanceof ErrorCorreu && err.incert) {
        revalidatePath("/admin/vehicles");
        return { error: e.correuIncert };
      }
      await revertir(supabase, "descarta_baixa", { p_baixa: baixaId });
      if (justificantNou) await esborraPdf(justificantNou);
      return { error: e.correu };
    }

    // A partir d'aquí el correu ha sortit: mai es descarta la reserva.
    baixaId = null;
    try {
      const { error: errC } = await supabase.rpc("confirma_baixa", {
        p_baixa: String(reserva),
        p_justificant: justificantPath,
      });
      if (errC) throw errC;
    } catch (err) {
      console.error("Correu de baixa enviat però no confirmat", reserva, err);
      revalidatePath("/admin/vehicles");
      return { error: e.correuEnviatSenseDesar };
    }
  } catch (err) {
    // Errors abans d'enviar el correu: és segur desfer la reserva.
    console.error("Error a la baixa", err);
    if (baixaId) await revertir(supabase, "descarta_baixa", { p_baixa: baixaId });
    if (baixaId && justificantNou) await esborraPdf(justificantNou);
    return { error: err instanceof ErrorCorreu ? e.correu : e.generic };
  }

  revalidatePath("/admin/vehicles");
  return { ok: t.vehicles.baixa.ok };
}

/** Anul·la una baixa enviada (abans del dia de la baixa) i ho comunica a la Corredoria. */
export async function anulaBaixa(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };

  const parsed = anullacioSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: e.noTrobat };
  const supabase = await createClient();
  let baixaId: string | null = null;

  try {
    const config = configCorreu();
    const { data: reserva, error: errI } = await supabase.rpc("comenca_anullacio", { p_vehicle: parsed.data.id });
    if (errI) {
      console.error("Error començant l'anul·lació", errI);
      return { error: missatgeErrorVehicles(errI) };
    }
    baixaId = String(reserva);

    const { data: baixa, error: errB } = await supabase
      .from("baixes")
      .select("data_baixa, vehicles_assegurats(matricula)")
      .eq("id", baixaId)
      .single<{ data_baixa: string; vehicles_assegurats: { matricula: string } }>();
    if (errB) throw errB;

    try {
      await enviaCorreu(
        correuAnullacio({
          matricula: baixa.vehicles_assegurats.matricula,
          dataBaixa: baixa.data_baixa,
          signatura: config.signatura,
        }),
      );
    } catch (err) {
      console.error("Error enviant el correu d'anul·lació", baixaId, err);
      if (err instanceof ErrorCorreu && err.incert) {
        revalidatePath("/admin/vehicles");
        return { error: e.correuIncert };
      }
      await revertir(supabase, "reverteix_anullacio", { p_baixa: baixaId });
      return { error: e.correuAnula };
    }

    const enviada = baixaId;
    baixaId = null;
    try {
      const { error: errA } = await supabase.rpc("anula_baixa", { p_baixa: enviada });
      if (errA) throw errA;
    } catch (err) {
      console.error("Correu d'anul·lació enviat però no desat", enviada, err);
      revalidatePath("/admin/vehicles");
      return { error: e.correuEnviatSenseDesar };
    }
  } catch (err) {
    console.error("Error anul·lant la baixa", err);
    if (baixaId) await revertir(supabase, "reverteix_anullacio", { p_baixa: baixaId });
    return { error: err instanceof ErrorCorreu ? e.correuAnula : e.generic };
  }

  revalidatePath("/admin/vehicles");
  return { ok: t.vehicles.baixa.okAnula };
}

/** Resol a mà un enviament incert: Administració ha mirat a Elements enviats. */
export async function resolEnviament(_prev: EstatAccio, formData: FormData): Promise<EstatAccio> {
  if (!esAdmin(await obtenirUsuariActual())) return { error: e.permis };

  const parsed = resolucioSchema.safeParse({
    id: formData.get("id"),
    tipus: formData.get("tipus"),
    resultat: formData.get("resultat"),
  });
  if (!parsed.success) return { error: e.dades };
  const { id, tipus, resultat } = parsed.data;

  const crida =
    tipus === "baixa"
      ? resultat === "enviat"
        ? { fn: "confirma_baixa", args: { p_baixa: id, p_justificant: null } }
        : { fn: "descarta_baixa", args: { p_baixa: id } }
      : resultat === "enviat"
        ? { fn: "anula_baixa", args: { p_baixa: id } }
        : { fn: "reverteix_anullacio", args: { p_baixa: id } };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc(crida.fn, crida.args);
    if (error) {
      console.error(`Error a ${crida.fn}`, error);
      return { error: missatgeErrorVehicles(error) };
    }
  } catch (err) {
    console.error(`Error a ${crida.fn}`, err);
    return { error: e.generic };
  }

  revalidatePath("/admin/vehicles");
  return { ok: t.vehicles.desat };
}
