"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { correusAmbRol, enviaAvis } from "@/lib/altes/avisos";
import { MIME_ADJUNT, tipusAdjunt } from "@/lib/altes/fitxers";
import { altaSchema, FOTOS, MIDA_FITXER, MIDA_TOTAL_ADJUNTS, rolValidador } from "@/lib/altes/regles";
import { avisSollicitudAlta } from "@/lib/correu/plantilles";
import { descarregaPdf, esborraPdf, pujaPdf } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalitzaMatricula } from "@/lib/estoc/matricula";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { obtenirUsuariActual } from "@/lib/usuari-actual";

const e = t.altes.errors;

export type ResultatCerca =
  | { error: string }
  | { aEstoc: false }
  | {
      aEstoc: true;
      matricula: string;
      descripcio: string;
      estatObert: string | null;
      responsable: string | null;
      docsPrevis: boolean;
    };

/** Cerca una matrícula a l'Estoc vigent (qualsevol usuari actiu). */
export async function cercaMatricula(valor: string): Promise<ResultatCerca> {
  if (!(await obtenirUsuariActual())?.actiu) return { error: e.permis };
  const matricula = normalitzaMatricula(valor).slice(0, 10);
  if (!/^[A-Z0-9]{4,10}$/.test(matricula)) return { error: e.matricula };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cerca_estoc", { p_matricula: matricula });
    if (error) throw error;
    const r = data as {
      a_estoc: boolean;
      marca?: string | null;
      model?: string | null;
      color?: string | null;
      estat_obert?: string | null;
      responsable?: string | null;
      docs_previs?: boolean;
    };
    if (!r.a_estoc) return { aEstoc: false };
    return {
      aEstoc: true,
      matricula,
      descripcio: [r.marca, r.model, r.color].filter(Boolean).join(" · "),
      estatObert: r.estat_obert ?? null,
      responsable: r.responsable ?? null,
      docsPrevis: !!r.docs_previs,
    };
  } catch (err) {
    console.error("Error cercant a l'estoc", err);
    return { error: e.generic };
  }
}

export type EstatAlta = { error?: string; ok?: string };

/** Llegeix i valida un fitxer del formulari. null si no n'hi ha. */
async function fitxer(valor: FormDataEntryValue | null, nomesImatge: boolean) {
  if (!(valor instanceof File) || valor.size === 0) return null;
  if (valor.size > MIDA_FITXER) return { error: e.mida };
  const bytes = new Uint8Array(await valor.arrayBuffer());
  const tipus = tipusAdjunt(bytes);
  if (!tipus || (nomesImatge && tipus === "pdf")) return { error: e.fitxer };
  return { bytes, tipus };
}

function missatgeBd(err: { code?: string; message?: string }): string {
  const m = err.message ?? "";
  if (err.code === "42501") return e.permis;
  if (m.includes("fora_estoc")) return e.foraEstoc;
  if (m.includes("ja_assegurat") || err.code === "23505") return e.jaAssegurat;
  if (m.includes("data_passada")) return e.data;
  if (m.includes("data_prevista")) return e.dataPrevista;
  if (m.includes("documents")) return e.documents;
  if (m.includes("fotos")) return e.fotos;
  return e.generic;
}

