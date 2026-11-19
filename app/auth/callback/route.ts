import { NextResponse, type NextRequest } from "next/server";
import { decideixAcces, parseAdminEmails } from "@/lib/acces";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buscaUsuariPerEmail, identitatDe, tenantEsperat } from "@/lib/usuari-actual";

/** Retorn de Microsoft: obre la sessió i aplica la regla d'accés (FR-1). */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const supabase = await createClient();

  const denega = async (motiu: string) => {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.redirect(`${origin}/sense-acces?motiu=${motiu}`);
  };

  if (!code) return NextResponse.redirect(`${origin}/login?error=1`);

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${origin}/login?error=1`);

  const identitat = identitatDe(data.user);
  try {
    const usuari = identitat.email ? await buscaUsuariPerEmail(identitat.email) : null;
    const decisio = decideixAcces(identitat, usuari, parseAdminEmails(process.env.ADMIN_EMAILS), tenantEsperat());

    if (decisio.tipus === "denega") return denega(decisio.motiu);

    if (decisio.tipus === "crea-admin") {
      const nomAzure = String(data.user.user_metadata?.full_name ?? "").trim();
      // Una sola transacció i idempotent: dos inicis simultanis no fallen.
      const { error: errAlta } = await createAdminClient().rpc("crea_admin_inicial", {
        p_email: identitat.email,
        p_nom: nomAzure || identitat.email,
      });
      if (errAlta) throw errAlta;
    }
  } catch (e) {
    console.error("Error validant l'accés", e);
    return denega("error");
  }

  return NextResponse.redirect(`${origin}/`);
}
