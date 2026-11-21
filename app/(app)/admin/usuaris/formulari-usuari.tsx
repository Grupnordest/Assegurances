"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROLS, type Rol } from "@/lib/acces";
import { t } from "@/lib/textos";
import { desaUsuari, type EstatFormulari } from "./actions";

type Props = {
  centres: { id: number; nom: string }[];
  usuari?: { id: string; nom: string; email: string; centreId: number | null; rols: Rol[] };
};

const camp = "w-full rounded-md border px-3 py-2";

export default function FormulariUsuari({ centres, usuari }: Props) {
  const router = useRouter();
  const [estat, accio, enviant] = useActionState<EstatFormulari, FormData>(desaUsuari, {});

  useEffect(() => {
    if (estat.ok) router.push("/admin/usuaris");
  }, [estat.ok, router]);

  return (
    <form action={accio} className="space-y-4 rounded-md border bg-white p-4">
      <h2 className="text-lg font-semibold">{usuari ? usuari.nom : t.usuaris.nou}</h2>
      {usuari && <input type="hidden" name="id" value={usuari.id} />}

      <label className="block space-y-1">
        <span className="text-sm text-gray-600">{t.usuaris.camps.nom}</span>
        <input name="nom" required defaultValue={usuari?.nom} className={camp} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-gray-600">{t.usuaris.camps.email}</span>
        <input name="email" type="email" required defaultValue={usuari?.email} className={camp} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-gray-600">{t.usuaris.camps.centre}</span>
        <select name="centreId" defaultValue={usuari?.centreId ?? ""} className={camp}>
          <option value="">{t.usuaris.totsCentres}</option>
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm text-gray-600">{t.usuaris.camps.rols}</legend>
        {ROLS.map((rol) => (
          <label key={rol} className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              name="rols"
              value={rol}
              defaultChecked={usuari?.rols.includes(rol)}
              className="h-5 w-5"
            />
            {t.rols[rol]}
          </label>
        ))}
      </fieldset>

      {estat.error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{estat.error}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={enviant}
          className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {t.usuaris.desa}
        </button>
        <Link href="/admin/usuaris" className="rounded-md border px-4 py-2">
          {t.usuaris.cancela}
        </Link>
      </div>
    </form>
  );
}
