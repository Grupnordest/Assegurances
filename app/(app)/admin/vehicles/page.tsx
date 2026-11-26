import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import FilaVehicle, { type VehicleFila } from "./fila-vehicle";
import FormulariLlistat from "./formulari-llistat";
import PujadaPolisses from "./pujada-polisses";
import type { FilaDescartada } from "@/lib/flota/llegeix-llistat";
import { textDescartades } from "./regles";
import { avuiMadrid } from "@/lib/dies-laborables";

type Fila = VehicleFila & { responsable_nom: string | null };
type Carrega = {
  num_vehicles: number;
  descartades: FilaDescartada[];
  created_at: string;
  usuaris: { nom: string } | null;
};

const dataHora = new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

// L'enviament del correu (Graph) pot trigar: les Server Actions d'aquesta pàgina tenen fins a 60 s.
export const maxDuration = 60;

const eurTancat = new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" });
const dataCurtaMadrid = new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeZone: "Europe/Madrid" });

type BaixaEnCurs = {
  id: string;
  vehicle_id: string;
  estat: "pendent_polissa" | "enviant" | "enviada" | "anullant";
  data_baixa: string;
  extorn_esperat: number | null;
  extorn_liquidat: number | null;
  liquidada_at: string | null;
  updated_at: string;
};

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ veure?: string }> }) {
  if (!esAdmin(await exigeixUsuariActiu())) redirect("/");

  const { veure } = await searchParams;
  const tots = veure === "tots";
  const supabase = await createClient();

  const [{ data: vehicles, error }, { data: carrega, error: errCarrega }] = await Promise.all([
    supabase
      .from("vehicles_llista")
      .select(
        "id, matricula, marca_model, estat, cobertura, franquicia, data_alta, prima_total, nota, motiu, responsable_id, centre_id, data_prevista_baixa, pendent, responsable_nom, updated_at",
      )
      .not("estat", "in", "(rebutjat,tancat)")
      .order("matricula")
      .returns<Fila[]>(),
    supabase
      .from("carregues_flota")
      .select("num_vehicles, descartades, created_at, usuaris(nom)")
      .limit(1)
      .maybeSingle<Carrega>(),
  ]);
  if (error) throw error;
  if (errCarrega) throw errCarrega;

  const tv = t.vehicles;
  // La càrrega inicial només es pot fer una vegada (encara que després els vehicles es tanquin).
  if (!carrega) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">{tv.titol}</h1>
        <FormulariLlistat />
      </section>
    );
  }

  const [
    { data: usuaris, error: errU },
    { data: centres, error: errC },
    { data: cap, error: errCap },
    { data: ambPolissa, error: errPol },
    { data: baixes, error: errB },
    { data: tancats, error: errT },
  ] = await Promise.all([
      supabase.from("usuaris").select("id, nom").eq("actiu", true).order("nom").returns<{ id: string; nom: string }[]>(),
      supabase.from("centres").select("id, nom").order("id").returns<{ id: number; nom: string }[]>(),
      supabase
        .from("usuaris")
        .select("nom, usuari_rols!inner(rol)")
        .eq("actiu", true)
        .eq("usuari_rols.rol", "cap_postvenda")
        .order("nom")
        .limit(1)
        .maybeSingle<{ nom: string }>(),
      supabase
        .from("vehicles_assegurats")
        .select("id")
        .not("polissa_path", "is", null)
        .returns<{ id: string }[]>(),
      supabase
        .from("baixes")
        .select("id, vehicle_id, estat, data_baixa, extorn_esperat, extorn_liquidat, liquidada_at, updated_at")
        .in("estat", ["pendent_polissa", "enviant", "enviada", "anullant"])
        .returns<BaixaEnCurs[]>(),
      // Vehicles Tancats amb l'extorn liquidat els últims 30 dies (per veure "Extorn liquidat X €").
      supabase
        .from("baixes")
        .select("id, data_baixa, extorn_liquidat, liquidada_at, vehicles_assegurats!inner(matricula, estat)")
        .eq("vehicles_assegurats.estat", "tancat")
        .gte("liquidada_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order("liquidada_at", { ascending: false })
        .returns<
          {
            id: string;
            data_baixa: string;
            extorn_liquidat: number | string;
            liquidada_at: string;
            vehicles_assegurats: { matricula: string; estat: string };
          }[]
        >(),
    ]);
  if (errU) throw errU;
  if (errC) throw errC;
  if (errCap) throw errCap;
  if (errPol) throw errPol;
  if (errB) throw errB;
  if (errT) throw errT;

  const avui = avuiMadrid();
  const tePolissa = new Set(ambPolissa.map((p) => p.id));
  const fa2min = Date.now() - 2 * 60_000;
  const baixaDe = new Map(
    baixes.map((b) => [
      b.vehicle_id,
      {
        id: b.id,
        estat: b.estat,
        data_baixa: b.data_baixa,
        extorn_esperat: b.extorn_esperat === null ? null : Number(b.extorn_esperat),
        extorn_liquidat: b.extorn_liquidat === null ? null : Number(b.extorn_liquidat),
        liquidada_at: b.liquidada_at,
        recent: new Date(b.updated_at).getTime() > fa2min,
      },
    ]),
  );

  const pendents = vehicles.filter((v) => v.pendent).length;
  const mostrats = tots ? vehicles : vehicles.filter((v) => v.pendent);
  const pestanya = (actiu: boolean) =>
    `inline-flex min-h-11 items-center rounded-md px-4 text-sm ${actiu ? "bg-gray-900 text-white" : "border bg-white"}`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{tv.titol}</h1>
        <p className="text-sm text-gray-700">{tv.comptador(vehicles.length - pendents, vehicles.length)}</p>
      </div>

      <div className="space-y-1 rounded-md border bg-white p-3 text-sm text-gray-700">
        <p>
          {tv.carrega.resum(carrega.num_vehicles, dataHora.format(new Date(carrega.created_at)), carrega.usuaris?.nom ?? "—")}
        </p>
        {carrega.descartades.length > 0 && <p className="text-amber-900">{textDescartades(carrega.descartades)}</p>}
      </div>

      <PujadaPolisses
        vehicles={vehicles.map((v) => ({
          id: v.id,
          matricula: v.matricula,
          tePolissa: tePolissa.has(v.id),
          baixaPendent: baixaDe.get(v.id)?.estat === "pendent_polissa",
        }))}
      />

      <nav className="flex flex-wrap gap-2">
        <Link href="/admin/vehicles" className={pestanya(!tots)}>
          {tv.pendents} ({pendents})
        </Link>
        <Link href="/admin/vehicles?veure=tots" className={pestanya(tots)}>
          {tv.tots} ({vehicles.length})
        </Link>
      </nav>

      {mostrats.length === 0 ? (
        <p className="text-gray-600">{tv.capPendent}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-white">
          {mostrats.map((v) => (
            <FilaVehicle
              key={v.id}
              vehicle={v}
              usuaris={usuaris}
              centres={centres}
              capPostvenda={cap?.nom ?? null}
              avui={avui}
              baixa={baixaDe.get(v.id) ?? null}
              tePolissa={tePolissa.has(v.id)}
            />
          ))}
        </ul>
      )}

      {tancats.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{tv.baixa.tancatsRecents}</h2>
          <ul className="divide-y rounded-md border bg-white">
            {tancats.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4 text-sm">
                <span className="font-semibold">{b.vehicles_assegurats.matricula}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{tv.estats.tancat}</span>
                <span className="text-gray-700">
                  {tv.baixa.donat(b.data_baixa.split("-").reverse().join("/"))} ·{" "}
                  {tv.baixa.liquidat(eurTancat.format(Number(b.extorn_liquidat)), dataCurtaMadrid.format(new Date(b.liquidada_at)))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
