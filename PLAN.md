# Tertnes Brass Notearkiv — plan (v2)

> Status: juni 2026. Revidert etter avklaringsrunde — stack, auth og domene er besluttet.
> Avklart: TanStack Start-stack ✅ · Google-innlogging + RBAC ✅ · domene noter.tertnesbrass.com (i Cloudflare) ✅ · vikarlenker uten PIN ✅ · partitur synlig for alle, RBAC-styrbart ✅ · lytteeksempler (YouTube/lyd) inn som kjernefunksjon ✅

> Domene-etterskrift (juli 2026): planen skrev opprinnelig `noter.tertnesbrass.no`.
> Det ble aldri satt opp. Kanonisk produksjonsdomene er `noter.tertnesbrass.com`,
> og avsenderdomenet for e-post er `tertnesbrass.com`. `tertnesbrass.no` er
> korpsets offentlige nettside (e-post hos Uniweb) og eies ikke av denne appen.

## 1. Mål

Et notearkiv- og distribusjonssystem skreddersydd for brass band:

- **Arkiv**: digital katalog over alle verk korpset eier, med PDF per stemme.
- **Publisering**: repertoar per prosjekt/konsert; medlemmer finner *sine* stemmer på sekunder — og kan høre stykkene.
- **Vikardeling**: tidsbegrensede lenker per prosjekt + stemme, uten konto.
- **Kostnad**: 0 kr (verste fall noen kroner/mnd) på gratisplaner.
- **Kvalitet**: robust og trygt (backup, tilgangsstyring) — og det skal se *nydelig* ut. Moderne, enkelt, raskere enn dagens Sheets+Drive-flyt. Et polert UI er et hardt krav, ikke pynt: admin-rollen kan havne hos ikke-tekniske folk.
- **Senere**: open source slik at andre korps kan kjøre sin egen instans; ev. betalt hosting som bonus.

## 2. Dagens situasjon (utgangspunkt for migrering)

Google Spreadsheet med ett ark per konsert/prosjekt, lenker til PDF-er i Google Drive (ofte samle-PDF der man selv må finne sin stemme), pluss YouTube-lenker og opplastede lydfiler for lytting.

Det betyr:
- **Migrering er en førsteklasses oppgave**: et import-script som leser regnearket (CSV-eksport) og Drive-mappene, oppretter verk, gjetter stemmer fra filnavn og laster opp til R2. Kjøres av Sindre; trenger ikke polert UI.
- **Lytteeksempler er et reelt behov** og tas inn i datamodellen fra dag 1: YouTube/Spotify-lenker per verk + egne lydfiler i R2 med innebygd spiller.
- Arkivstørrelse: ukjent — måles med `rclone size` mot Drive-mappen (eller Google Takeout). **Action: Sindre.**

## 3. Brukere, roller og RBAC

Roller med redigerbare rettigheter (ikke hardkodet adferd):

| Rolle | Typisk tilgang |
|---|---|
| **Admin** | Alt, inkl. medlemmer/roller/innstillinger |
| **Arkivar** | Verk, filer, prosjekter, delingslenker |
| **Dirigent** | Som arkivar minus medlemsadmin |
| **Medlem** | Publiserte prosjekter, egne + alle stemmer, partitur (default på, styrbart) |
| **Vikar** | Ingen konto — delingslenke gir kun sitt prosjekt + sine stemmer |

RBAC-modell: `roles` + `role_permissions` (f.eks. `works.manage`, `projects.publish`, `members.manage`, `scores.view`, `files.download_all`) + brukere→rolle. Enkelt admin-UI for å justere hva roller kan — det dekker «partitur for alle, men styrbart» uten spesialkode. 2FA tilgjengelig for admin-kontoer (better-auth-plugin).

## 4. Kjernefunksjoner

### Verkskatalog
Tittel, komponist, arrangør, forlag, sjanger, grad, varighet, anskaffelsesår, fysisk plassering, notater, status. Søk og filter.

### Stemme-taksonomi (det brass band-spesifikke)
Sortert besetningsliste som seed-data (ikke hardkodet — janitsjar m.fl. kan ha sin egen):

> Soprano Cornet · Solo Cornet · Repiano Cornet · 2nd Cornet · 3rd Cornet · Flugelhorn · Solo Horn · 1st Horn · 2nd Horn · 1st Baritone · 2nd Baritone · 1st Trombone · 2nd Trombone · Bass Trombone · Euphonium · Eb Bass · Bb Bass · Percussion 1–3 / Timpani · Partitur

Aliaser per stemme («2nd Cornet», «2. kornett», «Cornet 2») → systemet gjetter stemme fra filnavn ved opplasting og import.

### Prosjekter og sesonger
Sesong → prosjekter (konsert/konkurranse/seminar) med dato, beskrivelse og repertoar i rekkefølge. Publiseres når klart.

### «Mine noter» + lytting
Medlem er knyttet til stemme(r). Forsiden: kommende prosjekter → direkte til egne PDF-er, med lytteknapp per verk (YouTube-embed eller innebygd spiller for R2-lydfiler). Mobil/nettbrett først — dette er skjermen folk står med i øvingslokalet.

