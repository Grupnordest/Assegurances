import "server-only";
import { destinatarisAvis } from "../correu/config";
import { configCorreu, enviaCorreu, ErrorCorreu } from "../correu/graph";
import {
  correuAvis,
  correuBaixa,
  correuBaixaAvisFallida,
  correuBaixaPendentPolissa,
  correuExcepcioAvis,
  type Correu,
} from "../correu/plantilles";
import { avuiMadrid } from "../dies-laborables";
import { descarregaPdf } from "../documents";
import { extornEsperat } from "../extorns/calcula";
import { createAdminClient } from "../supabase/admin";
import {
  avisQueToca,
  esDataMante,
  esDataReal,
  passaEscalat,
  respostesDe,
  type AvisPrevi,
  type Resposta,
  type TipusAvis,
} from "./regles";
import { nouTestimoni } from "./testimoni";

type Admin = ReturnType<typeof createAdminClient>;
type Usuari = { id: string; email: string; nom: string; admin: boolean };

/** Adreça pública de l'eina (per als enllaços dels correus de la revisió diària). */
function urlApp(): string {
  const u = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (!u) throw new Error("Falta la variable APP_URL");
  return u;
}

async function usuarisActius(admin: Admin): Promise<Map<string, Usuari>> {
  const { data, error } = await admin
    .from("usuaris")
    .select("id, email, nom, usuari_rols(rol)")
    .eq("actiu", true)
    .returns<{ id: string; email: string; nom: string; usuari_rols: { rol: string }[] }[]>();
  if (error) throw error;
  return new Map(
    data.map((u) => [u.id, { id: u.id, email: u.email, nom: u.nom, admin: u.usuari_rols.some((r) => r.rol === "administracio") }]),
  );
}

/** Envia un correu a un usuari (en proves, a l'adreça de proves). No llança: registra l'error. */
async function envia(correu: Correu, a: Usuari): Promise<boolean> {
  try {
    const dest = destinatarisAvis(configCorreu(), [a.email]);
    if (!dest) return false;
    await enviaCorreu(correu, [], dest);
    return true;
  } catch (err) {
    console.error("No s'ha pogut enviar l'avís", correu.assumpte, a.email, err);
    return false;
  }
}

/** Màxim d'Avisos nous per execució: la primera revisió pot trobar molts vehicles; la resta, l'endemà. */
export const MAX_NOUS_PER_REVISIO = 20;

/** Crea un enllaç personal per a cada destinatari i li envia l'Avís. Retorna quants correus han sortit. */
async function enviaAvisA(
  admin: Admin,
  avisId: string,
  destinataris: Usuari[],
  correu: (enllac: string) => Correu,
): Promise<number> {
  let enviats = 0;
  for (const u of destinataris) {
    const t = nouTestimoni();
    const { error } = await admin
      .from("avis_enllacos")
      .insert({ avis_id: avisId, usuari_id: u.id, testimoni_hash: t.hash, caduca: t.caduca });
    if (error) {
      console.error("No s'ha pogut crear l'enllaç de l'avís", avisId, error);
      continue;
    }
    if (await envia(correu(`${urlApp()}/avis/${t.testimoni}`), u)) enviats++;
  }
  return enviats;
}

type VehicleRevisio = {
  id: string;
  matricula: string;
  marca_model: string | null;
  motiu: string | null;
  estat: string;
  data_alta: string | null;
  data_prevista_baixa: string | null;
  responsable_efectiu_id: string | null;
  validat_per: string | null;
};

export type ResultatRevisio = { creats: number; escalats: number; excepcions: number; errors: number };

