import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import { CATEGORIES, llegeixEstatFlota } from "./dades";
import { BotoEnvia, FormulariInicial, FormulariLlista, PendentFlota } from "./formularis";

// L'enviament del correu (Graph) pot trigar.
export const maxDuration = 60;

const dataHora = new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });
const quan = (s: string) => dataHora.format(new Date(s));
const caixa = "space-y-3 rounded-md border bg-white p-4";

function Matricules({ titol, llista }: { titol: string; llista: string[] }) {
  if (llista.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{titol}</p>
      <p className="font-mono text-sm text-gray-700">{llista.join(" · ")}</p>
    </div>
  );
}

export default async function FlotaPage() {
  if (!esAdmin(await exigeixUsuariActiu())) redirect("/");
  const tf = t.flota;
  const supabase = await createClient();
  const estat = await llegeixEstatFlota(supabase);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{tf.titol}</h1>
      <p className="text-sm text-gray-700">{tf.intro}</p>

      <div className={caixa}>
        <p className={`text-sm ${estat.estoc ? "text-gray-700" : "text-amber-900"}`}>
          {estat.estoc ? tf.estoc(quan(estat.estoc.data_estoc), estat.estoc.num_vehicles) : tf.senseEstoc}
        </p>
      </div>

      <div className={caixa}>
        <p className="font-medium">{tf.llistes.titol}</p>
        <p className="text-sm text-gray-600">{tf.llistes.ajuda}</p>
        {CATEGORIES.map((c) => {
          const l = estat.llistes.find((x) => x.categoria === c);
          return (
            <div key={c} className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">{tf.llistes[c]}</p>
              <p className="text-sm text-gray-700">
                {l ? tf.llistes.resum(l.vehicles.length, l.nom_fitxer, quan(l.updated_at)) : tf.llistes.cap}
              </p>
              <FormulariLlista categoria={c} teLlista={!!l} />
            </div>
          );
        })}
      </div>

      {!estat.ultim && estat.historial.length === 0 && (
        <div className={caixa}>
          <p className="font-medium">{tf.inicial.titol}</p>
          <p className="text-sm text-gray-600">{tf.inicial.ajuda}</p>
          <FormulariInicial />
        </div>
      )}

      {estat.pendent && <PendentFlota id={estat.pendent.id} />}

      <div className={caixa}>
        <p className="font-medium">{tf.previa.titol}</p>
        <p className="text-sm">{tf.previa.total(estat.actual.length)}</p>
        {estat.ultim ? (
          <>
            <p className="text-sm text-gray-700">
              {tf.previa.respecteA(quan(estat.ultim.enviat_at ?? estat.ultim.created_at), estat.ultim.num_vehicles)}
            </p>
            {estat.altes.length === 0 && estat.baixes.length === 0 ? (
              <p className="text-sm text-gray-700">{tf.previa.senseCanvis}</p>
            ) : (
              <>
                <Matricules titol={tf.previa.altes(estat.altes.length)} llista={estat.altes} />
                <Matricules titol={tf.previa.baixes(estat.baixes.length)} llista={estat.baixes} />
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-amber-900">{tf.previa.senseInicial}</p>
        )}
        <BotoEnvia
          total={estat.actual.length}
          altes={estat.altes.length}
          baixes={estat.baixes.length}
          desactivat={!estat.estoc || !estat.ultim || !!estat.pendent || estat.actual.length === 0}
        />
      </div>

      <div className={caixa}>
        <p className="font-medium">{tf.historial.titol}</p>
        {estat.historial.length === 0 ? (
          <p className="text-sm text-gray-600">{tf.historial.cap}</p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-700">
            {estat.historial.map((h) => (
              <li key={h.id}>
                {tf.historial.fila(quan(h.enviat_at ?? h.created_at), h.num_vehicles, h.altes.length, h.baixes.length)}
                {" · "}
                {h.origen === "inicial" ? tf.historial.inicial : tf.historial.estats[h.estat]}
                {h.proves && ` · ${tf.historial.proves}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
