import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { revisaAvisos } from "@/lib/avisos/servidor";

// La revisió envia diversos correus (pla Pro de Vercel: fins a 300 s).
export const maxDuration = 300;

/** Hora actual a Madrid (0-23). */
const horaMadrid = () =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Madrid" }).format(new Date()));
export const dynamic = "force-dynamic";

/** Revisió diària dels Avisos. La crida la tasca programada de Vercel amb `Authorization: Bearer CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const rebut = request.headers.get("authorization") ?? "";
  const esperat = `Bearer ${secret}`;
  if (!secret || rebut.length !== esperat.length || !timingSafeEqual(Buffer.from(rebut), Buffer.from(esperat))) {
    return NextResponse.json({ error: "no autoritzat" }, { status: 401 });
  }
  // Vercel programa en UTC: hi ha dues tasques (6:00 i 7:00 UTC) i només s'executa la que cau a les 8 de Madrid.
  if (request.nextUrl.searchParams.get("forca") !== "1" && horaMadrid() !== 8) {
    return NextResponse.json({ omesa: true, motiu: "no són les 8 a Madrid" });
  }
  try {
    return NextResponse.json(await revisaAvisos());
  } catch (err) {
    console.error("Error a la revisió d'avisos", err);
    return NextResponse.json({ error: "error" }, { status: 500 });
  }
}
