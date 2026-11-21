import Link from "next/link";
import { t } from "@/lib/textos";
import { esAdmin, exigeixUsuariActiu } from "@/lib/usuari-actual";

const enllac = "inline-flex min-h-11 items-center px-2 text-sm text-gray-700 hover:underline";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Cada pàgina també ho comprova: el layout no es torna a executar en navegar entre pàgines.
  const usuari = await exigeixUsuariActiu();

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-white">
        <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-2 px-2 py-1">
          <Link href="/" className="inline-flex min-h-11 items-center px-2 font-semibold">
            {t.app.titol}
          </Link>
          <Link href="/" className={enllac}>
            {t.menu.inici}
          </Link>
          {esAdmin(usuari) && (
            <>
              <Link href="/admin/vehicles" className={enllac}>
                {t.menu.vehicles}
              </Link>
              <Link href="/admin/flota" className={enllac}>
                {t.menu.flota}
              </Link>
              <Link href="/admin/estoc" className={enllac}>
                {t.menu.estoc}
              </Link>
              <Link href="/admin/usuaris" className={enllac}>
                {t.menu.usuaris}
              </Link>
            </>
          )}
          <form action="/auth/sortir" method="post" className="ml-auto">
            <button type="submit" className={enllac}>
              {t.menu.sortir}
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