### Vikardeling
Prosjekt + stemme(r) + vikarens navn → hemmelig lenke med utløpsdato, kan trekkes tilbake. Logg over hva som er delt med hvem. (PIN kan legges på senere om behov.)

### Tilgang og opphavsrett (designprinsipp)
Ingen offentlige filer. Alle nedlastinger via kortlevde signerte R2-URLer. Delingstokens lagres hashet. Nedlastingslogg. Lukket intern deling — aldri åpen indeksering.

## 5. Teknisk arkitektur (besluttet retning)

**Alt på Cloudflare.** R2 har gratis egress (kjernebruken er PDF/lyd-nedlasting), D1 5 GB gratis, ingenting sovner ved inaktivitet, kommersiell bruk OK på free tier. Korpsets domene ligger allerede i Cloudflare → `noter.tertnesbrass.com` som custom domain og DNS-verifisert e-postavsender er friksjonsfritt.

```
Nettleser (medlem / arkivar / vikar)
        │ HTTPS — noter.tertnesbrass.com
        ▼
Cloudflare Worker — TanStack Start (React, SSR + server functions)
   ├── D1 (SQLite, Drizzle): katalog, prosjekter, brukere, RBAC, delingslenker
   ├── R2 (privat bucket): PDF-er + lydfiler, signerte URLer
   ├── Cron triggers: backup-jobber, utløp av lenker
   └── Resend: e-post (invitasjon, varsler) — verifisert via tertnesbrass.com
```

- **Rammeverk: TanStack Start** + shadcn/ui + Tailwind. Matcher TanStack-erfaringen din (Start er bygget på TanStack Router), og Workers er offisielt deploy-mål via Cloudflares Vite-plugin — Cloudflare er TanStack-partner med egen starter-template. Ærlig forbehold: Start er i RC (API-stabil, produksjonsklar, men «early adopter»). Akseptabel risiko for dette prosjektet; exit til React Router 7 er overkommelig siden begge er Vite+React.
- **Auth: better-auth** — «Logg inn med Google» som primær (gratis OAuth-app) + e-post/passord som fallback for de uten Google-konto. Invitasjonsflyt: admin oppretter medlem → invitasjonslenke (Spond/Messenger) → medlem kobler Google eller setter passord. Kjent implementasjonsdetalj på Workers: D1-binding finnes kun per request → better-auth instansieres via factory-funksjon (veldokumentert mønster, ferdige templates finnes).
- **Rust-vurdering (ærlig svar)**: ikke i kjernestacken. Full-stack TypeScript gir delte typer ende-til-ende, og økosystemet vi trenger (better-auth, Drizzle, pdf-lib) er TS-first — Rust i kjernen ville bremset prosjektet uten gevinst i denne størrelsesorden. Det finnes derimot to *gode* avgrensede Rust-muligheter senere, om lysten melder seg: (a) PDF-motor som WASM (splitting/vannmerking med f.eks. `lopdf`, kjørt i Worker eller nettleser) når pdf-lib ev. møter veggen, (b) et Rust-CLI for batch-import/arkivverktøy lokalt. Begge kan legges til uten å røre kjernen.
- **PDF-visning**: nettleserens innebygde viewer via signert URL (fungerer på iPad → forScore). Ev. pdf.js senere ved behov (vannmerking).
- **PDF-splitting** (fase 2): nettleserverktøy — miniatyrer, marker sideintervall per stemme, server splitter med pdf-lib → én R2-fil per stemme.

### Robusthet og backup (hardt krav)

- **D1**: innebygd point-in-time recovery 30 dager **+** ukentlig SQL-dump til R2 via cron-Worker.
- **R2 → off-site**: ukentlig `rclone sync` til en annen lokasjon (Backblaze B2 free 10 GB eller lokal NAS/disk hos Sindre). Notene er uerstattelige; 3-2-1-light.
- **Restore-test** én gang per halvår (en backup man ikke har testet er et håp, ikke en backup).
- Delingstokens hashet i DB, rate limiting på lenke-endepunkt, 2FA for admin, audit-/nedlastingslogg.
- Infrastruktur som kode: wrangler-config i repo, D1-migrasjoner versjonert → hele miljøet kan gjenskapes fra repo + backup.

### Kostnad

| Post | Gratisgrense | Vårt behov | Kostnad |
|---|---|---|---|
| Workers + cron | 100k req/dag | ~35 brukere | 0 kr |
| D1 | 5 GB, 5M reads/dag | metadata | 0 kr |
| R2 | 10 GB, gratis egress | PDF + lydfiler; måles (rclone) | 0 kr → ~$0.015/GB/mnd over 10 GB |
| Resend | 3 000 e-post/mnd | invitasjoner + varsler | 0 kr |
| Domene | — | har tertnesbrass.com i CF | 0 kr ekstra |

Lydfiler er største lagringsdriver (~5–10 MB/stk) — fortsatt småpenger; 20 GB totalt ≈ 1,5 kr/mnd.

## 6. Design og UX (eget arbeidsområde, ikke etterpåklokskap)

