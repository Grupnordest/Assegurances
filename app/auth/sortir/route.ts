import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MOTIUS = new Set(["domini", "no-alta", "desactivat"]);

function desti(request: NextRequest) {
  const motiu = request.nextUrl.searchParams.get("motiu");
  const ruta = motiu && MOTIUS.has(motiu) ? `/sense-acces?motiu=${motiu}` : "/login";
  return new URL(ruta, request.nextUrl.origin);
}

async function tancaSessio() {
  const supabase = await createClient();
  // Només aquest dispositiu.
  await supabase.auth.signOut({ scope: "local" });
}

/** Botó "Surt" (formulari POST de la mateixa web). */
export async function POST(request: NextRequest) {
  await tancaSessio();
  return NextResponse.redirect(desti(request), { status: 303 });
}

/**
 * Redirecció des de les pàgines quan l'usuari ja no té accés. Una petició
 * GET d'una altra web (p. ex. una imatge) no tanca la sessió.
 */
export async function GET(request: NextRequest) {
  const origen = request.headers.get("sec-fetch-site");
  if (!origen || origen === "same-origin" || origen === "none") await tancaSessio();
  return NextResponse.redirect(desti(request), { status: 303 });
}
