import { dataCurta } from "@/lib/correu/plantilles";
import { avuiMadrid } from "@/lib/dies-laborables";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { exigeixUsuariActiu } from "@/lib/usuari-actual";
import FormulariAlta from "./formulari-alta";

// L'enviament dels avisos (Graph) pot trigar.
export const maxDuration = 60;

type Meva = {
  id: string;
  matricula: string;
  estat: keyof typeof t.vehicles.estats;
  data_alta: string | null;
  motiu_rebuig: string | null;
};

export default async function AltesPage() {
  const usuari = await exigeixUsuariActiu();
  const supabase = await createClient();
  const [{ data: centres, error: errC }, { data: meves, error: errM }] = await Promise.all([
    supabase.from("centres").select("id, nom").order("id").returns<{ id: number; nom: string }[]>(),
    supabase
      .from("vehicles_assegurats")
      .select("id, matricula, estat, data_alta, motiu_rebuig")
      .eq("sollicitant_id", usuari.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<Meva[]>(),
  ]);
  if (errC) throw errC;
  if (errM) throw errM;
  const ta = t.altes;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{ta.titol}</h1>
      <FormulariAlta centres={centres} centreDefecte={usuari.centre?.id ?? null} avui={avuiMadrid()} />

      <div className="space-y-2 rounded-md border bg-white p-4">
        <p className="font-medium">{ta.meves}</p>
        {meves.length === 0 ? (
          <p className="text-sm text-gray-600">{ta.capMeva}</p>
        ) : (
          <ul className="space-y-2 text-sm text-gray-700">
            {meves.map((m) => (
              <li key={m.id}>
                {ta.fila(m.matricula, m.data_alta ? dataCurta(m.data_alta) : "—", t.vehicles.estats[m.estat])}
                {m.motiu_rebuig && <span className="block text-red-800">{ta.rebutjada(m.motiu_rebuig)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
