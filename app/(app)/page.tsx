import { t } from "@/lib/textos";
import { exigeixUsuariActiu } from "@/lib/usuari-actual";

export default async function IniciPage() {
  const usuari = await exigeixUsuariActiu();

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t.inici.hola(usuari.nom)}</h1>
      <dl className="space-y-2 rounded-md border bg-white p-4">
        <div>
          <dt className="text-sm text-gray-500">{t.inici.centre}</dt>
          <dd>{usuari.centre?.nom ?? t.inici.senseCentre}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">{t.inici.rols}</dt>
          <dd>{usuari.rols.length ? usuari.rols.map((r) => t.rols[r]).join(", ") : t.inici.senseRols}</dd>
        </div>
      </dl>
    </section>
  );
}
