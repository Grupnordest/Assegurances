import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Client amb la clau de servei: salta RLS. Només per a operacions que la
 * sessió de l'usuari no pot fer (decidir l'accés, crear el primer admin).
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
