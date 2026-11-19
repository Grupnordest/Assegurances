"use client";

import { useState, useTransition } from "react";
import { t } from "@/lib/textos";
import { canviaActiu } from "./actions";

export default function BotoActiu({ id, actiu }: { id: string; actiu: boolean }) {
  const [error, setError] = useState<string>();
  const [pendent, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pendent}
        onClick={() =>
          startTransition(async () => {
            const r = await canviaActiu(id, !actiu);
            setError(r.error);
          })
        }
        className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-60"
      >
        {actiu ? t.usuaris.desactiva : t.usuaris.reactiva}
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
