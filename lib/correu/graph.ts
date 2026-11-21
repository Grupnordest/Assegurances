import "server-only";
import { destinataris, llegeixConfigCorreu, type ConfigCorreu, type Destinataris } from "./config";
import type { Correu } from "./plantilles";

export type Adjunt = { nom: string; contingut: Uint8Array; tipus: string };

/** Error d'enviament: el correu no ha sortit. */
export class ErrorCorreu extends Error {
  /**
   * `incert` = no se sap si el correu ha sortit (timeout o error de xarxa durant sendMail).
   * Si és fals, és segur que no ha sortit (configuració, token o Graph ha respost amb error).
   */
  constructor(
    missatge: string,
    readonly incert: boolean,
    readonly detall?: unknown,
  ) {
    super(missatge);
    this.name = "ErrorCorreu";
  }
}

export function configCorreu(): ConfigCorreu {
  const r = llegeixConfigCorreu(process.env);
  if (!r.ok) throw new ErrorCorreu(`Falten variables d'entorn del correu: ${r.falten.join(", ")}`, false);
  return r.config;
}

async function token(c: ConfigCorreu): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ErrorCorreu("No s'ha pogut obtenir el token de Microsoft", false, await res.text());
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new ErrorCorreu("Resposta de token sense access_token", false);
  return json.access_token;
}

const adreces = (llista: string[]) => llista.map((address) => ({ emailAddress: { address } }));

/** Envia un correu des de la Bústia d'assegurances (Microsoft Graph sendMail). */
// `dest`: destinataris propis (p. ex. Proassa); per defecte, la Corredoria de Tot risc.
export async function enviaCorreu(correu: Correu, adjunts: Adjunt[] = [], dest?: Destinataris): Promise<void> {
  const c = configCorreu();
  const d = dest ?? destinataris(c);
  let accessToken: string;
  try {
    accessToken = await token(c);
  } catch (err) {
    if (err instanceof ErrorCorreu) throw err;
    throw new ErrorCorreu("Error de xarxa obtenint el token", false, err);
  }

  let res: Response;
  try {
    res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.remitent)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: correu.assumpte,
          body: { contentType: "Text", content: correu.cos },
          toRecipients: adreces(d.to),
          ccRecipients: adreces(d.cc),
          attachments: adjunts.map((a) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: a.nom,
            contentType: a.tipus,
            contentBytes: Buffer.from(a.contingut).toString("base64"),
          })),
        },
        saveToSentItems: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Timeout o xarxa: Graph pot haver acceptat el correu. No es pot saber.
    throw new ErrorCorreu("Sense resposta de Graph enviant el correu", true, err);
  }
  // Graph respon 202 Accepted quan accepta el correu; qualsevol altre codi = no enviat.
  if (res.status !== 202) {
    throw new ErrorCorreu(`Graph sendMail ha respost ${res.status}`, false, await res.text().catch(() => ""));
  }
}
