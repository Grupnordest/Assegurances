"use client";

import { useActionState, useState } from "react";
import { t } from "@/lib/textos";
import { importaRebuts, type EstatImportacio } from "./actions";
import { MAX_FITXERS, MIDA_MAXIMA } from "./regles";

/** Pujada d'un o diversos Excel de rebuts, amb el resum per fitxer. */
export default function FormulariRebuts() {
  const [estat, accio, pendent] = useActionState<EstatImportacio, FormData>(importaRebuts, {});
  const [avis, setAvis] = useState<string | null>(null);
  const tr = t.rebuts;

  return (
    <div className="space-y-3 rounded-md border bg-white p-4">
      <p className="text-sm text-gray-600">{tr.ajuda}</p>
      <form action={accio} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="fitxers"
          multiple
          required
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={(e) => {
            const llista = [...(e.target.files ?? [])];
            // Tota la pujada va en una sola petició (límit de 5 MB a next.config.ts).
            const total = llista.reduce((s, f) => s + f.size, 0);
            setAvis(
              llista.length > MAX_FITXERS
                ? tr.errors.massaFitxers(MAX_FITXERS)
                : total > MIDA_MAXIMA
                  ? tr.massaGran
                  : null,
            );
          }}
          className="min-w-0 max-w-full text-sm"
        />
        <button
          type="submit"
          disabled={pendent || avis !== null}
          className="min-h-11 rounded-md bg-blue-700 px-4 font-medium text-white disabled:opacity-60"
        >
          {pendent ? tr.carregant : tr.boto}
        </button>
      </form>
      {avis && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{avis}</p>}
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{estat.error}</p>}
      {!pendent && estat.fitxers && (
        <ul className="space-y-2">
          {estat.fitxers.map((f, i) => (
            <li
              key={`${f.nom}-${i}`}
              className={`space-y-1 rounded-md p-3 text-sm ${f.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"}`}
            >
              <p className="font-medium break-all">{f.nom}</p>
              {f.error && <p>{f.error}</p>}
              {f.resum && <p>{tr.resumFitxer(f.resum)}</p>}
              {f.resum && tr.detallFitxer(f.resum) && <p>{tr.detallFitxer(f.resum)}</p>}
              {f.resum && f.resum.recasades > 0 && <p>{tr.recasades(f.resum.recasades)}</p>}
              {f.cartera && <p className={f.cartera.quadra ? undefined : "text-amber-900"}>{tr.cartera(f.cartera)}</p>}
              {f.desconegudes && f.desconegudes.length > 0 && <p className="text-amber-900">{tr.desconegudes(f.desconegudes)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
