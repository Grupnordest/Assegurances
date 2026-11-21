"use client";

import { useActionState, useState } from "react";
import { t } from "@/lib/textos";
import { anulaBaixa, donaDeBaixa, resolEnviament, type EstatAccio } from "./baixa-actions";
import { MIDA_PDF } from "./regles";

const boto = "min-h-11 rounded-md px-4 font-medium disabled:opacity-60";
const tb = t.vehicles.baixa;

/** Botó "Donar de baixa" que obre el formulari (data i, si el vehicle encara no en té, la pòlissa AXA). */
export function FormulariBaixa({
  vehicleId,
  avui,
  tePolissa,
}: {
  vehicleId: string;
  avui: string;
  /** El vehicle ja té la pòlissa AXA (PDF) desada. */
  tePolissa: boolean;
}) {
  const [obert, setObert] = useState(false);
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(donaDeBaixa, {});
  const [data, setData] = useState(avui);
  const [massaGran, setMassaGran] = useState(false);

  if (!obert) {
    return (
      <button type="button" onClick={() => setObert(true)} className={`${boto} border border-red-300 bg-white text-red-800`}>
        {tb.boto}
      </button>
    );
  }

  return (
    <form action={accio} className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-3">
      <p className="font-medium">{tb.titol}</p>
      <input type="hidden" name="id" value={vehicleId} />
      <label className="block space-y-1">
        <span className="block text-sm text-gray-600">{tb.data}</span>
        <input
          type="date"
          name="dataBaixa"
          required
          min={avui}
          value={data}
          onChange={(ev) => setData(ev.target.value)}
          className="w-full rounded-md border bg-white px-3 py-2 sm:w-auto"
        />
      </label>
      <label className="block space-y-1">
        <span className={`block text-sm ${tePolissa ? "text-gray-700" : "text-amber-900"}`}>
          {tePolissa ? tb.ambPolissa : tb.sensePolissa}
        </span>
        <input
          type="file"
          name="polissa"
          required={!tePolissa}
          accept="application/pdf,.pdf"
          onChange={(ev) => setMassaGran((ev.target.files?.[0]?.size ?? 0) > MIDA_PDF)}
          className="min-w-0 max-w-full text-sm"
          aria-label={tb.polissa}
        />
      </label>
      {massaGran && <p className="text-sm text-red-700">{t.vehicles.errors.pdfMida}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pendent || massaGran} className={`${boto} bg-red-700 text-white`}>
          {pendent ? tb.enviant : tb.envia}
        </button>
        <button type="button" disabled={pendent} onClick={() => setObert(false)} className={`${boto} border bg-white`}>
          {tb.cancel}
        </button>
        {!pendent && estat.error && <span className="text-sm text-red-700">{estat.error}</span>}
      </div>
    </form>
  );
}

/** Anul·lació d'una baixa enviada, amb confirmació. */
export function BotoAnula({ vehicleId, matricula }: { vehicleId: string; matricula: string }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(anulaBaixa, {});

  return (
    <form
      action={accio}
      onSubmit={(ev) => {
        if (!window.confirm(tb.confirmaAnula(matricula))) ev.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="id" value={vehicleId} />
      <button type="submit" disabled={pendent} className={`${boto} border bg-white`}>
        {pendent ? tb.anulant : tb.anula}
      </button>
      {!pendent && estat.error && <span className="text-sm text-red-700">{estat.error}</span>}
      {!pendent && estat.ok && <span className="text-sm text-green-800">{estat.ok}</span>}
    </form>
  );
}

/** Enviament incert: Administració mira a Elements enviats i diu si el correu ha sortit. */
export function PendentConfirmar({ baixaId, tipus }: { baixaId: string; tipus: "baixa" | "anullacio" }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(resolEnviament, {});

  return (
    <form action={accio} className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="text-amber-900">{tb.pendent(tipus)}</p>
      <input type="hidden" name="id" value={baixaId} />
      <input type="hidden" name="tipus" value={tipus} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="resultat" value="enviat" disabled={pendent} className={`${boto} bg-gray-900 text-white`}>
          {tb.haSortit}
        </button>
        <button type="submit" name="resultat" value="no_enviat" disabled={pendent} className={`${boto} border bg-white`}>
          {tb.noHaSortit}
        </button>
        {!pendent && estat.error && <span className="text-red-700">{estat.error}</span>}
      </div>
    </form>
  );
}