/** Revisió diària (FR-13, FR-14, FR-15, FR-16, FR-32). Idempotent: es pot executar diverses vegades. */
export async function revisaAvisos(ara = new Date()): Promise<ResultatRevisio> {
  const admin = createAdminClient();
  const avui = avuiMadrid(ara);
  const r: ResultatRevisio = { creats: 0, escalats: 0, excepcions: 0, errors: 0 };
  const usuaris = await usuarisActius(admin);
  const admins = [...usuaris.values()].filter((u) => u.admin);
  const fitxa = `${urlApp()}/admin/vehicles?veure=tots`;

  const [{ data: vehicles, error: errV }, { data: baixes, error: errB }, { data: avisos, error: errA }] = await Promise.all([
    admin
      .from("vehicles_llista")
      .select("id, matricula, marca_model, motiu, estat, data_alta, data_prevista_baixa, responsable_efectiu_id, validat_per")
      .eq("estat", "assegurat")
      .returns<VehicleRevisio[]>(),
    admin
      .from("baixes")
      .select("vehicle_id")
      .in("estat", ["pendent_polissa", "enviant", "enviada", "anullant"])
      .returns<{ vehicle_id: string }[]>(),
    admin
      .from("avisos")
      .select("id, vehicle_id, tipus, clau, estat, resposta, resolt_at, nivell, enviat_at, escalat_at")
      .returns<(AvisPrevi & { id: string; vehicle_id: string; nivell: number; enviat_at: string; escalat_at: string | null })[]>(),
  ]);
  if (errV) throw errV;
  if (errB) throw errB;
  if (errA) throw errA;
  const perId = new Map(vehicles.map((v) => [v.id, v]));
  const ambBaixa = new Set(baixes.map((b) => b.vehicle_id));

  // 1. Escalat dels Avisos pendents sense resposta.
  for (const a of avisos.filter((x) => x.estat === "pendent")) {
    try {
      const v = perId.get(a.vehicle_id);
      const accio = passaEscalat(a, ara);
      if (!accio) continue;
      // Si el vehicle ja no està assegurat o té baixa en curs, l'Avís ja no té sentit.
      if (!v || ambBaixa.has(a.vehicle_id)) {
        await admin.from("avisos").update({ estat: "cancelat" }).eq("id", a.id).eq("estat", "pendent");
        continue;
      }
      if (accio === "escala") {
        const validador = v.validat_per ? usuaris.get(v.validat_per) : undefined;
        const responsable = v.responsable_efectiu_id ? usuaris.get(v.responsable_efectiu_id) : undefined;
        const dest = validador && validador.id !== responsable?.id ? [validador] : admins;
        // Si el primer avís ja va anar a Administració (sense Responsable), no se'ls torna a enviar.
        const jaElsTenien = !responsable && dest === admins;
        const { data: ok, error } = await admin
          .from("avisos")
          .update({ nivell: 1, escalat_at: ara.toISOString() })
          .eq("id", a.id)
          .eq("estat", "pendent")
          .eq("nivell", 0)
          .select("id");
        if (error) throw error;
        if (!ok?.length) continue;
        if (!jaElsTenien)
          await enviaAvisA(admin, a.id, dest, (enllac) =>
          correuAvis({
            tipus: a.tipus as TipusAvis,
            matricula: v.matricula,
            marcaModel: v.marca_model,
            dataAlta: v.data_alta,
            dataPrevista: v.data_prevista_baixa,
            senseResposta: responsable?.nom ?? "El Responsable",
            enllac,
          }),
        );
        r.escalats++;
      } else {
        const { data: ok, error } = await admin
          .from("avisos")
          .update({ estat: "excepcio" })
          .eq("id", a.id)
          .eq("estat", "pendent")
          .select("id");
        if (error) throw error;
        if (!ok?.length) continue;
        for (const u of admins) await envia(correuExcepcioAvis({ matricula: v.matricula, marcaModel: v.marca_model, enllac: fitxa }), u);
        r.excepcions++;
      }
    } catch (err) {
      console.error("Error escalant l'avís", a.id, err);
      r.errors++;
    }
  }

  // 2. Avisos nous.
  const { data: actuals, error: errA2 } = await admin
    .from("avisos")
    .select("vehicle_id, tipus, clau, estat, resposta, resolt_at")
    .returns<(AvisPrevi & { vehicle_id: string })[]>();
  if (errA2) throw errA2;
  for (const v of vehicles) {
    if (r.creats >= MAX_NOUS_PER_REVISIO) break;
    try {
      const previs = actuals.filter((a) => a.vehicle_id === v.id);
      const toca = avisQueToca({ ...v, baixaEnCurs: ambBaixa.has(v.id) }, previs, avui);
      if (!toca) continue;
      const responsable = v.responsable_efectiu_id ? usuaris.get(v.responsable_efectiu_id) : undefined;
      const dest = responsable ? [responsable] : admins;
      const { data: nou, error } = await admin
        .from("avisos")
        .insert({ vehicle_id: v.id, tipus: toca.tipus, clau: toca.clau, enviat_at: ara.toISOString() })
        .select("id")
        .single<{ id: string }>();
      if (error) {
        if (error.code === "23505") continue; // ja creat (execució simultània) o ja n'hi ha un de pendent
        throw error;
      }
      const enviats = await enviaAvisA(admin, nou.id, dest, (enllac) =>
        correuAvis({
          tipus: toca.tipus,
          matricula: v.matricula,
          marcaModel: v.marca_model,
          dataAlta: v.data_alta,
          dataPrevista: v.data_prevista_baixa,
          enllac,
        }),
      );
      if (enviats === 0) {
        // Ningú l'ha rebut: s'esborra perquè la revisió següent el torni a crear (i no s'escali en fals).
        await admin.from("avisos").delete().eq("id", nou.id);
        r.errors++;
        continue;
      }
      r.creats++;
    } catch (err) {
      console.error("Error creant l'avís", v.matricula, err);
      r.errors++;
    }
  }
  return r;
}

