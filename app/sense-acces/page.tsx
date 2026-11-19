import Link from "next/link";
import type { MotiuDenegacio } from "@/lib/acces";
import { t } from "@/lib/textos";

export default async function SenseAccesPage({ searchParams }: { searchParams: Promise<{ motiu?: string }> }) {
  const { motiu } = await searchParams;
  const missatge =
    motiu && Object.hasOwn(t.senseAcces.motius, motiu)
      ? t.senseAcces.motius[motiu as MotiuDenegacio]
      : t.senseAcces.generic;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">{t.senseAcces.titol}</h1>
      <p className="text-gray-700">{missatge}</p>
      <Link href="/login" className="py-2 text-blue-700 underline">
        {t.senseAcces.tornar}
      </Link>
    </main>
  );
}
