"use client";

import { useActionState, useState } from "react";
import { COBERTURES } from "@/lib/altes/regles";
import { t } from "@/lib/textos";
import { afegeixDocuments, rebutjaAlta, resolAlta, validaAlta, type EstatAccio } from "./actions";

const tv = t.validar;
const boto = "min-h-11 rounded-md px-4 font-medium disabled:opacity-60";

function Missatge({ estat, pendent }: { estat: EstatAccio; pendent: boolean }) {
  if (pendent) return null;
  if (estat.error) return <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{estat.error}</p>;
  if (estat.ok) return <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{estat.ok}</p>;
  return null;
}

export function AccionsAlta({
  id,
  matricula,
  cobertura,
  documentsComplets,
}: {
  id: string;
  matricula: string;
  cobertura: "tot_risc" | "tercers";
  documentsComplets: boolean;
}) {
  const [estatV, accioV, pendentV] = useActionState<EstatAccio, FormData>(validaAlta, {});
  const [estatR, accioR, pendentR] = useActionState<EstatAccio, FormData>(rebutjaAlta, {});
  const [rebutjant, setRebutjant] = useState(false);
  const ocupat = pendentV || pendentR;

  return (
    <div className="space-y-3">
      <form
        action={accioV}
        onSubmit={(ev) => {
          if (!window.confirm(tv.confirmaValida(matricula))) ev.preventDefault();
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="id" value={id} />
        <select name="cobertura" defaultValue={cobertura} className="rounded-md border bg-white px-3 py-2">
          {COBERTURES.map((c) => (
            <option key={c} value={c}>
              {t.altes.cobertures[c]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={ocupat || !documentsComplets} className={`${boto} bg-blue-700 text-white`}>
          {pendentV ? tv.validant : tv.valida}
        </button>
        <button type="button" disabled={ocupat} onClick={() => setRebutjant(true)} className={`${boto} border bg-white text-red-800`}>
          {tv.rebutja}
        </button>
      </form>
      <Missatge estat={estatV} pendent={pendentV} />

      {rebutjant && (
        <form action={accioR} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={id} />
          <label className="grow space-y-1">
            <span className="block text-sm text-gray-600">{tv.motiuRebuig}</span>
            <input name="motiu" required maxLength={500} className="w-full rounded-md border bg-white px-3 py-2" />
          </label>
          <button type="submit" disabled={ocupat} className={`${boto} bg-red-700 text-white`}>
            {tv.rebutja}
          </button>
        </form>
      )}
      <Missatge estat={estatR} pendent={pendentR} />
    </div>
  );
}

export function PendentAlta({ id }: { id: string }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(resolAlta, {});
  return (
    <form action={accio} className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="text-amber-900">{tv.pendent}</p>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="resultat" value="enviat" disabled={pendent} className={`${boto} bg-gray-900 text-white`}>
          {t.vehicles.baixa.haSortit}
        </button>
        <button type="submit" name="resultat" value="no_enviat" disabled={pendent} className={`${boto} border bg-white`}>
          {t.vehicles.baixa.noHaSortit}
        </button>
      </div>
      <Missatge estat={estat} pendent={pendent} />
    </form>
  );
}

/** Administració: afegir el PC i/o la FT que falten. */
export function FormulariDocuments({ id, faltaPc, faltaFt }: { id: string; faltaPc: boolean; faltaFt: boolean }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(afegeixDocuments, {});
  return (
    <form action={accio} className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <input type="hidden" name="id" value={id} />
      {faltaPc && (
        <label className="block space-y-1">
          <span className="block text-gray-700">{t.altes.camps.pc}</span>
          <input type="file" name="pc" accept="image/*,application/pdf" className="text-sm" />
        </label>
      )}
      {faltaFt && (
        <label className="block space-y-1">
          <span className="block text-gray-700">{t.altes.camps.ft}</span>
          <input type="file" name="ft" accept="image/*,application/pdf" className="text-sm" />
        </label>
      )}
      <button type="submit" disabled={pendent} className={`${boto} bg-gray-900 text-white`}>
        {tv.afegeix}
      </button>
      <Missatge estat={estat} pendent={pendent} />
    </form>
  );
}
