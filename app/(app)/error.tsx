"use client";

import { t } from "@/lib/textos";

export default function ErrorApp({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{t.error.titol}</h1>
      <p className="text-gray-700">{t.error.text}</p>
      <button type="button" onClick={reset} className="min-h-11 rounded-md border px-4">
        {t.error.reintenta}
      </button>
    </section>
  );
}
