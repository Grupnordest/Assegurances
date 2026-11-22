import FormulariResposta from "@/app/avis/[testimoni]/formulari-resposta";
import { sumaDies, type TipusAvis } from "@/lib/avisos/regles";
import { dataCurta } from "@/lib/correu/plantilles";
import { avuiMadrid } from "@/lib/dies-laborables";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import BotoRevisa from "./boto-revisa";

// Respondre "baixa" des de la safata envia el correu a la corredoria.
export const maxDuration = 60;

type AvisMeu = {
  avisos: {
    id: string;
    tipus: TipusAvis;
    estat: string;
    vehicles_assegurats: { matricula: string; marca_model: string | null; data_alta: string | null; data_prevista_baixa: string | null };
  };
};

const PREGUNTA: Record<TipusAvis, string> = {
  set_dies: "Fa 7 dies que està assegurat i no té data prevista de baixa.",
  data_prevista: "Ha arribat la data prevista de baixa.",
  vs_12m: "VS assegurat des de fa més de 12 mesos.",
  demo_4m: "Fa 4 mesos que està assegurat i no té data prevista de baixa.",
};

export default async function IniciPage() {
  const usuari = await exigeixUsuariActiu();
  const supabase = await createClient();

  // Safata: Avisos pendents dels quals l'usuari és destinatari (RLS).
  const { data: enllacos, error } = await supabase
    .from("avis_enllacos")
    .select("avisos!inner(id, tipus, estat, vehicles_assegurats!inner(matricula, marca_model, data_alta, data_prevista_baixa))")
    .eq("usuari_id", usuari.id)
    .eq("avisos.estat", "pendent")
    .returns<AvisMeu[]>();
  if (error) throw error;
  const avisos = [...new Map(enllacos.map((e) => [e.avisos.id, e.avisos])).values()];
  const avui = avuiMadrid();

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t.inici.hola(usuari.nom)}</h1>

      <div className="space-y-3 rounded-md border bg-white p-4">
        <p className="font-medium">Els meus avisos</p>
        {avisos.length === 0 ? (
          <p className="text-sm text-gray-600">No tens cap avís pendent.</p>
        ) : (
          <ul className="space-y-4">
            {avisos.map((a) => (
              <li key={a.id} className="space-y-2 border-t pt-3">
                <p>
                  <span className="font-semibold">{a.vehicles_assegurats.matricula}</span>{" "}
                  <span className="text-gray-700">{a.vehicles_assegurats.marca_model}</span>
                </p>
                <p className="text-sm text-gray-700">
                  {PREGUNTA[a.tipus]}
                  {a.vehicles_assegurats.data_alta && ` Alta: ${dataCurta(a.vehicles_assegurats.data_alta)}.`}
                </p>
                <FormulariResposta tipus={a.tipus} avisId={a.id} inicial={null} avui={avui} dema={sumaDies(avui, 1)} />
              </li>
            ))}
          </ul>
        )}
        {esAdmin(usuari) && <BotoRevisa />}
      </div>

      <dl className="space-y-2 rounded-md border bg-white p-4">
        <div>
          <dt className="text-sm text-gray-500">{t.inici.centre}</dt>
          <dd>{usuari.centre?.nom ?? t.inici.senseCentre}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t.inici.rols}</dt>
          <dd>{usuari.rols.length ? usuari.rols.map((r) => t.rols[r]).join(", ") : t.inici.senseRols}</dd>
        </div>
      </dl>
    </section>
  );
}
