"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { t } from "@/lib/textos";
import { pujaEstoc, type EstatCarrega } from "./actions";
import { MIDA_MAXIMA } from "./regles";

const boto = "min-h-11 rounded-md px-4 font-medium disabled:opacity-60";

export default function FormulariEstoc() {
  const [estat, accio, pendent] = useActionState<EstatCarrega, FormData>(pujaEstoc, {});
  // El fitxer es guarda per poder-lo reenviar si cal confirmar (el formulari es buida en enviar).
  const [fitxer, setFitxer] = useState<File | null>(null);
  // Fitxer al qual correspon `estat`: si se'n tria un altre, l'estat anterior ja no s'aplica.
  const [enviat, setEnviat] = useState<File | null>(null);
  const [errorLocal, setErrorLocal] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const actual = !!enviat && (fitxer === enviat || (fitxer === null && !!estat.ok));

  useEffect(() => {
    if (estat.ok) {
      setFitxer(null);
      if (input.current) input.current.value = "";
    }
  }, [estat]);

  function tria(f: File | null) {
    setFitxer(f);
    setErrorLocal(f && f.size > MIDA_MAXIMA ? t.estoc.errors.mida : undefined);
  }

  function envia(confirma: boolean) {
    if (!fitxer || fitxer.size > MIDA_MAXIMA) return;
    const fd = new FormData();
    fd.set("fitxer", fitxer);
    if (confirma) fd.set("confirma", "1");
    setEnviat(fitxer);
    startTransition(() => accio(fd));
  }

  function cancela() {
    tria(null);
    setEnviat(null);
    if (input.current) input.current.value = "";
  }

  const p = t.estoc.pujar;
  return (
    <div className="space-y-3 rounded-md border bg-white p-4">
      <h2 className="text-lg font-semibold">{p.titol}</h2>
      <p className="text-sm text-gray-600">{p.ajuda}</p>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          envia(false);
        }}
      >
        <input
          ref={input}
          type="file"
          name="fitxer"
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => tria(e.target.files?.[0] ?? null)}
          className="min-w-0 max-w-full text-sm"
        />
        <button
          type="submit"
          disabled={!fitxer || !!errorLocal || pendent}
          className={`${boto} bg-blue-700 text-white`}
        >
          {pendent ? p.carregant : p.boto}
        </button>
      </form>

      {errorLocal && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{errorLocal}</p>}

      {actual && !pendent && estat.confirmacio && (
        <div className="space-y-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <p>{p.caiguda(estat.confirmacio.abans, estat.confirmacio.ara)}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => envia(true)} className={`${boto} bg-amber-700 text-white`}>
              {p.confirma}
            </button>
            <button type="button" onClick={cancela} className={`${boto} border bg-white`}>
              {p.cancela}
            </button>
          </div>
        </div>
      )}

      {actual && !pendent && estat.error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{estat.error}</p>
      )}

      {actual && !pendent && estat.ok && (
        <div className="space-y-1 rounded-md bg-green-50 p-3 text-sm text-green-900">
          <p>{p.ok(estat.ok.vehicles)}</p>
          {estat.ok.descartats > 0 && <p>{p.okDescartats(estat.ok.descartats)}</p>}
          {estat.ok.senseData && <p>{p.okSenseData}</p>}
        </div>
      )}
    </div>
  );
}
