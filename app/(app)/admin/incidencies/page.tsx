import Link from "next/link";
import { redirect } from "next/navigation";
import FormulariResposta from "@/app/avis/[testimoni]/formulari-resposta";
import { sumaDies, type TipusAvis } from "@/lib/avisos/regles";
import { avuiMadrid } from "@/lib/dies-laborables";
import { llistaIncidencies, NOM_TIPUS, type Incidencia } from "@/lib/incidencies/llista";
import { createClient } from "@/lib/supabase/server";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import FormulariTanca from "./formulari-tanca";
import {
  BotoCreaDeCartera,
  BotoReclama,
  FormulariAcceptaExtorn,
  FormulariDescartaCartera,
  FormulariDescartaRebut,
} from "./formularis-extorns";

// Respondre "baixa" envia el correu a la corredoria.
export const maxDuration = 60;

const dataHora = new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function IncidenciesPage() {
  if (!esAdmin(await exigeixUsuariActiu())) redirect("/");
  const incidencies = await llistaIncidencies(await createClient());
  const avui = avuiMadrid();

  const pendents = incidencies.filter((i) => i.tipus === "extorn_pendent");
  const altres = incidencies.filter((i) => i.tipus !== "extorn_pendent");
  // Mateix criteri i mateix rellotge que la llista (esPerReclamar).
  const perReclamar = pendents.filter((i) => i.perReclamar).length;

  const fitxa = (i: Incidencia, n: number) => (
    <li key={`${i.tipus}-${i.avisId ?? i.baixaId ?? i.carteraLiniaId ?? i.rebutId ?? i.vehicle ?? n}`} className="space-y-2 rounded-md border bg-white p-4">
      <p className="text-sm text-gray-500">
        {NOM_TIPUS[i.tipus]} · {dataHora.format(new Date(i.data))}
      </p>
      {i.matricula && <p className="font-semibold">{i.matricula}</p>}
      <p className="text-sm text-gray-700">{i.descripcio}</p>
      {i.avisId && i.tipusAvis ? (
        <div className="space-y-4">
          <FormulariResposta
            tipus={i.tipusAvis as TipusAvis}
            avisId={i.avisId}
            inicial={null}
            avui={avui}
            dema={sumaDies(avui, 1)}
          />
          <FormulariTanca avisId={i.avisId} />
        </div>
      ) : i.tipus === "extorn_incorrecte" && i.baixaId ? (
        <FormulariAcceptaExtorn baixaId={i.baixaId} />
      ) : i.carteraLiniaId ? (
        <div className="space-y-3">
          {i.tipus === "cartera_sense_control" && i.matricula && (
            <BotoCreaDeCartera liniaId={i.carteraLiniaId} matricula={i.matricula} />
          )}
          {i.enllac && (
            <Link href={i.enllac} className="inline-flex min-h-11 items-center text-blue-700 hover:underline">
              Resoldre →
            </Link>
          )}
          <FormulariDescartaCartera liniaId={i.carteraLiniaId} />
        </div>
      ) : i.rebutId ? (
        <div className="space-y-2">
          {i.enllac && (
            <Link href={i.enllac} className="inline-flex min-h-11 items-center text-blue-700 hover:underline">
              Resoldre →
            </Link>
          )}
          <FormulariDescartaRebut rebutId={i.rebutId} />
        </div>
      ) : (
        i.enllac && (
          <Link href={i.enllac} className="inline-flex min-h-11 items-center text-blue-700 hover:underline">
            Resoldre →
          </Link>
        )
      )}
    </li>
  );

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Incidències</h1>
      {incidencies.length === 0 ? (
        <p className="rounded-md border bg-white p-4 text-gray-700">No hi ha incidències.</p>
      ) : (
        <>
          {pendents.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">
                {NOM_TIPUS.extorn_pendent} ({pendents.length})
              </h2>
              <BotoReclama perReclamar={perReclamar} />
              <ul className="space-y-3">{pendents.map(fitxa)}</ul>
            </div>
          )}
          {altres.length > 0 && <ul className="space-y-3">{altres.map(fitxa)}</ul>}
        </>
      )}
    </section>
  );
}
