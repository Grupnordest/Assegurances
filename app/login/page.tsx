import { t } from "@/lib/textos";
import BotoMicrosoft from "./boto-microsoft";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">{t.app.titol}</h1>
        <p className="mt-2 text-gray-600">{t.login.explicacio}</p>
      </div>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{t.login.error}</p>}
      <BotoMicrosoft />
    </main>
  );
}
