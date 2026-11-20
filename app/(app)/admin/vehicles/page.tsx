import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import FilaVehicle, { type VehicleFila } from "./fila-vehicle";
import FormulariLlistat from "./formulari-llistat";
import type { FilaDescartada } from "@/lib/flota/llegeix-llistat";
import { textDescartades } from "./regles";
import FormulariRelacio from "./formulari-relacio";
import { avuiMadrid } from "@/lib/dies-laborables";
import { dataCurta } from "@/lib/correu/plantilles";

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

type BaixaEnCurs = {
  id: string;
  vehicle_id: string;
  estat: "enviant" | "enviada" | "anullant";
  data_baixa: string;
  extorn_esperat: number | null;
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
    { data: relacio, error: errR },
    { data: baixes, error: errB },
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
        .from("relacio_flota_vigent")
        .select("data_relacio, matricules")
        .maybeSingle<{ data_relacio: string; matricules: string[] }>(),
      supabase
        .from("baixes")
        .select("id, vehicle_id, estat, data_baixa, extorn_esperat, updated_at")
        .in("estat", ["enviant", "enviada", "anullant"])
        .returns<BaixaEnCurs[]>(),
    ]);
  if (errU) throw errU;
  if (errC) throw errC;
  if (errCap) throw errCap;
  if (errR) throw errR;
  if (errB) throw errB;

  const avui = avuiMadrid();
  const aRelacio = new Set(relacio?.matricules ?? []);
  const relacioData = relacio ? dataCurta(relacio.data_relacio) : null;
  const fa2min = Date.now() - 2 * 60_000;
  const baixaDe = new Map(
    baixes.map((b) => [
      b.vehicle_id,
      {
        id: b.id,
        estat: b.estat,
        data_baixa: b.data_baixa,
        extorn_esperat: b.extorn_esperat === null ? null : Number(b.extorn_esperat),
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

      <FormulariRelacio vigent={relacio ? tv.relacio.vigent(relacioData!, relacio.matricules.length) : null} />

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
              relacioData={aRelacio.has(v.matricula) ? relacioData : null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