/** Crea la Sol·licitud d'alta (FR-5): puja fotos i documents i avisa els Validadors. */
export async function creaAlta(_prev: EstatAlta, formData: FormData): Promise<EstatAlta> {
  const usuari = await obtenirUsuariActual();
  if (!usuari?.actiu) return { error: e.permis };

  const parsed = altaSchema(e).safeParse({
    matricula: normalitzaMatricula(formData.get("matricula")),
    motiu: formData.get("motiu") ?? "",
    dataAlta: formData.get("dataAlta") ?? "",
    centre: formData.get("centre") ?? "",
    cobertura: formData.get("cobertura") ?? "",
    dataPrevista: formData.get("dataPrevista") ?? "",
    comentari: formData.get("comentari") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? e.generic };
  const d = parsed.data;

  const fotos = [];
  for (const f of FOTOS) {
    const r = await fitxer(formData.get(`foto_${f}`), true);
    if (!r) return { error: e.fotos };
    if ("error" in r) return { error: r.error };
    fotos.push({ nom: f, ...r });
  }
  const pcR = await fitxer(formData.get("pc"), false);
  const ftR = await fitxer(formData.get("ft"), false);
  if (pcR && "error" in pcR) return { error: pcR.error };
  if (ftR && "error" in ftR) return { error: ftR.error };
  const pc = pcR, ft = ftR;
  // O tots dos documents nous o cap (llavors es reaprofiten els d'una alta anterior).
  if (!!pc !== !!ft) return { error: e.documents };
  let total = [...fotos, ...(pc && ft ? [pc, ft] : [])].reduce((s, x) => s + x.bytes.length, 0);
  if (!pc) {
    // Es reaprofiten el PC i la FT d'una alta anterior: també compten per al límit del correu.
    try {
      total += await midaDocsPrevis(d.matricula);
    } catch (err) {
      console.error("No s'han pogut llegir els documents anteriors", err);
      return { error: e.documents };
    }
  }
  if (total > MIDA_TOTAL_ADJUNTS) return { error: e.mida };

  const carpeta = `altes/${crypto.randomUUID()}`;
  const pujats: string[] = [];
  const puja = async (nom: string, x: { bytes: Uint8Array; tipus: keyof typeof MIME_ADJUNT }) => {
    const path = `${carpeta}/${nom}.${x.tipus}`;
    await pujaPdf(path, x.bytes, MIME_ADJUNT[x.tipus]);
    pujats.push(path);
    return path;
  };

  try {
    const fotosPaths = [];
    for (const f of fotos) fotosPaths.push(await puja(f.nom, f));
    const pcPath = pc ? await puja("pc", pc) : null;
    const ftPath = ft ? await puja("ft", ft) : null;

    const supabase = await createClient();
    const { error } = await supabase.rpc("crea_sollicitud_alta", {
      p_matricula: d.matricula,
      p_motiu: d.motiu,
      p_data_alta: d.dataAlta,
      p_centre: d.centre,
      p_cobertura: d.cobertura,
      p_fotos: fotosPaths,
      p_pc: pcPath,
      p_ft: ftPath,
      p_data_prevista: d.dataPrevista,
      p_comentari: d.comentari,
    });
    if (error) {
      // Resposta de la base de dades: la sol·licitud no s'ha creat, es pot netejar.
      console.error("Error creant la sol·licitud d'alta", error);
      await Promise.all(pujats.map(esborraPdf));
      return { error: missatgeBd(error) };
    }
  } catch (err) {
    // Sense resposta: potser s'ha creat igualment, així que no s'esborren els fitxers.
    console.error("Error a la sol·licitud d'alta", err);
    return { error: e.generic };
  }

  // La sol·licitud ja està creada: un error a l'avís no la desfà.
  try {
    const supabase = await createClient();
    const { data: estoc } = await supabase.rpc("cerca_estoc", { p_matricula: d.matricula });
    const origen = (await headers()).get("origin") ?? "";
    await enviaAvis(
      avisSollicitudAlta({
        matricula: d.matricula,
        marcaModel: [estoc?.marca, estoc?.model].filter(Boolean).join(" ") || null,
        motiu: t.vehicles.motius[d.motiu],
        sollicitant: usuari.nom,
        dataAlta: d.dataAlta,
        enllac: `${origen}/validar`,
      }),
      await destinatarisValidacio(d.motiu),
    );
  } catch (err) {
    console.error("No s'ha pogut avisar els validadors", err);
  }

  revalidatePath("/altes");
  return { ok: t.altes.ok };
}

/** Mida (bytes) del PC i la FT de l'última alta de la matrícula que en tingui. */
async function midaDocsPrevis(matricula: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("vehicles_assegurats")
    .select("pc_path, ft_path")
    .eq("matricula", matricula)
    .not("pc_path", "is", null)
    .not("ft_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ pc_path: string; ft_path: string }>();
  if (error) throw error;
  if (!data) return 0;
  const [pc, ft] = await Promise.all([descarregaPdf(data.pc_path), descarregaPdf(data.ft_path)]);
  return pc.length + ft.length;
}

/** Validadors del Motiu; si no n'hi ha cap d'actiu, Administració (perquè algú ho vegi). */
async function destinatarisValidacio(motiu: Parameters<typeof rolValidador>[0]): Promise<string[]> {
  const adreces = await correusAmbRol([rolValidador(motiu)]);
  return adreces.length ? adreces : correusAmbRol(["administracio"]);
}
