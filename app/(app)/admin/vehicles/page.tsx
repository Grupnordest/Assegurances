import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import FilaVehicle, { type VehicleFila } from "./fila-vehicle";
import FormulariLlistat from "./formulari-llistat";
import type { FilaDescartada } from "@/lib/flota/llegeix-llistat";
import { textDescartades } from "./regles";

type Fila = VehicleFila & { responsable_nom: string | null };
type Carrega = {
  num_vehicles: number;
  descartades: FilaDescartada[];
  created_at: string;
  usuaris: { nom: string } | null;
};

const dataHora = new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

/** Data d'avui a Madrid ("YYYY-MM-DD"). */
const avuiMadrid = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

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

  const [{ data: usuaris, error: errU }, { data: centres, error: errC }, { data: cap, error: errCap }] =
    await Promise.all([
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
    ]);
  if (errU) throw errU;
  if (errC) throw errC;
  if (errCap) throw errCap;

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
              avui={avuiMadrid()}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
