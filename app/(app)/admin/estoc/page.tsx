import { redirect } from "next/navigation";
import { diesLaborablesDes, MAX_DIES_ESTOC } from "@/lib/dies-laborables";
import { normalitzaMatricula } from "@/lib/estoc/matricula";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import FormulariEstoc from "./formulari-estoc";

type Carrega = {
  data_estoc: string;
  fitxer: string;
  num_vehicles: number;
  descartats: number;
  created_at: string;
  usuaris: { nom: string } | null;
};

type Vehicle = {
  matricula: string;
  marca: string | null;
  model: string | null;
  color: string | null;
  dies_estoc: number | null;
};

const LIMIT = 50;
const dataHora = new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function EstocPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  if (!esAdmin(await exigeixUsuariActiu())) redirect("/");

  const { q: qParam } = await searchParams;
  const q = Array.isArray(qParam) ? qParam[0] : qParam;
  const cerca = normalitzaMatricula(q ?? "").slice(0, 10);
  const supabase = await createClient();

  const { data: ultima, error } = await supabase
    .from("estoc_carregues")
    .select("data_estoc, fitxer, num_vehicles, descartats, created_at, usuaris(nom)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<Carrega>();
  if (error) throw error;

  let resultats: Vehicle[] = [];
  if (cerca && ultima) {
    // normalitzaMatricula deixa només A-Z i 0-9: no hi pot haver comodins (% _ *).
    const { data, error: errCerca } = await supabase
      .from("estoc_vigent")
      .select("matricula, marca, model, color, dies_estoc")
      .like("matricula", `%${cerca}%`)
      .order("matricula")
      .limit(LIMIT + 1)
      .returns<Vehicle[]>();
    if (errCerca) throw errCerca;
    resultats = data;
  }

  // PRD FR-3: dies laborables sense càrrega d'Estoc (des de la darrera pujada).
  const dies = ultima ? diesLaborablesDes(new Date(ultima.created_at), new Date()) : 0;
  const c = t.estoc.cerca.columnes;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t.estoc.titol}</h1>

      {ultima && dies > MAX_DIES_ESTOC && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{t.estoc.antic(dies)}</p>
      )}

      <div className="rounded-md border bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">{t.estoc.ultima}</h2>
        {ultima ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Dada etiqueta={t.estoc.dataEstoc} valor={dataHora.format(new Date(ultima.data_estoc))} />
            <Dada etiqueta={t.estoc.vehicles} valor={String(ultima.num_vehicles)} />
            <Dada etiqueta={t.estoc.carregatPer} valor={ultima.usuaris?.nom ?? "—"} />
            <Dada etiqueta={t.estoc.carregatEl} valor={dataHora.format(new Date(ultima.created_at))} />
            {ultima.descartats > 0 && <Dada etiqueta={t.estoc.descartats} valor={String(ultima.descartats)} />}
          </dl>
        ) : (
          <p className="text-gray-600">{t.estoc.cap}</p>
        )}
      </div>

      <FormulariEstoc />

      {ultima && (
        <div className="space-y-3">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-sm text-gray-600">{t.estoc.cerca.etiqueta}</span>
              <input name="q" defaultValue={q ?? ""} autoComplete="off" className="rounded-md border px-3 py-2 uppercase" />
            </label>
            <button type="submit" className="min-h-11 rounded-md border px-4">
              {t.estoc.cerca.boto}
            </button>
          </form>

          {cerca && resultats.length === 0 && <p className="text-gray-600">{t.estoc.cerca.capResultat(cerca)}</p>}
          {resultats.length > LIMIT && <p className="text-sm text-gray-600">{t.estoc.cerca.massa}</p>}
          {resultats.length > 0 && (
            <ul className="divide-y rounded-md border bg-white">
              {resultats.slice(0, LIMIT).map((v) => (
                <li key={v.matricula} className="p-3 text-sm">
                  <p className="font-medium">{v.matricula}</p>
                  <p className="text-gray-700">
                    {[v.marca, v.model].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="text-gray-600">
                    {c.color}: {v.color ?? "—"} · {c.dies}: {v.dies_estoc ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Dada({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}