export type AvisObert = {
  id: string;
  tipus: TipusAvis;
  vehicle: { id: string; matricula: string; marca_model: string | null; data_alta: string | null; data_prevista_baixa: string | null };
};

/** Avís pendent a partir del testimoni d'un enllaç vigent. null si no existeix, ha caducat o ja s'ha resolt. */
export async function avisDelTestimoni(hash: string): Promise<{ avis: AvisObert; usuariId: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("avis_enllacos")
    .select(
      "usuari_id, caduca, avisos!inner(id, tipus, estat, vehicles_assegurats!inner(id, matricula, marca_model, data_alta, data_prevista_baixa))",
    )
    .eq("testimoni_hash", hash)
    .maybeSingle<{
      usuari_id: string;
      caduca: string;
      avisos: { id: string; tipus: TipusAvis; estat: string; vehicles_assegurats: AvisObert["vehicle"] };
    }>();
  if (error) throw error;
  if (!data || data.avisos.estat !== "pendent" || new Date(data.caduca) < new Date()) return null;
  const { data: u } = await admin.from("usuaris").select("actiu").eq("id", data.usuari_id).single<{ actiu: boolean }>();
  if (!u?.actiu) return null;
  return {
    usuariId: data.usuari_id,
    avis: { id: data.avisos.id, tipus: data.avisos.tipus, vehicle: data.avisos.vehicles_assegurats },
  };
}

