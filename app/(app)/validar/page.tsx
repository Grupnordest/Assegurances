import { redirect } from "next/navigation";
import { esValidadorDeQualsevol } from "@/lib/altes/regles";
import { dataCurta } from "@/lib/correu/plantilles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import { AccionsAlta, FormulariDocuments, PendentAlta } from "./formularis";

// L'enviament del correu d'alta amb adjunts (Graph) pot trigar.
export const maxDuration = 60;

type Pendent = {
  id: string;
  matricula: string;
  marca_model: string | null;
  color: string | null;
  motiu: keyof typeof t.vehicles.motius;
  cobertura: "tot_risc" | "tercers";
  data_alta: string;
  data_prevista_baixa: string | null;
  comentari: string | null;
  fotos: string[];
  pc_path: string | null;
  ft_path: string | null;
  enviament_alta: "enviant" | null;
  enviament_at: string | null;
  sollicitant: { nom: string } | null;
  centres: { nom: string } | null;
};

const eur = new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" });

export default async function ValidarPage() {
  const usuari = await exigeixUsuariActiu();
  if (!esValidadorDeQualsevol(usuari.rols)) redirect("/");
  const supabase = await createClient();

  // RLS: només surten les sol·licituds que aquest usuari pot validar.
  const { data: pendents, error } = await supabase
    .from("vehicles_assegurats")
    .select(
      "id, matricula, marca_model, color, motiu, cobertura, data_alta, data_prevista_baixa, comentari, fotos, pc_path, ft_path, enviament_alta, enviament_at, sollicitant:usuaris!vehicles_assegurats_sollicitant_id_fkey(nom), centres(nom)",
    )
    .eq("estat", "sollicitat")
    .order("created_at")
    .returns<Pendent[]>();
  if (error) throw error;

  // Fotos (bucket privat) amb enllaços temporals, i prima mitjana per Cobertura (cost orientatiu).
  const admin = createAdminClient();
  const paths = pendents.flatMap((p) => p.fotos ?? []);
  const [signades, primes] = await Promise.all([
    paths.length ? admin.storage.from("documents").createSignedUrls(paths, 600) : Promise.resolve({ data: [], error: null }),
    admin
      .from("vehicles_assegurats")
      .select("cobertura, prima_total")
      .eq("estat", "assegurat")
      .not("prima_total", "is", null)
      .returns<{ cobertura: string; prima_total: number }[]>(),
  ]);
  if (signades.error) throw signades.error;
  if (primes.error) throw primes.error;
  const url = new Map((signades.data ?? []).map((s) => [s.path, s.signedUrl]));
  const mitjana = (c: string) => {
    const v = primes.data.filter((p) => p.cobertura === c).map((p) => Number(p.prima_total));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const tv = t.validar;
  // Mentre algú l'està enviant (màx. 60 s) no es mostren els botons de resolució manual.
  const fa2min = Date.now() - 2 * 60_000;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{tv.titol}</h1>
      {pendents.length === 0 ? (
        <p className="text-gray-600">{tv.cap}</p>
      ) : (
        <ul className="space-y-4">
          {pendents.map((p) => {
            const prima = mitjana(p.cobertura);
            return (
              <li key={p.id} className="space-y-3 rounded-md border bg-white p-4">
                <div>
                  <p className="font-semibold">
                    {p.matricula} <span className="font-normal text-gray-700">{[p.marca_model, p.color].filter(Boolean).join(" · ")}</span>
                  </p>
                  <p className="text-sm text-gray-700">
                    {tv.dades(p.sollicitant?.nom ?? "—", t.vehicles.motius[p.motiu], dataCurta(p.data_alta))}
                    {p.centres?.nom && ` · ${p.centres.nom}`}
                  </p>
                  {p.data_prevista_baixa && <p className="text-sm text-gray-700">{tv.previsio(dataCurta(p.data_prevista_baixa))}</p>}
                  {p.comentari && <p className="text-sm italic text-gray-700">{p.comentari}</p>}
                  <p className="text-sm text-gray-600">{prima !== null ? tv.prima(eur.format(prima)) : tv.senseprima}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(p.fotos ?? []).map((f) =>
                    url.get(f) ? (
                      <a key={f} href={url.get(f)} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- enllaç signat temporal */}
                        <img src={url.get(f)} alt="" className="aspect-[4/3] w-full rounded object-cover" />
                      </a>
                    ) : null,
                  )}
                </div>
                {(!p.pc_path || !p.ft_path) && (
                  <div className="space-y-2">
                    <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                      {tv.falten([!p.pc_path && "PC", !p.ft_path && "FT"].filter(Boolean).join(" i "))}
                    </p>
                    {esAdmin(usuari) && <FormulariDocuments id={p.id} faltaPc={!p.pc_path} faltaFt={!p.ft_path} />}
                  </div>
                )}
                {p.enviament_alta === "enviant" ? (
                  p.enviament_at && new Date(p.enviament_at).getTime() > fa2min ? (
                    <p className="text-sm text-gray-600">{tv.enviantAra}</p>
                  ) : (
                    <PendentAlta id={p.id} />
                  )
                ) : (
                  <AccionsAlta
                    id={p.id}
                    matricula={p.matricula}
                    cobertura={p.cobertura}
                    documentsComplets={!!p.pc_path && !!p.ft_path}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
