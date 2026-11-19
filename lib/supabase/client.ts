import { createBrowserClient } from "@supabase/ssr";

/** Client de Supabase per al navegador (només per iniciar sessió). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
