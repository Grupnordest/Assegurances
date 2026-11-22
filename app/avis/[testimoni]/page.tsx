import { avisDelTestimoni } from "@/lib/avisos/servidor";
import type { Resposta } from "@/lib/avisos/regles";
import { sumaDies } from "@/lib/avisos/regles";
import { esTestimoni, hashTestimoni } from "@/lib/avisos/testimoni";
import { dataCurta } from "@/lib/correu/plantilles";
import { avuiMadrid } from "@/lib/dies-laborables";
import FormulariResposta from "./formulari-resposta";

// La baixa envia el correu a la corredoria (Graph): fins a 60 s.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Pàgina pública de resposta a un Avís (enllaç personal del correu, sense entrar amb Microsoft). */
export default async function AvisPage({
  params,
  searchParams,
}: {
  params: Promise<{ testimoni: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { testimoni } = await params;
  const { r } = await searchParams;
  const obert = esTestimoni(testimoni) ? await avisDelTestimoni(hashTestimoni(testimoni)) : null;
  const avui = avuiMadrid();

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-8">
      <p className="font-semibold">Control d&apos;assegurances</p>
      {!obert ? (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900">
          Aquest avís ja s&apos;ha resolt o ha caducat. Si cal fer algun canvi, entra a l&apos;eina.
        </p>
      ) : (
        <>
          <div className="space-y-1 rounded-md border bg-white p-4">
            <p className="text-lg font-semibold">{obert.avis.vehicle.matricula}</p>
            {obert.avis.vehicle.marca_model && <p className="text-gray-700">{obert.avis.vehicle.marca_model}</p>}
            {obert.avis.vehicle.data_alta && (
              <p className="text-sm text-gray-600">Assegurat des del {dataCurta(obert.avis.vehicle.data_alta)}</p>
            )}
            {obert.avis.vehicle.data_prevista_baixa && (
              <p className="text-sm text-gray-600">Data prevista de baixa: {dataCurta(obert.avis.vehicle.data_prevista_baixa)}</p>
            )}
          </div>
          <FormulariResposta
            tipus={obert.avis.tipus}
            testimoni={testimoni}
            inicial={(r as Resposta) ?? null}
            avui={avui}
            dema={sumaDies(avui, 1)}
          />
        </>
      )}
    </main>
  );
}
