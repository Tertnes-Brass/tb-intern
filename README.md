# Tertnes Brass · Notearkiv

Notearkiv, publisering og deling av noter for brass band — bygget for [Tertnes Brass](https://tertnesbrass.no), tenkt delt med andre korps etter hvert.

**Idéen:** Arkivaren katalogiserer verkene én gang, med PDF per stemme. Deretter er en ny konsert bare å klikke sammen et program — hvert medlem ser *sine* stemmer («Mine noter»), og vikarer får en tidsbegrenset lenke med kun sine stemmer, uten innlogging.

> **Status: fase 1 — i produksjon på [noter.tertnesbrass.com](https://noter.tertnesbrass.com)** (invitasjonsbasert).
> Kjørbar lokalt uten Cloudflare-konto. All demodata er kunstig (inkl. genererte note-PDF-er) — ingen rettighetsbelagte noter i repoet.

## Funksjoner

- **Verksarkiv** — katalog med komponist/arrangør, grad, varighet, fysisk plassering, søk
- **Stemme-gjenkjenning** — slipp 20 PDF-er på et verk; stemmen gjettes fra filnavnet («Gaelforce – 2nd Cornet.pdf» → 2. kornett, norske og engelske navn)
- **Prosjekter** — sesonger, program i rekkefølge, publisering (utkast er kun synlig for stab)
- **Mine noter** — medlemmet ser neste konsert med direktelenker til egne stemmer, partitur og lytteeksempler (YouTube/lyd)
- **Vikarlenker** — del valgte stemmer for ett prosjekt; lenken utløper automatisk og kan trekkes tilbake; kun hash av tokenet lagres
- **Innlogging** — [better-auth](https://better-auth.com): e-postkode som standard, valgfritt passord og magisk lenke, invitasjonsbasert (ingen åpen registrering). Google/passkeys kan legges til senere.
- **RBAC** — roller (admin/arkivar/dirigent/musiker) med rettigheter i database, håndhevet server-side i alle funksjoner
- **Tilgangsstyrte filer** — alle PDF-er streames via API med sesjons- eller token-sjekk; partitur er rettighetsstyrt (scores.view); ingen offentlige filer

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

## Backup og gjenoppretting

Notearkivet er uerstattelig, så det sikres på flere uavhengige lag:

| Lag | Hva | Hvor |
|---|---|---|
| D1 PITR | Innebygd point-in-time recovery, 30 dager | Cloudflare |
| Ukentlig SQL-dump | Cron skriver hele databasen som SQL til R2 | R2 `backups/` (8 siste uker) |
| Off-site | Kopi av notefiler + dumper til uavhengig lokasjon | Backblaze B2 / lokal disk |

### Automatisk ukentlig dump (cron)

En [Cron Trigger](wrangler.jsonc) (`0 4 * * 0` — søndag 04:00 UTC) kaller `scheduled()`-handleren i [src/server.ts](src/server.ts), som kjører [`runBackup()`](src/server/backup.ts). Den dumper hele D1-en (skjema + data, samme format som `sqlite3 .dump`) til R2 under `backups/tb-notearkiv-<ISO>.sql` og roterer ut alt eldre enn de 8 nyeste. Dumpen er selvstendig — den bruker kun `DB`- og `FILES`-bindingene, ingen ekstra secrets.

Resultatet logges til Workers-observability: `[backup] OK trigger=… key=… tabeller=… rader=… bytes=…`.

Test cron-handleren lokalt (vite-dev forwarder `/cdn-cgi/handler/*` til Worker-en):

```bash
pnpm dev                                                   # i ett terminalvindu
curl "http://localhost:3000/cdn-cgi/handler/scheduled?cron=0+4+*+*+0"
# → se "[backup] OK …" i dev-loggen; dumpen havner i lokal R2 (.wrangler/state)
```

### Manuell dump

```bash
pnpm backup:export        # wrangler d1 export tb-notearkiv --remote → backups/manual-<dato>.sql
```

### Off-site-kopi (rclone)

[scripts/offsite-sync.sh](scripts/offsite-sync.sh) speiler R2 til en uavhengig lokasjon med [rclone](https://rclone.org): SQL-dumpene kopieres additivt (beholdes for alltid), notefilene speiles. Engangsoppsett av R2- og B2-/disk-remotes er dokumentert øverst i scriptet. Kjør manuelt eller planlagt:

```bash
brew install rclone                                        # + rclone config (se scriptet)
OFFSITE="offsite:min-b2-bucket" pnpm backup:offsite        # eller OFFSITE=/Volumes/Backup/...
```

#### Automatisk off-site via GitHub Actions

[.github/workflows/offsite-backup.yml](.github/workflows/offsite-backup.yml) kjører off-site-synken ukentlig (søndag 05:00 UTC, én time etter Worker-cron-en) og kjører **restore-test på den nyeste dumpen** etterpå — så vi får bekreftet hver uke at backupene lar seg gjenopprette. Workflowen feiler synlig hvis noe er galt.

For å skru den på, legg inn disse repo-secretene (Settings → Secrets and variables → Actions):

| Secret | Hva |
|---|---|
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 S3 API-token (R2 → Manage R2 API Tokens), lesetilgang til bøtta |
| `R2_ACCOUNT_ID` | Cloudflare account-id (brukes i R2-endepunktet) |
| `B2_KEY_ID`, `B2_APP_KEY` | Backblaze B2 application key |
| `B2_BUCKET` | Navn på B2-bøtta dumper/filer speiles til |

rclone konfigureres fra disse via miljøvariabler i selve workflowen — ingen `rclone config` trengs i CI. Kjør den manuelt fra Actions-fanen («Run workflow») for å teste oppsettet. Alternativt kan `scripts/offsite-sync.sh` planlegges via `launchd`/`cron` på en alltid-på maskin.

Synken er **inkrementell** — rclone overfører kun nye/endrede filer, så den ukentlige jobben er rask uansett arkivstørrelse. Skulle arkivet en gang trenge full re-seeding av mange GB (f.eks. etter migrering av hele notearkivet), kjør `scripts/offsite-sync.sh` én gang lokalt i stedet — Actions-jobber har 6 timers grense.

> **NB:** GitHub deaktiverer scheduled workflows automatisk etter 60 dager uten aktivitet i repoet. Får du e-post om «scheduled workflow disabled», re-aktiver den fra Actions-fanen.

### Restore-test — *en utestet backup er bare et håp*

[scripts/restore-test.sh](scripts/restore-test.sh) gjenoppretter en dump til en **fersk, tom SQLite-database**, kjører `integrity_check` + `foreign_key_check`, og skriver ut tabeller med radtall (og sjekker at kjernetabellene finnes):

```bash
scripts/restore-test.sh backups/manual-2026-06-21T0400Z.sql      # en lokal dumpfil
scripts/restore-test.sh --r2-key backups/tb-notearkiv-2026-06-21T0400Z.sql --remote   # hent fra prod-R2
```

Faktisk gjenoppretting til en ny D1 (ved katastrofe):

```bash
wrangler d1 create tb-notearkiv                                  # ny/tom database
wrangler r2 object get tb-notearkiv-files/backups/<dump>.sql --file restore.sql --remote
wrangler d1 execute tb-notearkiv --remote --file restore.sql     # last inn dumpen
# verifiser, og oppdater database_id i wrangler.jsonc om id-en endret seg
```

## Veikart (kort)

- **Fase 1 (gjort)** — better-auth (e-postkode + valgfritt passord/magisk lenke, invitasjonsbasert), e-post via Cloudflare, prod på noter.tertnesbrass.com, ukentlig D1-dump til R2 via cron (se [Backup og gjenoppretting](#backup-og-gjenoppretting))
- **Neste** — off-site-kopi skrudd på (krever R2-/B2-nøkler som repo-secrets), passkey/sterk autentisering for privilegerte roller, Google-innlogging, import fra dagens Google Sheets/Drive
- **Fase 2** — PDF-splitter i nettleser (samle-PDF → stemmer), ZIP-nedlasting og e-postvarsler
- **Fase 3** — «deploy your own»-dokumentasjon for andre korps, besetning som konfigurasjon (janitsjar m.m.), lisensvalg

## Lisens

Ikke avklart ennå — AGPL-3.0 vurderes (åpen kildekode med mulighet for hostet tjeneste). Ta kontakt før gjenbruk.
