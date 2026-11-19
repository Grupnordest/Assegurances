"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { t } from "@/lib/textos";

export default function BotoMicrosoft() {
  const [carregant, setCarregant] = useState(false);

  // En tornar enrere des de Microsoft, el navegador pot restaurar la pàgina amb el botó desactivat.
  useEffect(() => {
    const reactiva = () => setCarregant(false);
    window.addEventListener("pageshow", reactiva);
    return () => window.removeEventListener("pageshow", reactiva);
  }, []);

  async function entra() {
    setCarregant(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "azure",
      options: { scopes: "email", redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setCarregant(false);
      window.location.href = "/login?error=1";
    }
  }

  return (
    <button
      type="button"
      onClick={entra}
      disabled={carregant}
      className="min-h-11 w-full rounded-md bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
    >
      {t.login.boto}
    </button>
  );
}
