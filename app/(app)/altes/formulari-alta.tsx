"use client";

import { startTransition, useActionState, useState } from "react";
import { COBERTURES, FOTOS, MIDA_TOTAL_ADJUNTS, MOTIUS_ALTA } from "@/lib/altes/regles";
import { redueixImatge } from "@/lib/imatges";
import { t } from "@/lib/textos";
import { cercaMatricula, creaAlta, type EstatAlta, type ResultatCerca } from "./actions";

const ta = t.altes;
const camp = "w-full rounded-md border bg-white px-3 py-2";
const boto = "min-h-11 rounded-md px-4 font-medium disabled:opacity-60";

type Trobat = Extract<ResultatCerca, { aEstoc: true }>;

export default function FormulariAlta({
  centres,
  centreDefecte,
  avui,
}: {
  centres: { id: number; nom: string }[];
  centreDefecte: number | null;
  avui: string;
}) {
  const [text, setText] = useState("");
  const [cercant, setCercant] = useState(false);
  const [cerca, setCerca] = useState<ResultatCerca | null>(null);
  const [preparant, setPreparant] = useState(false);
  const [errorLocal, setErrorLocal] = useState<string>();
  const [estat, accio, pendent] = useActionState<EstatAlta, FormData>(creaAlta, {});

  async function busca(ev: React.FormEvent) {
    ev.preventDefault();
    setCercant(true);
    setCerca(await cercaMatricula(text));
    setCercant(false);
  }

  async function envia(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const original = new FormData(ev.currentTarget);
    const fd = new FormData();
    setErrorLocal(undefined);
    setPreparant(true);
    let total = 0;
    try {
      for (const [k, v] of original.entries()) {
        // Fotos (i documents fets amb la càmera) reduïts abans de pujar-los.
        const valor = v instanceof File && v.size > 0 ? await redueixImatge(v) : v;
        if (valor instanceof File) total += valor.size;
        fd.append(k, valor);
      }
    } catch (err) {
      console.error(err);
      setErrorLocal(ta.errors.imatge);
      return;
    } finally {
      setPreparant(false);
    }
    // Si passa del límit, el servidor ni tan sols rebria la petició: s'avisa aquí.
    if (total > MIDA_TOTAL_ADJUNTS) {
      setErrorLocal(ta.errors.mida);
      return;
    }
    startTransition(() => accio(fd));
  }

  const trobat: Trobat | null = cerca && "aEstoc" in cerca && cerca.aEstoc ? cerca : null;
  const ocupat = preparant || pendent;

  if (estat.ok) {
    return (
      <div className="space-y-3 rounded-md border bg-white p-4">
        <p className="rounded-md bg-green-50 p-3 text-green-800">{estat.ok}</p>
        <button type="button" className={`${boto} border bg-white`} onClick={() => location.reload()}>
          {t.menu.altes}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={busca} className="flex flex-wrap items-end gap-3 rounded-md border bg-white p-4">
        <label className="grow space-y-1">
          <span className="block text-sm text-gray-600">{ta.cerca.etiqueta}</span>
          <input
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            autoCapitalize="characters"
            required
            className={`${camp} uppercase`}
            placeholder="1234ABC"
          />
        </label>
        <button type="submit" disabled={cercant} className={`${boto} bg-gray-900 text-white`}>
          {ta.cerca.boto}
        </button>
      </form>

      {cerca && "error" in cerca && <p className="rounded-md bg-red-50 p-3 text-red-800">{cerca.error}</p>}
      {cerca && "aEstoc" in cerca && !cerca.aEstoc && (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900">{ta.cerca.fora}</p>
      )}
      {trobat?.estatObert && (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900">
          {ta.cerca.jaAssegurat(trobat.responsable)}
        </p>
      )}

      {trobat && !trobat.estatObert && (
        <form onSubmit={envia} className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm text-gray-700">{ta.cerca.trobat(`${trobat.matricula} · ${trobat.descripcio}`)}</p>
          <input type="hidden" name="matricula" value={trobat.matricula} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.motiu}</span>
              <select name="motiu" required defaultValue="" className={camp}>
                <option value="" disabled>
                  {t.vehicles.senseMotiu}
                </option>
                {MOTIUS_ALTA.map((m) => (
                  <option key={m} value={m}>
                    {t.vehicles.motius[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.dataAlta}</span>
              <input type="date" name="dataAlta" required min={avui} defaultValue={avui} className={camp} />
            </label>
            <label className="space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.centre}</span>
              <select name="centre" required defaultValue={centreDefecte ?? ""} className={camp}>
                <option value="" disabled>
                  —
                </option>
                {centres.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.cobertura}</span>
              <select name="cobertura" defaultValue="tot_risc" className={camp}>
                {COBERTURES.map((c) => (
                  <option key={c} value={c}>
                    {ta.cobertures[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="font-medium">{ta.camps.fotos}</legend>
            <p className="text-sm text-gray-600">{ta.camps.ajudaFotos}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FOTOS.map((f) => (
                <label key={f} className="space-y-1">
                  <span className="block text-sm text-gray-600">{ta.camps.foto[f]}</span>
                  <input type="file" name={`foto_${f}`} required accept="image/*" capture="environment" className="text-sm" />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <p className="text-sm text-gray-700">{trobat.docsPrevis ? ta.camps.docsPrevis : ta.camps.docsOpcionals}</p>
            <label className="block space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.pc}</span>
              <input type="file" name="pc" accept="image/*,application/pdf" className="text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.ft}</span>
              <input type="file" name="ft" accept="image/*,application/pdf" className="text-sm" />
            </label>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.dataPrevista}</span>
              <input type="date" name="dataPrevista" min={avui} className={camp} />
            </label>
            <label className="space-y-1">
              <span className="block text-sm text-gray-600">{ta.camps.comentari}</span>
              <input name="comentari" maxLength={500} className={camp} />
            </label>
          </div>

          <button type="submit" disabled={ocupat} className={`${boto} w-full bg-blue-700 text-white sm:w-auto`}>
            {ocupat ? ta.enviant : ta.envia}
          </button>
          {!ocupat && (errorLocal ?? estat.error) && (
            <p className="rounded-md bg-red-50 p-3 text-red-800">{errorLocal ?? estat.error}</p>
          )}
        </form>
      )}
    </div>
  );
}
