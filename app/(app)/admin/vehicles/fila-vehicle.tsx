"use client";

import { useActionState, useState } from "react";
import { t } from "@/lib/textos";
import { classificaVehicle, type EstatClassificacio } from "./actions";
import { MOTIUS } from "./regles";

export type VehicleFila = {
  id: string;
  matricula: string;
  marca_model: string | null;
  estat: keyof typeof t.vehicles.estats;
  cobertura: "tot_risc" | "tercers";
  franquicia: number | null;
  data_alta: string | null;
  prima_total: number | null;
  nota: string | null;
  motiu: (typeof MOTIUS)[number] | null;
  responsable_id: string | null;
  centre_id: number | null;
  data_prevista_baixa: string | null;
  pendent: boolean;
  updated_at: string;
};

type Props = {
  vehicle: VehicleFila;
  usuaris: { id: string; nom: string }[];
  centres: { id: number; nom: string }[];
  capPostvenda: string | null;
  avui: string;
};

const camp = "w-full rounded-md border px-3 py-2";
const eur = new Intl.NumberFormat("ca-ES", { style: "currency", currency: "EUR" });
const data = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

export default function FilaVehicle({ vehicle: v, usuaris, centres, capPostvenda, avui }: Props) {
  const [estat, accio, pendent] = useActionState<EstatClassificacio, FormData>(classificaVehicle, {});
  const tv = t.vehicles;
  // Camps controlats: React 19 buida els formularis no controlats després de cada acció,
  // i en cas d'error es perdria el que s'havia escrit.
  const [motiu, setMotiu] = useState(v.motiu ?? "");
  // Si el responsable desat s'ha desactivat, no surt a la llista: el vehicle torna a estar pendent.
  const [responsable, setResponsable] = useState(
    usuaris.some((u) => u.id === v.responsable_id) ? (v.responsable_id ?? "") : "",
  );
  const [centre, setCentre] = useState(v.centre_id ? String(v.centre_id) : "");
  const [dataPrevista, setDataPrevista] = useState(v.data_prevista_baixa ?? "");
  // Una data ja passada que no es toca s'ha de poder tornar a enviar.
  const minData = v.data_prevista_baixa && v.data_prevista_baixa < avui ? v.data_prevista_baixa : avui;

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{v.matricula}</span>
        <span className="text-sm text-gray-700">{v.marca_model ?? "—"}</span>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{tv.estats[v.estat]}</span>
        {v.pendent && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{tv.pendents}</span>}
      </div>
      <p className="text-sm text-gray-600">
        {tv.cobertura(v.cobertura, v.franquicia)} · {tv.camps.dataAlta}: {data(v.data_alta)} · {tv.camps.prima}:{" "}
        {v.prima_total !== null ? eur.format(v.prima_total) : "—"}
      </p>
      {v.nota && (
        <p className="text-sm text-gray-600">
          {tv.camps.nota}: <span className="italic">{v.nota}</span>
        </p>
      )}

      <form action={accio} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={v.id} />
        <input type="hidden" name="versio" value={v.updated_at} />
        <label className="space-y-1">
          <span className="block text-sm text-gray-600">{tv.camps.motiu}</span>
          <select name="motiu" value={motiu} onChange={(e) => setMotiu(e.target.value)} className={camp}>
            <option value="">{tv.senseMotiu}</option>
            {MOTIUS.map((m) => (
              <option key={m} value={m}>
                {tv.motius[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-600">{tv.camps.responsable}</span>
          {motiu === "vs" ? (
            <input disabled value={tv.capPostvenda(capPostvenda)} className={`${camp} bg-gray-100`} />
          ) : (
            <select
              name="responsable"
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
              className={camp}
            >
              <option value="">{tv.senseResponsable}</option>
              {usuaris.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nom}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-600">{tv.camps.centre}</span>
          <select name="centre" value={centre} onChange={(e) => setCentre(e.target.value)} className={camp}>
            <option value="">{tv.senseCentre}</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-600">{tv.camps.dataPrevista}</span>
          <input
            type="date"
            name="dataPrevista"
            min={minData}
            value={dataPrevista}
            onChange={(e) => setDataPrevista(e.target.value)}
            className={camp}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={pendent}
            className="min-h-11 rounded-md bg-blue-700 px-4 font-medium text-white disabled:opacity-60"
          >
            {tv.desa}
          </button>
          {!pendent && estat.ok && <span className="text-sm text-green-800">{tv.desat}</span>}
          {!pendent && estat.error && <span className="text-sm text-red-700">{estat.error}</span>}
        </div>
      </form>
    </li>
  );
}
