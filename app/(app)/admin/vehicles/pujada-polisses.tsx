"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { matriculaDelNom } from "@/lib/polisses/matricula";
import { t } from "@/lib/textos";
import { acabaPujadaPolisses, desaPolissaLot } from "./baixa-actions";
import { MIDA_PDF } from "./regles";

export type VehiclePolissa = { id: string; matricula: string; tePolissa: boolean; baixaPendent: boolean };

type Previa =
  | { tipus: "assignat"; vehicle: VehiclePolissa }
  | { tipus: "alText" }
  | { tipus: "noPdf" | "massaGran" }
  | { tipus: "duplicat"; matricula: string };

type Fila = { fitxer: File; previa: Previa; resultat?: { ok: boolean; text: string } };

const tp = t.vehicles.polisses;
const boto = "min-h-11 rounded-md px-4 font-medium disabled:opacity-60";

function textPrevia(p: Previa): string {
  switch (p.tipus) {
    case "assignat":
      if (p.vehicle.baixaPendent) return tp.baixa(p.vehicle.matricula);
      return p.vehicle.tePolissa ? tp.substitueix(p.vehicle.matricula) : tp.assignat(p.vehicle.matricula);
    case "alText":
      return tp.alText;
    case "noPdf":
      return tp.noPdf;
    case "massaGran":
      return tp.massaGran;
    case "duplicat":
      return tp.duplicat(p.matricula);
  }
}

const esDesable = (p: Previa) => p.tipus === "assignat" || p.tipus === "alText";

/** Pujada massiva de pòlisses AXA: vista prèvia per matrícula del nom i desat fitxer a fitxer. */
export default function PujadaPolisses({ vehicles }: { vehicles: VehiclePolissa[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<Fila[]>([]);
  const [progres, setProgres] = useState<number | null>(null);
  const [sobre, setSobre] = useState(false);

  const perMatricula = new Map(vehicles.map((v) => [v.matricula, v]));

  function afegeix(llista: FileList | null) {
    if (!llista) return;
    setFiles((anteriors) => {
      const vistes = new Set(
        anteriors.flatMap((f) => (f.previa.tipus === "assignat" && !f.resultat ? [f.previa.vehicle.matricula] : [])),
      );
      const noves = [...llista].map<Fila>((fitxer) => {
        if (!/\.pdf$/i.test(fitxer.name) && fitxer.type !== "application/pdf") return { fitxer, previa: { tipus: "noPdf" } };
        if (fitxer.size > MIDA_PDF) return { fitxer, previa: { tipus: "massaGran" } };
        const m = matriculaDelNom(fitxer.name, perMatricula.keys());
        if (!m) return { fitxer, previa: { tipus: "alText" } };
        if (vistes.has(m)) return { fitxer, previa: { tipus: "duplicat", matricula: m } };
        vistes.add(m);
        return { fitxer, previa: { tipus: "assignat", vehicle: perMatricula.get(m)! } };
      });
      return [...anteriors.filter((f) => !f.resultat), ...noves];
    });
  }

  async function desa() {
    const pendents = files.map((f, i) => [f, i] as const).filter(([f]) => esDesable(f.previa) && !f.resultat);
    setProgres(0);
    // Vehicles que ja tenen fitxer en aquest lot: un PDF llegit pel text no els pot trepitjar.
    const exclou = new Set(
      pendents.flatMap(([f]) => (f.previa.tipus === "assignat" ? [f.previa.vehicle.id] : [])),
    );
    for (const [n, [f, i]] of pendents.entries()) {
      const fd = new FormData();
      fd.set("fitxer", f.fitxer);
      if (f.previa.tipus === "assignat") fd.set("vehicle", f.previa.vehicle.id);
      else fd.set("exclou", [...exclou].join(","));
      let resultat: Fila["resultat"];
      try {
        const r = await desaPolissaLot(fd);
        if ("ok" in r) {
          const id = perMatricula.get(r.matricula)?.id;
          if (id) exclou.add(id);
        }
        resultat =
          "ok" in r
            ? { ok: true, text: r.baixaEnviada ? tp.desatBaixa(r.matricula) : tp.desat(r.matricula) }
            : { ok: false, text: r.error };
      } catch {
        resultat = { ok: false, text: t.vehicles.errors.generic };
      }
      setFiles((ara) => ara.map((x, j) => (j === i ? { ...x, resultat } : x)));
      setProgres(n + 1);
    }
    await acabaPujadaPolisses();
    setProgres(null);
    router.refresh();
  }

  const desables = files.filter((f) => esDesable(f.previa) && !f.resultat).length;
  const ocupat = progres !== null;

  return (
    <div className="space-y-3 rounded-md border bg-white p-3">
      <p className="font-medium">{tp.titol}</p>
      <p className="text-sm text-gray-700">{tp.ajuda}</p>
      <label
        onDragOver={(ev) => {
          ev.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(ev) => {
          ev.preventDefault();
          setSobre(false);
          if (!ocupat) afegeix(ev.dataTransfer.files);
        }}
        className={`flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-3 text-sm ${sobre ? "border-gray-900 bg-gray-50" : "border-gray-300"}`}
      >
        <span className="font-medium underline">{tp.tria}</span>
        <span className="text-gray-600">{tp.arrossega}</span>
        <input
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={ocupat}
          onChange={(ev) => {
            afegeix(ev.target.files);
            ev.target.value = "";
          }}
        />
      </label>

      {files.length > 0 && (
        <>
          <ul className="divide-y rounded-md border text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 p-2">
                <span className="break-all">{f.fitxer.name}</span>
                <span
                  className={
                    f.resultat
                      ? f.resultat.ok
                        ? "text-green-800"
                        : "text-red-800"
                      : esDesable(f.previa)
                        ? "text-gray-700"
                        : "text-amber-900"
                  }
                >
                  {f.resultat ? f.resultat.text : textPrevia(f.previa)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={desa}
              disabled={ocupat || desables === 0}
              className={`${boto} bg-gray-900 text-white`}
            >
              {ocupat ? tp.desant(progres, desables + progres) : tp.desa(desables)}
            </button>
            <button type="button" onClick={() => setFiles([])} disabled={ocupat} className={`${boto} border bg-white`}>
              {tp.neteja}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
