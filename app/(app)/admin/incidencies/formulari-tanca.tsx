"use client";

import { useActionState } from "react";
import { tancaIncidencia, type EstatTancament } from "./actions";

/** Tanca un Avís en excepció amb un comentari (sense baixa ni canvis al vehicle). */
export default function FormulariTanca({ avisId }: { avisId: string }) {
  const [estat, accio, pendent] = useActionState<EstatTancament, FormData>(tancaIncidencia, {});
  if (estat.ok) return <p className="rounded-md bg-green-50 p-3 text-green-800">{estat.ok}</p>;
  return (
    <form action={accio} className="space-y-2">
      <input type="hidden" name="avis" value={avisId} />
      <label className="block space-y-1">
        <span className="block text-sm text-gray-600">Tancar amb comentari</span>
        <textarea name="comentari" required maxLength={1000} rows={2} className="w-full rounded-md border bg-white px-3 py-2" />
      </label>
      <button type="submit" disabled={pendent} className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-60">
        {pendent ? "Desant…" : "Tancar"}
      </button>
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-red-800">{estat.error}</p>}
    </form>
  );
}
