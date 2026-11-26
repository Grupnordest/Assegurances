"use server";

import { revalidatePath } from "next/cache";
import { avisDelTestimoni, respon, usuariPotRespondre, type ResultatResposta } from "@/lib/avisos/servidor";
import type { Resposta } from "@/lib/avisos/regles";
import { esTestimoni, hashTestimoni } from "@/lib/avisos/testimoni";
import { esAdmin, obtenirUsuariActual } from "@/lib/usuari-actual";

export type EstatResposta = Partial<ResultatResposta> & { ok?: string; error?: string };

const RESPOSTES: Resposta[] = ["baixa", "mante", "mante_fins"];
const esData = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function llegeix(formData: FormData) {
  const resposta = formData.get("resposta");
  const data = formData.get("data");
  return {
    resposta: RESPOSTES.includes(resposta as Resposta) ? (resposta as Resposta) : null,
    data: esData(data) ? data : null,
  };
}

/** Resposta des de l'enllaç del correu (sense sessió): el testimoni identifica l'Avís i qui respon. */
export async function respostaPerEnllac(_prev: EstatResposta, formData: FormData): Promise<EstatResposta> {
  const testimoni = formData.get("testimoni");
  const { resposta, data } = llegeix(formData);
  if (!esTestimoni(testimoni) || !resposta) return { error: "Resposta no vàlida." };
  const obert = await avisDelTestimoni(hashTestimoni(testimoni));
  if (!obert) return { error: "Aquest avís ja s'ha resolt o ha caducat." };
  return respon(obert.avis.id, obert.usuariId, resposta, data);
}

/** Resposta des de la safata d'Inici (amb sessió): l'usuari ha de ser un destinatari de l'Avís. */
export async function respostaAmbSessio(_prev: EstatResposta, formData: FormData): Promise<EstatResposta> {
  const usuari = await obtenirUsuariActual();
  if (!usuari?.actiu) return { error: "No tens permís per fer aquesta acció." };
  const avisId = formData.get("avis");
  const { resposta, data } = llegeix(formData);
  if (typeof avisId !== "string" || !/^[0-9a-f-]{36}$/i.test(avisId) || !resposta) return { error: "Resposta no vàlida." };
  const admin = esAdmin(usuari);
  if (!(await usuariPotRespondre(avisId, usuari.id, admin))) return { error: "No tens permís per fer aquesta acció." };
  const r = await respon(avisId, usuari.id, resposta, data, admin);
  // Administració: actualitza la safata d'Incidències i el comptador del menú.
  if (admin && "ok" in r) revalidatePath("/admin/incidencies");
  return r;
}
