"use client";

import { useActionState, useState } from "react";
import { t } from "@/lib/textos";
import { carregaRelacio, type EstatAccio } from "./baixa-actions";
import { MIDA_PDF } from "./regles";

export default function FormulariRelacio({ vigent }: { vigent: string | null }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(carregaRelacio, {});
  const [massaGran, setMassaGran] = useState(false);
  const r = t.vehicles.relacio;

  return (
    <div className="space-y-2 rounded-md border bg-white p-3 text-sm">
      <p className="font-medium">{r.titol}</p>
      <p className={vigent ? "text-gray-700" : "text-amber-900"}>{vigent ?? r.cap}</p>
      <form action={accio} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="fitxer"
          required
          accept="application/pdf,.pdf"
          onChange={(ev) => setMassaGran((ev.target.files?.[0]?.size ?? 0) > MIDA_PDF)}
          className="min-w-0 max-w-full text-sm"
          aria-label={r.ajuda}
        />
        <button
          type="submit"
          disabled={pendent || massaGran}
          className="min-h-11 rounded-md border bg-white px-4 font-medium disabled:opacity-60"
        >
          {pendent ? r.carregant : r.boto}
        </button>
      </form>
      <p className="text-gray-600">{r.ajuda}</p>
      {massaGran && <p className="rounded-md bg-red-50 p-3 text-red-800">{t.vehicles.errors.pdfMida}</p>}
      {!pendent && estat.error && <p className="rounded-md bg-red-50 p-3 text-red-800">{estat.error}</p>}
      {!pendent && estat.ok && <p className="rounded-md bg-green-50 p-3 text-green-800">{estat.ok}</p>}
    </div>
  );
}