/** Pot respondre des de la safata (amb sessió): té un enllaç de l'Avís, o és Administració. */
export async function usuariPotRespondre(avisId: string, usuariId: string, esAdministracio = false): Promise<boolean> {
  if (esAdministracio) return true;
  const { data, error } = await createAdminClient()
    .from("avis_enllacos")
    .select("id")
    .eq("avis_id", avisId)
    .eq("usuari_id", usuariId)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

export type ResultatResposta = { ok: string } | { error: string };

const M = {
  resolt: "Aquest avís ja s'ha resolt o ha caducat.",
  data: "Tria una data a partir d'avui.",
  dataFutura: "Tria una data posterior a avui i com a molt d'aquí a un any.",
  jaBaixa: "Aquest vehicle ja té una baixa en curs.",
  correu: "No s'ha pogut enviar la baixa a la corredoria. Administració ho revisarà.",
  incert: "La baixa s'està enviant; Administració comprovarà que hagi sortit.",
  generic: "No s'ha pogut desar la resposta. Torna-ho a provar.",
  okBaixa: (d: string) => `Fet: s'ha enviat la baixa amb data ${d} a la corredoria.`,
  okPendent: (d: string) => `Fet: baixa amb data ${d} registrada. Administració hi afegirà la pòlissa i l'enviarà.`,
  okMante: "Fet: es manté assegurat.",
  okManteFins: (d: string) => `Fet: es manté fins al ${d}. T'avisarem aquell dia.`,
};
const curta = (s: string) => s.split("-").reverse().join("/");

/** Resol un Avís en nom d'un usuari (des del correu o des de la safata). */
export async function respon(avisId: string, usuariId: string, resposta: Resposta, data: string | null): Promise<ResultatResposta> {
  const admin = createAdminClient();
  const avui = avuiMadrid();
  try {
    const { data: a, error } = await admin
      .from("avisos")
      .select("id, tipus, estat, vehicles_assegurats!inner(id, matricula, prima_total, polissa_path)")
      .eq("id", avisId)
      .single<{
        id: string;
        tipus: TipusAvis;
        estat: string;
        vehicles_assegurats: { id: string; matricula: string; prima_total: number | null; polissa_path: string | null };
      }>();
    if (error) throw error;
    if (a.estat !== "pendent" || !respostesDe(a.tipus).includes(resposta)) return { error: M.resolt };
    const v = a.vehicles_assegurats;

    if (resposta === "mante" || resposta === "mante_fins") {
      if (resposta === "mante_fins" && !esDataMante(data, avui)) return { error: M.dataFutura };
      const { error: e2 } = await admin.rpc("resol_avis", {
        p_avis: avisId,
        p_usuari: usuariId,
        p_resposta: resposta,
        p_data: resposta === "mante_fins" ? data : null,
      });
      if (e2) return { error: e2.message.includes("avis_resolt") ? M.resolt : M.generic };
      return { ok: resposta === "mante" ? M.okMante : M.okManteFins(curta(data!)) };
    }

    // Baixa (FR-11 des d'un Avís): crear la baixa i resoldre l'Avís és una sola transacció.
    if (!esDataReal(data) || data < avui) return { error: M.data };
    const { data: baixaId, error: eB } = await admin.rpc("respon_baixa_avis", {
      p_avis: avisId,
      p_usuari: usuariId,
      p_data: data,
      p_extorn: extornEsperat(v.prima_total === null ? null : Number(v.prima_total), data),
      p_polissa: v.polissa_path,
    });
    if (eB) {
      if (eB.message.includes("avis_resolt")) return { error: M.resolt };
      return { error: eB.message.includes("ja_baixa") ? M.jaBaixa : M.generic };
    }

    if (!v.polissa_path) {
      const { data: qui } = await admin.from("usuaris").select("nom").eq("id", usuariId).single<{ nom: string }>();
      await avisaAdmins(
        admin,
        correuBaixaPendentPolissa({ matricula: v.matricula, dataBaixa: data, qui: qui?.nom ?? "—", enllac: `${urlApp()}/admin/vehicles?veure=tots` }),
      );
      return { ok: M.okPendent(curta(data)) };
    }

    // Amb pòlissa: s'envia ara (dues fases, com la baixa d'Administració).
    try {
      const config = configCorreu();
      const contingut = await descarregaPdf(v.polissa_path);
      await enviaCorreu(correuBaixa({ matricula: v.matricula, dataBaixa: data, signatura: config.signatura }), [
        { nom: `POL. ${v.matricula}.pdf`, contingut, tipus: "application/pdf" },
      ]);
    } catch (err) {
      console.error("Error enviant la baixa des d'un avís", baixaId, err);
      if (err instanceof ErrorCorreu && err.incert) return { ok: M.incert };
      // Ha fallat segur: la baixa queda fallida, l'Avís es reobre i Administració ho sap.
      await admin.rpc("falla_baixa_avis", { p_baixa: baixaId });
      await avisaAdmins(admin, correuBaixaAvisFallida({ matricula: v.matricula, dataBaixa: data, enllac: `${urlApp()}/admin/vehicles?veure=tots` }));
      return { error: M.correu };
    }
    const { error: eC } = await admin.rpc("confirma_baixa_avis", { p_baixa: baixaId, p_usuari: usuariId });
    if (eC) {
      console.error("Baixa enviada des d'un avís però no confirmada", baixaId, eC);
      return { ok: M.incert };
    }
    return { ok: M.okBaixa(curta(data)) };
  } catch (err) {
    console.error("Error responent l'avís", avisId, err);
    return { error: M.generic };
  }
}

/** Correu a tots els usuaris d'Administració actius. No llança. */
async function avisaAdmins(admin: Admin, correu: Correu): Promise<void> {
  try {
    const usuaris = await usuarisActius(admin);
    for (const u of usuaris.values()) if (u.admin) await envia(correu, u);
  } catch (err) {
    console.error("No s'ha pogut avisar Administració", correu.assumpte, err);
  }
}
