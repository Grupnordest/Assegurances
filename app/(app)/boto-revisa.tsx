"use client";

import { useActionState } from "react";
import { revisaAra, type EstatRevisio } from "./avisos-actions";

export default function BotoRevisa() {
  const [estat, accio, pendent] = useActionState<EstatRevisio, FormData>(revisaAra, {});
  return (
    <form action={accio} className="space-y-2">
      <button type="submit" disabled={pendent} className="min-h-11 rounded-md border bg-white px-4 text-sm font-medium disabled:opacity-60">
        {pendent ? "Revisant…" : "Revisa els avisos ara"}
      </button>
      {!pendent && estat.ok && <p className="text-sm text-green-800">{estat.ok}</p>}
      {!pendent && estat.error && <p className="text-sm text-red-700">{estat.error}</p>}
    </form>
  );
}
