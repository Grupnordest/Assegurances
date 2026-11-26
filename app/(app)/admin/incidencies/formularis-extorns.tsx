"use client";

import { useActionState } from "react";
import { t } from "@/lib/textos";
import { acceptaExtorn, descartaRebut, reclamaExtorns, type EstatExtorn } from "./actions";

/** "Reclamar extorns pendents": un correu a la Corredoria amb tots els extorns pendents (FR-25). */
export function BotoReclama({ perReclamar }: { perReclamar: number }) {
  const [estat, accio, pendent] = useActionState<EstatExtorn, FormData>(reclamaExtorns, {});
  const te = t.extorns;
  return (
    <div className="space-y-2">
      <form
        action={accio}
        onSubmit={(e) => {
          if (!window.confirm(te.confirmaReclama(perReclamar))) e.preventDefault();
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <button
          type="submit"
          disabled={pendent || perReclamar === 0}
          className="min-h-11 rounded-md bg-blue-700 px-4 font-medium text-white disabled:opacity-60"
        >
          {pendent ? te.reclamant : te.reclama}
        </button>
        <span className="text-sm text-gray-600">{perReclamar ? te.perReclamar(perReclamar) : te.capPerReclamar}</span>
      </form>
      {!pendent && estat.ok && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{estat.ok}</p>}
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{estat.error}</p>}
    </div>
  );
}

/** Accepta un extorn que no quadra amb un comentari: la baixa queda liquidada i el vehicle, tancat. */
export function FormulariAcceptaExtorn({ baixaId }: { baixaId: string }) {
  const [estat, accio, pendent] = useActionState<EstatExtorn, FormData>(acceptaExtorn, {});
  const te = t.extorns;
  if (estat.ok) return <p className="rounded-md bg-green-50 p-3 text-green-800">{estat.ok}</p>;
  return (
    <form action={accio} className="space-y-2">
      <input type="hidden" name="baixa" value={baixaId} />
      <label className="block space-y-1">
        <span className="block text-sm text-gray-600">{te.acceptaTitol}</span>
        <textarea name="comentari" required maxLength={1000} rows={2} className="w-full rounded-md border bg-white px-3 py-2" />
      </label>
      <button type="submit" disabled={pendent} className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-60">
        {pendent ? te.acceptant : te.accepta}
      </button>
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-red-800">{estat.error}</p>}
    </form>
  );
}

/** Descarta una línia de rebut sense casar amb un comentari (rebut sense vehicle o extorn no identificat). */
export function FormulariDescartaRebut({ rebutId }: { rebutId: string }) {
  const [estat, accio, pendent] = useActionState<EstatExtorn, FormData>(descartaRebut, {});
  const te = t.extorns;
  if (estat.ok) return <p className="rounded-md bg-green-50 p-3 text-green-800">{estat.ok}</p>;
  return (
    <form action={accio} className="space-y-2">
      <input type="hidden" name="rebut" value={rebutId} />
      <label className="block space-y-1">
        <span className="block text-sm text-gray-600">{te.descartaTitol}</span>
        <textarea name="comentari" required maxLength={1000} rows={2} className="w-full rounded-md border bg-white px-3 py-2" />
      </label>
      <button type="submit" disabled={pendent} className="min-h-11 rounded-md border px-4 font-medium disabled:opacity-60">
        {pendent ? te.acceptant : te.descarta}
      </button>
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-red-800">{estat.error}</p>}
    </form>
  );
}