Mål: «finn nota di på 10 sekunder» — og et uttrykk korpset er stolt av å vise vikarer.

- **Tre nøkkelflater designes først** (før CRUD-resten): ① Medlem-hjem (kommende prosjekter, mine stemmer, lytt), ② Prosjektside (repertoar, stemmer, deling), ③ Arkivar-flyt (verk + filopplasting med stemme-gjetting). Vikarsiden er en forenklet ① uten innlogging.
- Mobil først for medlem/vikar; desktop først for arkivar.
- shadcn/ui + Tailwind som fundament, men med egen identitet (typografi, farger — gjerne fra korpsets profil), lys/mørk modus.
- Tomme tilstander, lastetilstander og feilmeldinger designes — det er der «polert» avgjøres.
- Stilguide/designskisser lages i starten av fase 1 og diskuteres før bygging.

## 7. Datamodell (utkast v2)

```
users            id, name, email, google_id?, password_hash?, role_id, is_active
roles            id, name (admin|archivist|conductor|member), is_system
role_permissions role_id, permission   (works.manage, projects.publish,
                                        members.manage, scores.view, …)
parts            id, sort_order, name_no, name_en, aliases[], section
user_parts       user_id, part_id, is_primary
works            id, title, composer, arranger, publisher, genre, grade,
                 duration_sec, physical_location, acquired_year, notes, status
work_files       id, work_id, kind (part|score|audio|other), part_id?,
                 label, r2_key, file_name, page_count?, uploaded_by, uploaded_at
work_links       id, work_id, kind (youtube|spotify|other), url, label
seasons          id, name, starts_on, ends_on
projects         id, season_id, name, kind, event_date, description, is_published
project_works    project_id, work_id, position, note
share_links      id, project_id, token_hash, recipient_name, part_ids,
                 expires_at, created_by, last_used_at, revoked_at
download_log     id, user_id?, share_link_id?, work_file_id, at
settings         key, value   (korpsnavn, logo, partitur-policy, …)
```

## 8. Faseplan

**Fase 0 — Fundament** (en helg)
Git-repo · TanStack Start på Workers (CF-template) · D1 + Drizzle-migrasjoner · deploy-pipeline (workers.dev først, så noter.tertnesbrass.com) · better-auth med Google + passord · seed av stemmeliste og roller.

**Fase 1 — MVP: «kjør én ekte konsert gjennom systemet»**
- Designskisser for de tre nøkkelflatene (avsnitt 6) — diskuteres før bygging
- Verkskatalog (CRUD + søk) · multi-filopplasting med stemme-gjetting
- Prosjekter med repertoar + publisering · «Mine noter» med lytting (YouTube + R2-lyd)
- Vikarlenker med utløp/tilbaketrekking
- **Import-script** fra Google Sheets (CSV) + Drive → verk, filer, stemmer, lydfiler
- Backup-cron (D1-dump + rclone-rutine)

**Fase 2 — Arkivarverktøy og flyt**
PDF-splitter i nettleser · ZIP-nedlasting (stemme/prosjekt) · e-post via Resend (invitasjon, magic link, «nytt repertoar publisert») · nedlastingslogg-UI · RBAC-admin-UI · bedre søk/filter · ev. PIN på vikarlenker.

**Fase 3 — Open source og deling**
Dokumentasjon + «deploy your own» (wrangler + seed; hvert korps = egen gratis instans, ingen multi-tenant-kompleksitet) · besetning som konfigurasjon (janitsjar m.m.) · lisens: AGPL-3.0 anbefalt hvis betalt hosting skal være mulig forretning (Cal.com/Plausible-modellen); MIT hvis maks spredning · betalt hosting kan starte som «jeg drifter instansen din».

## 9. Risiko

- **Adopsjon i korpset** — størst. Avbøtes: MVP testes på ett reelt prosjekt; arkivarflyten må være raskere enn dagens Sheets+Drive; design som folk *vil* bruke.
- **TanStack Start i RC** — lav: API-stabil, CF-partner; exit til React Router 7 er billig (samme Vite/React-fundament).
- **Bus factor (Sindre)** — open source + dokumentasjon + infrastruktur-som-kode.
- **Free tier-endringer** — neglisjerbart; volumene er små selv til betalt pris.
- **GDPR (lett)** — kun navn, e-post, instrument; minimer, slettbart, ingen sporing.
- **Opphavsrett** — lukket tilgang, utløpende lenker, logg (avsnitt 4).

## 10. Gjenstående avklaringer

1. **Arkivstørrelse** (Sindre): `rclone size` mot Drive-mappen eller Google Takeout — avgjør om vi passerer 10 GB.
2. **Designreferanser**: apper/nettsider du synes er nydelige, + finnes det en grafisk profil for korpset (logo, farger)?
3. **Lydfil-policy**: YouTube-lenke som hovedregel og R2-lyd kun når det ikke finnes på YouTube (f.eks. egne opptak)? Holder lagringen nede.
4. **Admin-kreds**: hvem flere enn deg skal ha admin/arkivar fra start?
