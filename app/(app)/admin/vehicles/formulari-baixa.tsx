"use client";

import { useActionState, useState } from "react";
import { t } from "@/lib/textos";
import {
  anulaBaixa,
  cancelaBaixaPendent,
  donaDeBaixa,
  enviaBaixaPendent,
  marcaAssegurat,
  resolEnviament,
  type EstatAccio,
} from "./baixa-actions";
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
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(
    donaDeBaixa,
    {},
  );
  const [data, setData] = useState(avui);
  const [massaGran, setMassaGran] = useState(false);

  if (!obert) {
    return (
      <button
        type="button"
        onClick={() => setObert(true)}
        className={`${boto} border border-red-300 bg-white text-red-800`}
      >
        {tb.boto}
      </button>
    );
  }

  return (
    <form
      action={accio}
      className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-3"
    >
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
        <span
          className={`block text-sm ${tePolissa ? "text-gray-700" : "text-amber-900"}`}
        >
          {tePolissa ? tb.ambPolissa : tb.sensePolissa}
        </span>
        <input
          type="file"
          name="polissa"
          required={!tePolissa}
          accept="application/pdf,.pdf"
          onChange={(ev) =>
            setMassaGran((ev.target.files?.[0]?.size ?? 0) > MIDA_PDF)
          }
          className="min-w-0 max-w-full text-sm"
          aria-label={tb.polissa}
        />
      </label>
      {massaGran && (
        <p className="text-sm text-red-700">{t.vehicles.errors.pdfMida}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pendent || massaGran}
          className={`${boto} bg-red-700 text-white`}
        >
          {pendent ? tb.enviant : tb.envia}
        </button>
        <button
          type="button"
          disabled={pendent}
          onClick={() => setObert(false)}
          className={`${boto} border bg-white`}
        >
          {tb.cancel}
        </button>
        {!pendent && estat.error && (
          <span className="text-sm text-red-700">{estat.error}</span>
        )}
      </div>
    </form>
  );
}

/** Anul·lació d'una baixa enviada, amb confirmació. */
export function BotoAnula({
  vehicleId,
  matricula,
}: {
  vehicleId: string;
  matricula: string;
}) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(
    anulaBaixa,
    {},
  );

  return (
    <form
      action={accio}
      onSubmit={(ev) => {
        if (!window.confirm(tb.confirmaAnula(matricula))) ev.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="id" value={vehicleId} />
      <button
        type="submit"
        disabled={pendent}
        className={`${boto} border bg-white`}
      >
        {pendent ? tb.anulant : tb.anula}
      </button>
      {!pendent && estat.error && (
        <span className="text-sm text-red-700">{estat.error}</span>
      )}
      {!pendent && estat.ok && (
        <span className="text-sm text-green-800">{estat.ok}</span>
      )}
    </form>
  );
}

/** Enviament incert: Administració mira a Elements enviats i diu si el correu ha sortit. */
export function PendentConfirmar({
  baixaId,
  tipus,
}: {
  baixaId: string;
  tipus: "baixa" | "anullacio";
}) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(
    resolEnviament,
    {},
  );

  return (
    <form
      action={accio}
      className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
    >
      <p className="text-amber-900">{tb.pendent(tipus)}</p>
      <input type="hidden" name="id" value={baixaId} />
      <input type="hidden" name="tipus" value={tipus} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="resultat"
          value="enviat"
          disabled={pendent}
          className={`${boto} bg-gray-900 text-white`}
        >
          {tb.haSortit}
        </button>
        <button
          type="submit"
          name="resultat"
          value="no_enviat"
          disabled={pendent}
          className={`${boto} border bg-white`}
        >
          {tb.noHaSortit}
        </button>
        {!pendent && estat.error && (
          <span className="text-red-700">{estat.error}</span>
        )}
      </div>
    </form>
  );
}

/** Enviat a la corredoria → Assegurat amb el PDF de la pòlissa. */
export function FormulariAssegurat({ vehicleId }: { vehicleId: string }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(
    marcaAssegurat,
    {},
  );
  const [massaGran, setMassaGran] = useState(false);
  const ta = t.vehicles.assegurat;
  return (
    <form
      action={accio}
      className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3"
    >
      <input type="hidden" name="id" value={vehicleId} />
      <p className="text-sm text-gray-700">{ta.ajuda}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="polissa"
          required
          accept="application/pdf,.pdf"
          onChange={(ev) =>
            setMassaGran((ev.target.files?.[0]?.size ?? 0) > MIDA_PDF)
          }
          className="min-w-0 max-w-full text-sm"
        />
        <button
          type="submit"
          disabled={pendent || massaGran}
          className={`${boto} bg-blue-700 text-white`}
        >
          {ta.boto}
        </button>
      </div>
      {massaGran && (
        <p className="text-sm text-red-700">{t.vehicles.errors.pdfMida}</p>
      )}
      {!pendent && estat.error && (
        <p className="text-sm text-red-700">{estat.error}</p>
      )}
      {!pendent && estat.ok && (
        <p className="text-sm text-green-800">{estat.ok}</p>
      )}
    </form>
  );
}

/** Baixa demanada des d'un Avís d'un vehicle sense pòlissa: pujar-la l'envia a la corredoria. */
export function FormulariBaixaPendent({
  baixaId,
  vehicleId,
  dataBaixa,
}: {
  baixaId: string;
  vehicleId: string;
  dataBaixa: string;
}) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(
    enviaBaixaPendent,
    {},
  );
  const [estatC, accioC, pendentC] = useActionState<EstatAccio, FormData>(
    cancelaBaixaPendent,
    {},
  );
  const [massaGran, setMassaGran] = useState(false);
  return (
    <div className="space-y-2">
      <form
        action={accio}
        className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
      >
        <input type="hidden" name="baixa" value={baixaId} />
        <input type="hidden" name="vehicle" value={vehicleId} />
        <p className="text-amber-900">{tb.pendentPolissa(dataBaixa)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="polissa"
            required
            accept="application/pdf,.pdf"
            onChange={(ev) =>
              setMassaGran((ev.target.files?.[0]?.size ?? 0) > MIDA_PDF)
            }
            className="min-w-0 max-w-full text-sm"
          />
          <button
            type="submit"
            disabled={pendent || massaGran}
            className={`${boto} bg-red-700 text-white`}
          >
            {pendent ? tb.enviant : tb.envia}
          </button>
        </div>
        {massaGran && (
          <p className="text-red-700">{t.vehicles.errors.pdfMida}</p>
        )}
        {!pendent && estat.error && (
          <p className="text-red-700">{estat.error}</p>
        )}
        {!pendent && estat.ok && <p className="text-green-800">{estat.ok}</p>}
      </form>
      <form
        action={accioC}
        onSubmit={(ev) => {
          if (!window.confirm(tb.confirmaCancelaPendent)) ev.preventDefault();
        }}
        className="text-sm"
      >
        <input type="hidden" name="baixa" value={baixaId} />
        <button
          type="submit"
          disabled={pendentC}
          className="text-red-800 underline disabled:opacity-60"
        >
          {tb.cancelaPendent}
        </button>
        {!pendentC && estatC.error && (
          <span className="ml-2 text-red-700">{estatC.error}</span>
        )}
      </form>
    </div>
  );
}
