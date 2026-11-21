import Link from "next/link";
import { redirect } from "next/navigation";
import { ROLS, type Rol } from "@/lib/acces";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";
import BotoActiu from "./boto-actiu";
import FormulariUsuari from "./formulari-usuari";
import { hiHaCapPostvendaActiu } from "./regles";

type Fila = {
  id: string;
  nom: string;
  email: string;
  actiu: boolean;
  centre_id: number | null;
  centres: { nom: string } | null;
  usuari_rols: { rol: Rol }[];
};

type Params = { centre?: string; rol?: string; edita?: string; nou?: string };

export default async function UsuarisPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!esAdmin(await exigeixUsuariActiu())) redirect("/");

  const { centre, rol, edita, nou } = await searchParams;
  const supabase = await createClient();
  const [{ data: centres, error: errCentres }, { data: files, error: errUsuaris }] = await Promise.all([
    supabase.from("centres").select("id, nom").order("id").returns<{ id: number; nom: string }[]>(),
    supabase
      .from("usuaris")
      .select("id, nom, email, actiu, centre_id, centres(nom), usuari_rols(rol)")
      .order("nom")
      .returns<Fila[]>(),
  ]);
  if (errCentres) throw errCentres;
  if (errUsuaris) throw errUsuaris;

  const usuaris = files.map((u) => ({ ...u, rols: u.usuari_rols.map((r) => r.rol) }));
  const filtrats = usuaris.filter(
    (u) => (!centre || String(u.centre_id) === centre) && (!rol || u.rols.includes(rol as Rol)),
  );
  const editat = edita ? usuaris.find((u) => u.id === edita) : undefined;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.usuaris.titol}</h1>
        <Link href="/admin/usuaris?nou=1" className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white">
          {t.usuaris.nou}
        </Link>
      </div>

      {!hiHaCapPostvendaActiu(usuaris) && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{t.usuaris.avisSenseCapPostvenda}</p>
      )}

      {(nou || editat) && (
        <FormulariUsuari
          key={editat?.id ?? "nou"}
          centres={centres}
          usuari={
            editat && { id: editat.id, nom: editat.nom, email: editat.email, centreId: editat.centre_id, rols: editat.rols }
          }
        />
      )}

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="space-y-1">
          <span className="block text-sm text-gray-600">{t.usuaris.filtreCentre}</span>
          <select name="centre" defaultValue={centre ?? ""} className="rounded-md border px-3 py-2">
            <option value="">{t.usuaris.tots}</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-600">{t.usuaris.filtreRol}</span>
          <select name="rol" defaultValue={rol ?? ""} className="rounded-md border px-3 py-2">
            <option value="">{t.usuaris.tots}</option>
            {ROLS.map((r) => (
              <option key={r} value={r}>
                {t.rols[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md border px-4 py-2">
          {t.usuaris.filtra}
        </button>
      </form>

      {filtrats.length === 0 ? (
        <p className="text-gray-600">{t.usuaris.buit}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-white">
          {filtrats.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {u.nom}{" "}
                  {!u.actiu && (
                    <span className="ml-1 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">{t.usuaris.inactiu}</span>
                  )}
                </p>
                <p className="break-all text-sm text-gray-600">{u.email}</p>
                <p className="text-sm text-gray-600">
                  {u.centres?.nom ?? t.usuaris.totsCentres} · {u.rols.map((r) => t.rols[r]).join(", ")}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Link href={`/admin/usuaris?edita=${u.id}`} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm">
                  {t.usuaris.edita}
                </Link>
                <BotoActiu id={u.id} actiu={u.actiu} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
