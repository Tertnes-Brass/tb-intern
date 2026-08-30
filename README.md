# Tertnes Brass · Notearkiv

Notearkiv, publisering og deling av noter for brass band — bygget for [Tertnes Brass](https://tertnesbrass.no), tenkt delt med andre korps etter hvert.

**Idéen:** Arkivaren katalogiserer verkene én gang, med PDF per stemme. Deretter er en ny konsert bare å klikke sammen et program — hvert medlem ser *sine* stemmer («Mine noter»), og vikarer får en tidsbegrenset lenke med kun sine stemmer, uten innlogging.

> **Status: fase 1 — i produksjon på [noter.tertnesbrass.com](https://noter.tertnesbrass.com)** (invitasjonsbasert).
> Kjørbar lokalt uten Cloudflare-konto. All demodata er kunstig (inkl. genererte note-PDF-er) — ingen rettighetsbelagte noter i repoet.

`noter.tertnesbrass.com` er det kanoniske produksjonsdomenet — alle lenker, auth-callbacks og e-poster skal peke dit; det tidligere `noter.saynain.com` fases ut og skal ikke brukes.

## Funksjoner

- **Verksarkiv** — katalog med komponist/arrangør, grad, varighet, fysisk plassering, søk
- **Stemme-gjenkjenning** — slipp 20 PDF-er på et verk; stemmen gjettes fra filnavnet («Gaelforce – 2nd Cornet.pdf» → 2. kornett, norske og engelske navn)
- **Prosjekter** — sesonger, program i rekkefølge, publisering (utkast er kun synlig for stab)
- **Mine noter** — medlemmet ser neste konsert med direktelenker til egne stemmer, partitur og lytteeksempler (YouTube/lyd)
- **Vikarlenker** — del valgte stemmer for ett prosjekt; lenken utløper automatisk og kan trekkes tilbake; kun hash av tokenet lagres
- **Innlogging** — [better-auth](https://better-auth.com): e-postkode som standard, valgfritt passord og magisk lenke, invitasjonsbasert (ingen åpen registrering). Google/passkeys kan legges til senere.
- **RBAC** — roller (admin/arkivar/dirigent/musiker) med rettigheter i database, håndhevet server-side i alle funksjoner
- **Tilgangsstyrte filer** — alle PDF-er streames via API med sesjons- eller token-sjekk; partitur er rettighetsstyrt (scores.view); ingen offentlige filer
- **Kalender** — øvelser og konserter hentes fra korpsets Google-kalender (iCal) og vises på `/kalender`; Google forblir stedet man redigerer

## Innlogging og invitasjon

Ingen kan registrere seg selv. Flyten er:

1. **Første admin** bootstrappes via `ADMIN_EMAIL` (wrangler.jsonc) — første innlogging med den adressen blir automatisk admin.
2. Admin **inviterer** medlemmer (e-post + rolle + stemme) under *Medlemmer*. En innloggingslenke sendes på e-post (eller del-en-lenke via Spond hvis e-post ikke er satt opp).
3. Medlemmet logger inn med en **engangskode på e-post**. Passord og magisk lenke er valgfrie alternativer.

## Kom i gang (lokalt)

```bash
pnpm install
cp .dev.vars.example .dev.vars          # sett ADMIN_EMAIL til din e-post
pnpm exec wrangler d1 migrations apply tb-notearkiv --local
pnpm dev
```

Seed besetning + roller + demoinnhold (kun i dev): `curl -X POST http://localhost:3000/api/dev-seed`.
I dev sendes ikke e-post — koder og magiske lenker skrives til serverkonsollen (og miniflares e-postmappe). Logg inn med `ADMIN_EMAIL` for admin, eller en av de seedede demo-adressene (f.eks. `jonas@demo.tertnesbrass.no`).

For e-postfri nettlesertesting kan lokale agenter og utviklere åpne
`http://localhost:3000/api/dev-login?to=/`. Ruten seeder og logger inn standard-
demoadministratoren. Velg en annen seedet rolle med `as`, for eksempel
`/api/dev-login?as=jonas@demo.tertnesbrass.no&to=/arkiv`. Ruten svarer 404 i
produksjonsbygg og godtar bare adressene i `SEED_MEMBERS`.

Nullstill lokalt ved å slette `.wrangler/state` og kjøre migreringen på nytt.

## Auth-skjema

better-auth eier `user`/`session`/`account`/`verification` (generert til `src/db/auth-schema.ts` med `pnpm auth:generate`). RBAC ligger i egne tabeller: `member_profiles` (1:1 mot `user.id`, rolle + aktiv-status), `roles`, `role_permissions`, `parts`, `user_parts`, og `invitations`.

## Kalender

Korpset fortsetter å redigere kalenderen i Google Calendar. Internsiden leser den
og viser den på `/kalender`, slik at medlemmene slipper å åpne Google.

**Finn adressene i Google Calendar** → tannhjulet → *Innstillinger* → velg
kalenderen i menyen til venstre:

- **«Hemmelig adresse i iCal-format»** (under *Integrer kalender*) — hendelsene
  hentes herfra. Adressen gir full lesetilgang uten innlogging, så den er en
  **hemmelighet**: den skal aldri i git, aldri i logger og aldri til nettleseren.
  Trykk *Tilbakestill* i Google hvis den lekker.
- **«Offentlig URL til denne kalenderen»** / embed-koden — brukes til den
  innebygde månedsvisningen nederst på siden. Krever at kalenderen er delt
  offentlig. Valgfri; utelates den, vises ingen `<iframe>`.

**Sett dem lokalt** i `.dev.vars`:

```
CALENDAR_ICS_URL=https://calendar.google.com/calendar/ical/.../private-.../basic.ics
CALENDAR_EMBED_URL=https://calendar.google.com/calendar/embed?src=...
```

**Sett dem i produksjon:**

```bash
pnpm exec wrangler secret put CALENDAR_ICS_URL   # hemmelig — kun som secret
# CALENDAR_EMBED_URL er ikke hemmelig: legg verdien i "vars" i wrangler.jsonc
```

Uten `CALENDAR_ICS_URL` er siden en rolig tomtilstand («Kalenderen er ikke koblet
til ennå») — ingen feil. Feeden caches i ti minutter, så den hentes ikke på hver
sidevisning.

## Stack

| Lag | Valg |
|---|---|
| Rammeverk | [TanStack Start](https://tanstack.com/start) (React, SSR + server functions) |
| Hosting | [Cloudflare Workers](https://developers.cloudflare.com/workers/) (gratisplan) |
| Database | Cloudflare D1 (SQLite) + [Drizzle ORM](https://orm.drizzle.team) |
| Fillagring | Cloudflare R2 (privat bucket, gratis egress) |
| Styling | Tailwind CSS v4, eget design-system («Konsertprogrammet») |
| PDF | pdf-lib (sidetelling + demo-generering) |

Begrunnelse, datamodell og veikart: se [PLAN.md](PLAN.md).

## Deploy til Cloudflare

```bash
pnpm exec wrangler d1 create tb-notearkiv           # legg database_id inn i wrangler.jsonc
pnpm exec wrangler r2 bucket create tb-notearkiv-files
pnpm exec wrangler d1 migrations apply tb-notearkiv --remote
pnpm exec wrangler secret put BETTER_AUTH_SECRET    # `openssl rand -base64 32`
pnpm exec wrangler email sending enable tertnesbrass.com # e-postkode + lenker/reset (dashboard hvis token mangler scope)
pnpm run deploy                                     # migrerer D1 før Worker-koden deployes
```

`pnpm run deploy` anvender alltid ventende D1-migrasjoner før ny Worker-kode
publiseres. Dermed kan ikke kode som forventer et nytt skjema bli deployet før
skjemaet er på plass. Sett `ADMIN_EMAIL` + `BETTER_AUTH_URL` i `wrangler.jsonc`
før første deploy.

Logg så inn med `ADMIN_EMAIL`-adressen (blir admin automatisk) og inviter resten. Custom domene (`noter.tertnesbrass.com`) som ikke skal være bak Cloudflare Access må ha en egen Access-app med **Bypass / Everyone**, ellers blokkeres besøkende.

## Veikart (kort)

- **Fase 1 (gjort)** — better-auth (e-postkode + valgfritt passord/magisk lenke, invitasjonsbasert), e-post via Cloudflare, prod på noter.tertnesbrass.com
- **Neste** — passkey/sterk autentisering for privilegerte roller, Google-innlogging, import fra dagens Google Sheets/Drive, backup-cron (D1-dump + rclone til off-site)
- **Fase 2** — PDF-splitter i nettleser (samle-PDF → stemmer), ZIP-nedlasting og e-postvarsler
- **Fase 3** — «deploy your own»-dokumentasjon for andre korps, besetning som konfigurasjon (janitsjar m.m.), lisensvalg

## Lisens

Ikke avklart ennå — AGPL-3.0 vurderes (åpen kildekode med mulighet for hostet tjeneste). Ta kontakt før gjenbruk.
