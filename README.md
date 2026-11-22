# Control d'assegurances — Grup Nordest

Eina interna per controlar els vehicles assegurats (pòlissa Tot risc i resta de pòlisses).
Definició del producte: `../_bmad-output/planning-artifacts/prd-grup-nordest-assegurances/prd.md`.

Stack: Next.js 15 (App Router) · Supabase (Auth + Postgres, regió UE) · Vercel · Tailwind.

## Posada en marxa (una sola vegada)

### 1. Supabase
1. Crea un projecte a [supabase.com](https://supabase.com) a la regió **Central EU (Frankfurt)**.
2. Executa **totes** les migracions de `supabase/migrations/` en ordre (0001, 0002…) (SQL Editor → enganxa i executa, o `supabase db push` amb la CLI). La 0006 dona els permisos de taula: sense ella l'eina rep "permission denied".
3. A **Project Settings → API** copia la URL, la clau `anon` i la clau `service_role`.

### 2. Microsoft Entra (inici de sessió amb Microsoft 365)
Ho ha de fer algú amb permisos d'administrador de Microsoft 365.
1. [entra.microsoft.com](https://entra.microsoft.com) → **Identitat → Aplicacions → Registres d'aplicacions → Registre nou**.
2. Nom: `Control d'assegurances`. Tipus de compte: **només aquest directori (un sol inquilí)**.
3. URI de redirecció (Web): `https://<projecte>.supabase.co/auth/v1/callback`.
4. Un cop creada, apunta l'**Id. d'aplicació (client)** i l'**Id. del directori (inquilí)**.
5. **Certificats i secrets → Secret de client nou**: copia el **valor** (només es veu un cop).
6. **Permisos d'API**: comprova que hi ha `email`, `openid` i `profile` (Microsoft Graph, delegats).

### 3. Proveïdor Azure a Supabase
**Authentication → Providers → Azure**: activa'l i omple
- Client ID = Id. d'aplicació
- Secret = valor del secret
- Azure Tenant URL = `https://login.microsoftonline.com/<Id. del directori>` — **mai** `/common`: així només poden entrar comptes del directori de Grup Nordest.

Deixa **desactivats** tots els altres proveïdors (Email, Google…). L'eina només accepta sessions del proveïdor Azure, tant al codi com a la base de dades.

A **Authentication → URL Configuration** posa com a Site URL l'adreça de l'eina (p. ex. la de Vercel) i afegeix `http://localhost:3000/**` a les Redirect URLs per treballar en local.

### 4. Variables d'entorn
Copia `.env.example` a `.env.local` i omple-les. A Vercel, posa les mateixes a **Settings → Environment Variables**.
`ADMIN_EMAILS` conté els correus que esdevenen administradors el primer cop que entren.
`AZURE_TENANT_ID` (opcional) restringeix l'accés al directori de Microsoft indicat; omple-la un cop comprovat que l'inici de sessió funciona.

### 5. Correu a la corredoria (Microsoft Graph)
Les baixes s'envien des de `assegurances@` amb una aplicació d'Entra pròpia (separada de la d'inici de sessió):
1. **Registres d'aplicacions → Registre nou**: `Control assegurances – correu`, un sol inquilí.
2. **Permisos d'API → Microsoft Graph → Permisos d'aplicació → `Mail.Send`** i **Concedeix el consentiment d'administrador**.
3. **Certificats i secrets → Secret nou** → valor a `MS_GRAPH_CLIENT_SECRET`; l'Id. d'aplicació a `MS_GRAPH_CLIENT_ID`; `AZURE_TENANT_ID` és obligatori.
4. **Limita-la només a `assegurances@`** (sense això podria enviar en nom de qualsevol bústia), amb PowerShell d'Exchange Online:
   ```powershell
   Connect-ExchangeOnline
   New-ApplicationAccessPolicy -AppId <Id. d'aplicació> -PolicyScopeGroupId assegurances@grupnordest.com -AccessRight RestrictAccess -Description "Control assegurances: només assegurances@"
   Test-ApplicationAccessPolicy -Identity assegurances@grupnordest.com -AppId <Id. d'aplicació>   # → Granted
   ```
5. Mentre es prova, posa la teva adreça a `CORREU_PROVES`: tots els correus hi aniran i la corredoria no en rebrà cap.
6. L'enviament d'estoc a Proassa (pantalla **Vehicles flota**) va a `CORREU_PROASSA` amb còpia a `CORREU_COPIA_ADMIN`; `CORREU_PROVES` també el desvia.

### 6. Publicar a Vercel i avisos diaris
1. A Vercel (pla Pro: és un ús d'empresa), **Add New → Project** i importa el repositori de GitHub.
2. **Settings → Environment Variables**: totes les de `.env.local` (les secretes, marcades com a *Sensitive*). `APP_URL` = l'adreça de Vercel (p. ex. `https://assegurances.vercel.app`); `CRON_SECRET` = una clau aleatòria llarga.
3. A Supabase (**Authentication → URL Configuration**) posa l'adreça de Vercel com a Site URL i afegeix `https://…/**` a les Redirect URLs. A Entra, a l'app d'inici de sessió no cal tocar res (la redirecció és la de Supabase).
4. `vercel.json` programa la revisió d'avisos (`/api/avisos`) de dilluns a divendres a les 6:00 i 7:00 UTC; només s'executa la que cau a les 8:00 de Madrid (hivern i estiu). Administració també la pot executar a Inici amb **Revisa els avisos ara**. Cada revisió crea com a molt 20 avisos nous (la resta, el dia següent).

## Desenvolupament

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # tests
npm run lint
npm run build
```

## Accés
- Només entren comptes `@grupnordest.com` donats d'alta a la taula `usuaris` i actius.
- Rols: Sol·licitant, Validador, Cap de postvenda, Administració (acumulables).
- Els permisos es comproven al servidor (Server Actions) i a la base de dades (RLS).
