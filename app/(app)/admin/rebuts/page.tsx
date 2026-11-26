import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import FormulariRebuts from "./formulari";

type Linia = {
  id: string;
  num_rebut: string;
  matricula: string;
  clase: string;
  tipus: "emissio" | "extorn";
  inici: string;
  fi: string;
  prima_total: number | string;
  vehicle_id: string | null;
  baixa_id: string | null;
  fitxer: string;
};

const eur = new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" });
const data = (s: string) => s.split("-").reverse().join("/");

export default async function RebutsPage() {
  if (!esAdmin(await exigeixUsuariActiu())) redirect("/");
  const { data: linies, error } = await (await createClient())
    .from("rebuts")
    .select("id, num_rebut, matricula, clase, tipus, inici, fi, prima_total, vehicle_id, baixa_id, fitxer")
    .order("created_at", { ascending: false })
    .order("num_rebut", { ascending: false })
    .limit(50)
    .returns<Linia[]>();
  if (error) throw error;

  const tr = t.rebuts;
  const c = tr.columnes;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{tr.titol}</h1>
      <FormulariRebuts />

      <h2 className="text-lg font-semibold">{tr.ultimes}</h2>
      {linies.length === 0 ? (
        <p className="rounded-md border bg-white p-4 text-gray-700">{tr.capLinia}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2">{c.rebut}</th>
                <th className="px-3 py-2">{c.matricula}</th>
                <th className="px-3 py-2">{c.clase}</th>
                <th className="px-3 py-2">{c.cobertura}</th>
                <th className="px-3 py-2 text-right">{c.import}</th>
                <th className="px-3 py-2">{c.casament}</th>
                <th className="px-3 py-2">{c.fitxer}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {linies.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{l.num_rebut}</td>
                  <td className="px-3 py-2 font-medium">{l.matricula}</td>
                  <td className="px-3 py-2">{l.clase}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {data(l.inici)} – {data(l.fi)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{eur.format(Number(l.prima_total))}</td>
                  <td className="px-3 py-2">
                    {tr.casament({ tipus: l.tipus, vehicle: l.vehicle_id !== null, baixa: l.baixa_id !== null })}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2 text-gray-600" title={l.fitxer}>
                    {l.fitxer}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
