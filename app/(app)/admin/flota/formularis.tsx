"use client";

import { useActionState, useState } from "react";
import { t } from "@/lib/textos";
import { buidaLlista, enviaProassa, pujaLlista, registraInicial, resolEnviamentFlota, type EstatAccio } from "./actions";

const boto = "min-h-11 rounded-md px-4 font-medium disabled:opacity-60";
const MIDA = 2.5 * 1024 * 1024;
const tf = t.flota;

function Missatges({ estat, pendent }: { estat: EstatAccio; pendent: boolean }) {
  if (pendent) return null;
  return (
    <>
      {estat.error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{estat.error}</p>}
      {estat.ok && <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">{estat.ok}</p>}
    </>
  );
}

/** Input d'Excel amb control de mida. */
function InputExcel({ onMida }: { onMida: (massa: boolean) => void }) {
  return (
    <input
      type="file"
      name="fitxer"
      required
      accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
      onChange={(ev) => onMida((ev.target.files?.[0]?.size ?? 0) > MIDA)}
      className="min-w-0 max-w-full text-sm"
    />
  );
}

/** Pujar o substituir una llista addicional. */
export function FormulariLlista({ categoria, teLlista }: { categoria: "immobilitzats" | "campers"; teLlista: boolean }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(pujaLlista, {});
  const [estatB, accioB, pendentB] = useActionState<EstatAccio, FormData>(buidaLlista, {});
  const [massa, setMassa] = useState(false);
  return (
    <div className="space-y-2">
      <form action={accio} className="space-y-2">
        <input type="hidden" name="categoria" value={categoria} />
        <div className="flex flex-wrap items-center gap-3">
          <InputExcel onMida={setMassa} />
          <button type="submit" disabled={pendent || massa} className={`${boto} border bg-white`}>
            {tf.llistes.boto}
          </button>
        </div>
        {massa && <p className="text-sm text-red-700">{tf.errors.mida}</p>}
        <Missatges estat={estat} pendent={pendent} />
      </form>
      {teLlista && (
        <form
          action={accioB}
          onSubmit={(ev) => {
            if (!window.confirm(tf.llistes.confirmaBuida)) ev.preventDefault();
          }}
        >
          <input type="hidden" name="categoria" value={categoria} />
          <button type="submit" disabled={pendentB} className="text-sm text-red-800 underline disabled:opacity-60">
            {tf.llistes.buida}
          </button>
          <Missatges estat={estatB} pendent={pendentB} />
        </form>
      )}
    </div>
  );
}

/** Punt de partida: l'últim Excel enviat a mà. */
export function FormulariInicial() {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(registraInicial, {});
  const [massa, setMassa] = useState(false);
  return (
    <form action={accio} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <InputExcel onMida={setMassa} />
        <button type="submit" disabled={pendent || massa} className={`${boto} bg-gray-900 text-white`}>
          {tf.inicial.boto}
        </button>
      </div>
      {massa && <p className="text-sm text-red-700">{tf.errors.mida}</p>}
      <Missatges estat={estat} pendent={pendent} />
    </form>
  );
}

/** Botó "Envia a Proassa" amb confirmació. */
export function BotoEnvia({ total, altes, baixes, desactivat }: { total: number; altes: number; baixes: number; desactivat: boolean }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(enviaProassa, {});
  return (
    <form
      action={accio}
      onSubmit={(ev) => {
        if (!window.confirm(tf.previa.confirma(total, altes, baixes))) ev.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="total" value={total} />
      <input type="hidden" name="altes" value={altes} />
      <input type="hidden" name="baixes" value={baixes} />
      <button type="submit" disabled={pendent || desactivat} className={`${boto} bg-blue-700 text-white`}>
        {pendent ? tf.previa.enviant : tf.previa.boto}
      </button>
      <Missatges estat={estat} pendent={pendent} />
    </form>
  );
}

/** Enviament incert: "Sí, ha sortit" / "No ha sortit". */
export function PendentFlota({ id }: { id: string }) {
  const [estat, accio, pendent] = useActionState<EstatAccio, FormData>(resolEnviamentFlota, {});
  return (
    <form action={accio} className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="text-amber-900">{tf.pendent}</p>
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="resultat" value="enviat" disabled={pendent} className={`${boto} bg-gray-900 text-white`}>
          {t.vehicles.baixa.haSortit}
        </button>
        <button type="submit" name="resultat" value="no_enviat" disabled={pendent} className={`${boto} border bg-white`}>
          {t.vehicles.baixa.noHaSortit}
        </button>
      </div>
      <Missatges estat={estat} pendent={pendent} />
    </form>
  );
}
