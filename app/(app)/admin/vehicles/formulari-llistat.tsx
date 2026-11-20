"use client";

import { useActionState, useState } from "react";
import { t } from "@/lib/textos";
import { carregaLlistat, type EstatCarregaLlistat } from "./actions";
import { MIDA_MAXIMA } from "./regles";

export default function FormulariLlistat() {
  const [estat, accio, pendent] = useActionState<EstatCarregaLlistat, FormData>(carregaLlistat, {});
  const [massaGran, setMassaGran] = useState(false);
  const c = t.vehicles.carrega;

  return (
    <div className="space-y-3 rounded-md border bg-white p-4">
      <h2 className="text-lg font-semibold">{c.titol}</h2>
      <p className="text-sm text-gray-600">{c.ajuda}</p>
      <form action={accio} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="fitxer"
          required
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={(e) => setMassaGran((e.target.files?.[0]?.size ?? 0) > MIDA_MAXIMA)}
          className="min-w-0 max-w-full text-sm"
        />
        <button
          type="submit"
          disabled={pendent || massaGran}
          className="min-h-11 rounded-md bg-blue-700 px-4 font-medium text-white disabled:opacity-60"
        >
          {pendent ? c.carregant : c.boto}
        </button>
      </form>
      {massaGran && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{t.vehicles.errors.mida}</p>}
      {/* L'èxit no es mostra aquí: la pàgina passa a la llista i hi mostra el resum desat de la càrrega. */}
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{estat.error}</p>}
    </div>
  );
}
