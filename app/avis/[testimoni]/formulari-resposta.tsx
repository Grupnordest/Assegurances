"use client";

import { useActionState, useState } from "react";
import { MAX_DIES_MANTE, sumaDies, type Resposta, type TipusAvis } from "@/lib/avisos/regles";
import { respostaAmbSessio, respostaPerEnllac, type EstatResposta } from "./actions";

const boto = "min-h-11 rounded-md px-4 font-medium disabled:opacity-60";

const ETIQUETES: Record<TipusAvis, Record<Resposta, string>> = {
  set_dies: { baixa: "Ja es pot donar de baixa", mante_fins: "Encara el necessito fins al…", mante: "" },
  data_prevista: { baixa: "Ja es pot donar de baixa", mante_fins: "Encara el necessito fins al…", mante: "" },
  demo_4m: { baixa: "Donar-lo de baixa", mante_fins: "Es manté fins al…", mante: "" },
  vs_12m: { baixa: "Donar-lo de baixa", mante: "Es manté", mante_fins: "" },
};

/** Formulari de resposta a un Avís: per enllaç (testimoni) o des de la safata (avisId amb sessió). */
export default function FormulariResposta({
  tipus,
  testimoni,
  avisId,
  inicial,
  avui,
  dema,
}: {
  tipus: TipusAvis;
  testimoni?: string;
  avisId?: string;
  inicial: Resposta | null;
  avui: string;
  dema: string;
}) {
  const [estat, accio, pendent] = useActionState<EstatResposta, FormData>(
    testimoni ? respostaPerEnllac : respostaAmbSessio,
    {},
  );
  const opcions = (Object.keys(ETIQUETES[tipus]) as Resposta[]).filter((r) => ETIQUETES[tipus][r]);
  const [resposta, setResposta] = useState<Resposta>(inicial && opcions.includes(inicial) ? inicial : opcions[0]);
  const ambData = resposta !== "mante";
  const minim = resposta === "mante_fins" ? dema : avui;

  if (estat.ok) return <p className="rounded-md bg-green-50 p-3 text-green-800">{estat.ok}</p>;

  return (
    <form action={accio} className="space-y-3">
      {testimoni && <input type="hidden" name="testimoni" value={testimoni} />}
      {avisId && <input type="hidden" name="avis" value={avisId} />}
      <fieldset className="space-y-2">
        {opcions.map((r) => (
          <label key={r} className="flex min-h-11 items-center gap-2 rounded-md border bg-white px-3">
            <input type="radio" name="resposta" value={r} checked={resposta === r} onChange={() => setResposta(r)} />
            <span>{ETIQUETES[tipus][r]}</span>
          </label>
        ))}
      </fieldset>
      {ambData && (
        <label className="block space-y-1">
          <span className="block text-sm text-gray-600">{resposta === "baixa" ? "Data de baixa" : "Fins al"}</span>
          <input
            key={resposta}
            type="date"
            name="data"
            required
            min={minim}
            max={resposta === "mante_fins" ? sumaDies(avui, MAX_DIES_MANTE) : undefined}
            defaultValue={minim}
            className="w-full rounded-md border bg-white px-3 py-2 sm:w-auto"
          />
        </label>
      )}
      <button type="submit" disabled={pendent} className={`${boto} w-full bg-blue-700 text-white sm:w-auto`}>
        {pendent ? "Desant…" : "Confirmar"}
      </button>
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-red-800">{estat.error}</p>}
    </form>
  );
}
