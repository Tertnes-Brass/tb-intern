# tb-intern — notater for agenter

Repoet het tidligere `tb-notearkiv` (omdøpt 31. august 2026). Cloudflare-Workeren, D1-databasen og R2-bøtta heter fortsatt `tb-notearkiv` — det navnet skal IKKE endres (nytt Worker-navn = ny Worker uten bindinger/secrets).

Notearkiv for brass band (Tertnes Brass). TanStack Start (React) på Cloudflare Workers, D1 (Drizzle) + R2. Norsk UI.

## Kommandoer

- `pnpm dev` — dev-server (lokal D1/R2 via miniflare i `.wrangler/state`)
- `pnpm exec tsc --noEmit` — typesjekk (skal være grønn før commit)
- `pnpm exec drizzle-kit generate --name <navn>` → `pnpm exec wrangler d1 migrations apply tb-notearkiv --local` — skjemaendringer
- `pnpm generate-routes` — regenerer routeTree etter nye filer i `src/routes/`

## Grener og miljøer

- **`main` = prod** (intern.tertnesbrass.com). Merge til main deployer automatisk via `.github/workflows/deploy.yml`: backup av D1 → sjekk at ventende migrasjoner er additive → radtelling → migrer → deploy → verifisering. Deploy aldri prod manuelt uten grunn; workflowen ER deploy-rutinen.
- **`test` = staging** (test.tertnesbrass.com, egen D1/R2 — prod røres aldri derfra). Vil du vise/teste noe før merge: `git push -f origin <din-gren>:test`. `-f` er normalen; `test` er en pekepinne uten egen historikk. All e-post fra staging omdirigeres til én adresse, cron kjører ikke der.
- `pnpm run staging:refresh` — fersk prod-kopi inn i staging-D1 (prod leses bare).
- **Felle:** miljø velges ved BYGGING (`CLOUDFLARE_ENV=staging`) — vite-pluginen flater konfigen til `dist/`. `wrangler deploy --env staging` etter et vanlig bygg deployer PROD. Bruk `pnpm run deploy:staging` hvis du må deploye staging manuelt.
- Cloudflare Workers Builds (Git-integrasjonen i dashbordet) skal være FRAKOBLET — den deployer uten migrasjoner og sjekker. Ser du doble deployer per push, er den koblet på igjen.

## Rutestruktur

Appen er i ferd med å bli hele internsiden («Tertnes Brass Intern»), og noter er
ett område i den. Veggen — beskjeder fra styret og innlegg fra medlemmene —
bor i `/beskjeder` (`src/routes/beskjeder/{index,ny,$postId/index,$postId/rediger}.tsx`).
Notearkivet bor i navnerommet `/noter`:
`src/routes/noter/index.tsx` («Mine noter»), `noter/prosjekter/{index,$projectId}.tsx`
og `noter/arkiv/{index,$workId}.tsx`. Layout-ruten `src/routes/noter/route.tsx`
eier områdemenyen (Mine noter · Prosjekter · Arkiv, sistnevnte kun ved
`canBrowseArchive`) og gjør `me` ikke-nullbar i rutekonteksten for hele området.
`src/routes/{prosjekter,arkiv}/*` er tomme rutefiler som kaster en 301-redirect
til de nye stiene og tar med seg søkeparametrene — gamle lenker i e-post og chat
skal fortsatt virke, så de skal ikke slettes. Styret har sitt eget navnerom `/styre`
(`src/routes/styre/route.tsx` med områdemenyen Oppgaver · Prosjekter · Møter ·
Chat · Dokumenter), gated på `board.manage`. Gruppelederne har `/gruppeledere`
(`src/routes/gruppeledere/route.tsx`, områdemenyen Oversikt · Chat), gated på
rettighet + aktiv leiarbinding. `src/routes/index.tsx` (`/`) er
hub-forsiden: plattformflaten som viser neste hendelse, veien inn til «Mine
noter», de neste hendelsene og snarveier til områdene brukeren har tilgang til.
Den skal ikke gjengi områdenes oversikter i miniatyr — se
`docs/designprinsipper.md` §4 og §7 pkt 3.

## Arkitektur

- `src/db/schema.ts` — hele datamodellen (Drizzle/SQLite)
- `src/server/*.ts` — server functions (`createServerFn().validator(zod).handler()`); all tilgangskontroll skjer her via `requireMe()`/`requirePermission()` fra `access.ts` — aldri stol på klienten
- `src/routes/api/` — server routes for filstrømming/opplasting (R2)
- `src/lib/taxonomy.ts` — brass band-besetningen + filnavn→stemme-gjetting (seedes til DB, ikke hardkod i logikk)
- `src/styles.css` — design-systemet («Konsertprogrammet»: papir/blekk/messing, Fraunces + Schibsted Grotesk); bruk tokens og klassene derfra, ikke nye ad-hoc-farger
- **Auth: better-auth** — instans i `src/server/auth-instance.ts` (lat `getAuth()`), klient i `src/lib/auth-client.ts`, handler i `src/routes/api/auth/$.ts` (normaliserer e-post til små bokstaver). Invitasjonsbasert: `databaseHooks.user.create.before` avviser ikke-inviterte (gjelder både passord og magisk lenke); `ADMIN_EMAIL` bootstrapper første admin. RBAC kobles via `member_profiles`. Skjemaendring i auth: `pnpm auth:generate` → `drizzle-kit generate`. `auth.cli.ts` er KUN for skjemautledning (importerer ikke cloudflare:workers).
- **Domene: `intern.tertnesbrass.com` er kanonisk.** Alle absolutte URL-er (auth-callbacks, magiske lenker, passordreset, vikarlenker) bygges fra `BETTER_AUTH_URL` — aldri fra request-origin eller hardkodet domene. `src/lib/host-redirect.ts` (`legacyHostRedirect` + `LEGACY_HOSTS`) svarer 301 fra de gamle vertsnavnene med sti og query i behold; den er koblet inn som global request-middleware i `src/start.ts`, som derfor også må liste `createCsrfMiddleware` eksplisitt (et eget `createStart` erstatter Start sin standardliste).
- E-post: `src/server/email.ts` via Cloudflare `EMAIL`-binding; faller tilbake til konsoll-logg i dev / ved feil.
- Beskjeder (#28) — **veggen**: `src/server/posts.ts` (feed, detalj, utkast, publisering, kommentarer, reaksjoner, varsling). Lesing og skriving krever bare `requireMe()` — alle medlemmer kan poste, kommentere og like. `posts.publish` gir de fire tingene som skiller en styrebeskjed fra et innlegg: «Fra styret» (`posts.official`), «Viktig», `audience: 'board'` og e-post — pluss moderasjon av andres innhold. Reglene er rene funksjoner i `src/lib/posts.ts` (`sanitizePostInput`, `canEditPost`, `canDeleteComment`, `canReadPost`, `postHeading`, `recipientsFor`, `toggleReaction`, e-postkopien), testet i `posts.test.ts`. `sanitizePostInput` kalles på BÅDE opprettelse og redigering, så et privilegert felt aldri kan snikes inn i et rått kall; uten `posts.publish` endrer `updatePost` kun tittel og tekst. Utkast og `audience: 'board'` filtreres alltid server-side — med ett tillegg: ditt eget innlegg er alltid synlig for deg, ellers ville et innlegg som stoppet opp under bildeopplasting blitt usynlig for den som skrev det. Tittel er valgfri (`postHeading` faller tilbake til første linje).
- **Markdown i beskjeder (#79):** `posts.format` er `'plain_text' | 'markdown'`, NOT NULL DEFAULT `'plain_text'` (migrasjon `0012_markdown-og-chatkanaler.sql`, ren `ADD COLUMN`) — eksisterende innlegg er uendret, både visuelt og semantisk. Formatet er IKKE privilegert: `sanitizePostInput` beholder det også for et vanlig medlem, og begge grenene i `updatePost` skriver det, ellers ville en skrivefeilretting gjort et markdown-innlegg til ren tekst. Rendringen bor i `src/lib/markdown.ts` (`markdownToHtml`, `markdownToPlainText`, `postPlainText`, `safeHref`) med `marked` — vi bruker bare LEXEREN og skriver HTML-en selv, så utdata er en **allowlist ved konstruksjon** og trenger ingen etterfølgende sanitizer. Reglene som ikke er til forhandling: rå HTML escapes og vises som tekst (aldri som markering), lenker må ha `http(s):`/`mailto:` eller være relative (`safeHref` stripper kontrolltegn FØR skjemasjekken, så `java\tscript:` ikke slipper forbi), eksterne bilder blir en lenke og ALDRI en `<img>` (personvern: et innbakt bilde ville lekket IP og lesetidspunkt til en tredjepart, og veggens egne bilder går via den gatede opplastingen), og `#` blir `h2` fordi sidens `h1` er tittelen. `breaks: true` — enkelt linjeskift blir `<br>`, som i ren tekst. `markdown.ts` er en EGEN modul og importeres aldri fra `lib/posts.ts`: da ville feeden og kortene dratt inn parseren (46 kB) bare for å telle kommentarer. Utdrag, tittel-fallback og e-postemne går alltid gjennom `postPlainText(body, format)` først, så feeden og hub-en aldri viser `#` eller `**`. Stilene ligger i `.prose` i `src/styles.css`; e-posten bruker `EMAIL_MARKDOWN_STYLES` (inline, siden e-postklienter ikke har klasser). `markdown.test.ts` inneholder angrepsforsøkene — faller en av dem, er det et hull, ikke kosmetikk.
- **Omtaler (#83) finnes nå TRE steder: kommentarer, innlegg og de to chattene.** Formatet, skrivehjelpen og valideringsregelen er de samme alle tre stedene og bor i `src/lib/mentions.ts`; det som skiller dem er *hvem* som kan omtales og *hvordan* varselet går ut. Fellesdelene: markøren `@[u:<brukerId>]` i teksten, `MAX_MENTIONS` = 10, `mentionRejection` (ÉN feilmelding for alle avslag), `rankMentionCandidates` (søket returnerer KUN `{id, name}`), `mentionPlainText` (utdrag viser `@Navn`, aldri markøren) og `MentionTextarea` i UI-et.
  - **Kommentarer:** tabell `post_comment_mentions`. Hvem: aktive medlemmer som kan lese innlegget (`mentionableMembers`, som gjenbruker `canReadPost`). Varsling: én e-post per omtalt per kommentar (`mentionEmail`), ingen logg — en kommentar kan verken redigeres eller sendes på nytt.
  - **Innlegg:** tabell `post_mentions` (migrasjon `0014_mentions-everywhere.sql`, kun CREATE TABLE + CREATE INDEX; PK `(post_id, user_id)`, begge FK-er CASCADE, `notified_at` nullbar). Hvem: `mentionableForAudience(audience)` — spørsmålet er MÅLGRUPPEN, ikke publiseringsstatusen, for et nytt innlegg har verken id eller lesere ennå. `searchMentionableForAudience` svarer alltid for `all` når den som spør mangler `posts.publish` (da er `board` uansett ikke et gyldig valg). Valideringen kjøres i BÅDE `createPost` og `updatePost`, og på redigering mot den NYE målgruppen: flyttes et innlegg til «Bare styret», kan en omtale av et vanlig medlem ikke bli stående. Varsling (`postMentionEmail`): kun når innlegget er publisert, kun til dem uten `notified_at`, aldri til forfatteren, aldri ved `mentions: 'off'` — og **aldri i tillegg til beskjed-e-posten**: den som fikk hele innlegget i innboksen i samme publisering merkes som varslet uten å få en e-post til. Utkast varsler aldri. `notified_at` er for omtaler det `notification_log` er for beskjeden: avpubliser/republiser og lagre-på-nytt sender aldri dobbelt, og en omtale som legges til i et publisert innlegg varsler kun den nye.
  - **Chat (styret + gruppelederne):** INGEN tabell — meldinger kan verken redigeres eller varsles, så teksten alene holder. Hvem: `board.manage`-holdere i styrechatten, aktive leiarbindinger i lederchatten (`mentionableMembers` i hver av `src/server/{board,gruppeledere}.ts`; spørringene er bevisst IKKE delt, slik at ingen parameter kan spørre om feil område). Ingen e-post — chatten polles og har uleste-markører; e-post per melding ville spammet. I stedet teller `listChannels` med én ekstra SQL-kolonne om de uleste inneholder en omtale av deg, og kanalen får «@» på ulest-prikken (`unreadBadge` i `src/lib/board.ts`). `listMessages` sender navnene som `mentionNames` (`id → navn`) for hele sida, og `ChatText` rendrer chip-ene; markører i kodespenn/kodeblokker forblir rå tekst.
  - **Rendring:** `renderCommentHtml` (kommentarer), `postLineTokens` (innlegg i `plain_text` — omtaler skilles ut FØR auto-lenkingen) og `markdownToHtml(..., { mentions })` (innlegg i `markdown` — omtale-steget er et eget inline-token som KUN kjøres på tekst-tokens, aldri i `codespan`/`code`). Chip-en skrives ett sted (`mentionChipHtml`). Et navn uten treff blir «Ukjent medlem», aldri et gammelt navn og aldri rå markørtekst.
  - **Redigering av lagret tekst:** `mentionDraft` gjør markører om til `@Navn` for tekstfeltet og gir tilbake de samme medlemmene som «valgt», slik at `toMarkers` legger markørene tilbake ved lagring. Rekkefølgen følger TEKSTEN, ikke databasen — ellers ville to like navn kunnet bytte plass.
  - **Kjent kant:** `parseMentions` leser hele teksten, også innsiden av backticks. En markør som er HÅNDSKREVET inn i et kodespenn teller derfor som en omtale (rad + e-post) selv om den vises som rå tekst. Komposeren lager aldri en slik markør (`toMarkers` hopper over kodespenn), og valideringen er uansett den samme, så dette er en skjevhet i visning — ikke et hull.
- **Omtaler i kommentarer (#83), detaljene:** en omtale lagres som markøren `@[u:<brukerId>]` i `post_comments.body` — ALDRI som et navn. Den spørrbare koblingen er `post_comment_mentions` (PK `(comment_id, user_id)`, begge FK-er `ON DELETE CASCADE`): teksten sier *hvor* omtalen står, tabellen sier *hvem* som er omtalt. Ved visning slår `getPost` opp dagens navn (join mot `user`) og `renderCommentHtml` i `src/lib/mentions.ts` bygger chip-en; en markør uten treff blir «Ukjent medlem», aldri et gammelt navn og aldri rå markørtekst. Kommentarer er fortsatt REN TEKST — `markdown.ts` gjelder bare innlegg, og `renderCommentHtml` escaper alt annet enn chipene (samme allowlist-ved-konstruksjon-prinsipp). **Valideringsregelen** i `addComment` er ikke til forhandling: hver markør må peke på et AKTIVT medlem som selv kan lese innlegget (`mentionableMembers` gjenbruker `canReadPost`, så forslagslista og valideringen ikke kan komme i utakt), maks `MAX_MENTIONS` = 10, og ÉN felles feilmelding for alle avslag — «finnes ikke», «deaktivert» og «ikke tilgang» må ikke kunne skilles, ellers blir et rått kall et oppslagsverk over skjulte medlemmer. `searchMentionableMembers` returnerer KUN `{ id, name }`. I UI-et viser tekstfeltet `@Navn` mens man skriver; `toMarkers` oversetter til markører ved innsending og matcher bare navn som faktisk er valgt fra lista (lengste først, ordgrense, aldri inne i backticks) — en textarea kan ikke vise en chip, og en `contenteditable` var ikke verdt det. Varsling: én e-post per omtalt per kommentar (`mentionEmail`), aldri til deg selv, styrt av `notification_preferences.mentions` (`'all' | 'off'`, ingen rad = `'all'`) på `/min-profil`. Ingen `notification_log`-rad: en kommentar kan verken redigeres eller sendes på nytt. Feil i utsendingen velter aldri kommentaren.
- **Bilder på veggen:** R2 via `posts/<fersk id>.<ext>` — nøkkelen bygges aldri av filnavnet. Opplasting er én PUT mot `/api/post-images/upload` (ikke note-arkivets multipart-flyt), visning kun via `/api/post-images/$imageId`. Begge gates i `src/server/post-images.ts` (`canAttachImages`, `postImageAccess`), som er en EGEN modul fordi den har levende eksporter: lå de i `posts.ts`, ville `cloudflare:workers` blitt dratt inn i klientbygget. Bildebytene slettes fra R2 før raden i `deletePost`/`deletePostImage`.
- **E-postvarsling og idempotens:** avkryssingen «Send e-post …» er AVSLÅTT som standard (`DEFAULT_NOTIFY` i `src/lib/posts.ts`, brukt av både `PostForm` og publiseringsdialogen på beskjed-detaljruta, låst av en test) — publisering og masseutsending er to bevisste handlinger, og bare den ene kan angres. `publishPost` sender via `sendEmail` i puljer på fem, og skriver én rad i `notification_log` per mottaker (PK `(post_id, user_id)`) med utfallet `sent`/`logged`/`failed`. Loggen er sannheten om hvem som har fått hva: `resendPostNotifications` sender kun til dem som mangler en rad, og en avpublisert/republisert beskjed sender aldri på nytt til de samme. `logged` betyr konsoll-logg (ingen e-post gikk ut) og skal aldri presenteres som «sendt» — `notifyResultMessage` er felles sannhetskilde, som `inviteDeliveryMessage`. Varslingsvalget per medlem ligger i `notification_preferences` (ingen rad = alle beskjeder) og settes på `/min-profil`.
- Kalender: `src/lib/ical.ts` er en egen iCalendar-parser (folding, TZID/UTC/heldag, RRULE+EXDATE+RECURRENCE-ID) som ekspanderer forekomster i veggklokke-tid — ingen avhengigheter, testet i `ical.test.ts`. `src/server/calendar-feed.ts` henter Google-feeden fra secreten `CALENDAR_ICS_URL` (aldri til klienten, aldri i cache-nøkkelen) med ti minutters cache og eksporterer `loadCalendar`; `src/server/calendar.ts` eksponerer `getCalendar`/`getNextEvent` bak `requireMe()`. Delingen er nødvendig: et *levende* eksport i en modul en rute importerer, drar `cloudflare:workers` inn i klientbygget. Serverfunksjoner kaller aldri andre serverfunksjoner — de deler `loadCalendar`. Tidsvinduet (fra i går, 17 uker ≈ fire måneder frem) og taket på antall forekomster bor i `src/lib/calendar-window.ts` — egen ren modul, slik at vinduet kan testes uten Workers-runtime og `/kalender` kan skrive «De neste fire månedene» uten å gjette. Hub-en bruker samme `loadCalendar`, men sender bare `eventsAfter(...4)` til klienten.
- **Øvingsplan og oppmøte (#82 + #24):** detaljruta `/kalender/$eventId` legger lokale data oppå Google-feeden — hva som skal øves på, og hvem som kommer. Serverfunksjonene bor i `src/server/event-meta.ts` (kun serverfunksjoner og typer eksporteres derfra; en levende eksport ville dratt `cloudflare:workers` inn i klientbygget, som i `post-images.ts`), de rene reglene i `src/lib/attendance.ts` og `src/lib/setlist.ts`. Tabellene er `event_meta`/`event_setlist`/`event_attendance` (migrasjon `0015_ovingsplan-fravaer.sql`, kun CREATE TABLE + CREATE INDEX + rettighetsseeding). Tre ting er ikke til forhandling:
  - **`occurrenceKey` er identiteten, ikke `CalendarEvent.id`.** `id` er `uid#<faktisk start>`; nøkkelen i `src/lib/occurrence.ts` er `base64url(uid)` for en enkelthendelse og `base64url(uid).YYYYMMDDTHHMMSSZ` for en forekomst i en serie, der tidsstemplet er forekomstens **opprinnelige** start — altså `RECURRENCE-ID`-verdien for en flyttet forekomst, aldri det nye tidspunktet. Derfor blir øvingsplanen med når dirigenten flytter øvelsen fra 19:00 til 18:00. Nøkkelen er deterministisk (ingen database, ingen teller), URL-trygg (base64url-alfabetet og `.` er «unreserved» i RFC 3986, så den kan stå rå i ruteparameteren) og uavhengig av vindu og cache. `expandEvents` dedupliserer på den, og `isOccurrenceKey` validerer den i hver `validator(zod)` — ruteparameteren er ikke et fritt tekstfelt. Testene som låser dette ligger i `occurrence.test.ts` og i «occurrenceKey på en forekomst» i `ical.test.ts`.
  - **Foreldreløse data slettes ALDRI automatisk.** En hendelse kan forsvinne fra feeden fordi den ble slettet i Google (eller fikk `EXDATE`), eller bare fordi den falt ut av firemånedersvinduet — de to er ikke til å skille fra utsiden, så et opprydningssteg ville kunnet slette planen for en øvelse som fortsatt skal skje. `event_meta` har derfor `summary`- og `start`-**snapshot**: uten dem ville en foreldreløs rad vært en base64-nøkkel og en liste med verk. Detaljruta viser en rolig «Hendelsen finnes ikke lenger i kalenderen»-side, med de lokale dataene lesbare for dem som har skriverett (eller er gruppeleder) og bare beskjeden for alle andre. `ensureMeta` tar snapshotet fra FEEDEN, aldri fra klienten, og nekter å opprette en rad for en forekomst som ikke finnes — et rått kall kan ikke dikte opp en hendelse.
  - **Én status per medlem per forekomst.** Selvbetjent RSVP (#24) og administrert fravær (#82) skriver til samme rad i `event_attendance`; siste skriving vinner, og `source` (`self`/`admin`) + `registered_by` er sporbarheten. To tabeller ville før eller siden gitt to svar på «kommer Ingrid på torsdag?». Innsynsregelen (`attendanceScope` i `src/lib/attendance.ts`): tallene til alle, egen status til alle, full navneliste kun ved `attendance.manage`/`*`, og en gruppeleder ser navnene i SINE seksjoner (`me.leadsPartIds`, samme bindingsregel som `isGroupLeader`). Kommentarer følger navnelisten. Alt håndheves i `getEventDetail`, som returnerer `groups: null` for den som bare skal se tall — skjermen filtrerer ingenting.
  Rettighetene er `calendar.manage` (øvingsplan + praktisk info + prosjektkobling) og `attendance.manage` (oversikt + registrering), begge seedet til `conductor`. De er BEVISST to: en fraværsansvarlig skal kunne få den ene uten prosjekt-, medlems- eller admintilgang. Verkssøket er en egen funksjon (`searchWorksForEvent`) gated på `calendar.manage`, siden `searchWorksForPicker` i `projects.ts` krever `projects.manage`. I dev uten `CALENDAR_ICS_URL` genererer `src/server/dev-calendar.ts` en feed med ukentlig øvelse, én flyttet og én slettet forekomst; `seedRehearsalDemo()` bruker SAMME parser til å finne nøkkelen demoplanen henger på.
- **Oppkjøring og tidsplan (#9 + #10 + #29), 2. september 2026:** prosjektsiden `/noter/prosjekter/$projectId` er nå prosjektets dashboard, og øvingene fram mot konserten henger sammen med den. Migrasjon `0016_oppkjoring-og-tidsplan.sql` er rent additiv (to CREATE TABLE, ti ADD COLUMN, én INSERT … SELECT). Fire ting er verdt å kjenne:
  - **`project_times` (#9) er en LISTE, ikke kolonner på `projects`.** En konsert har lasting og nedrigg, et seminar har ingen av delene, og en konkurranse har en avreise ingen andre har. Hver rad har type (`PROJECT_TIME_KINDS`), valgfri egen etikett, dato + valgfritt klokkeslett, sted, målgruppe (`PROJECT_TIME_AUDIENCES`), merknad, ansvarlig og kontaktnummer. Skriving gates på `projects.manage`.
  - **Veggklokke, ikke tidsstempel.** `date` er ISO-dato og `time` er `HH:MM`, begge slik de ble skrevet inn — et oppmøte 17:30 er 17:30 i Bergen uansett hva serveren mener om sommertid. `time` er nullbar: «lasting på lørdag» er en avtale også uten klokkeslett, og et slikt punkt sorteres SIST på dagen (`ORDER BY time` i SQLite ville lagt NULL først, så sorteringen skjer i `sortProjectTimes`, ikke i SQL).
  - **Prosjektkoblingen på en øving er n:m** (`event_projects`), fordi saken krever at én øving kan peke på flere prosjekter. `event_meta.linked_project_id` er UTGÅTT: radene ble kopiert over i migrasjonen, og kolonnen står igjen fordi `DROP COLUMN` er en tabell-rebuild — og en rebuild i D1 cascader til `event_setlist`/`event_attendance`/`event_projects`. Ingenting leser eller skriver den lenger; den forsvinner når migrasjonene squashes.
  - **Praktisk info per øving (#10)** er ti nye kolonner på `event_meta`: sted, adresse, kartlenke, oppmøte for riggegruppe og musikanter, dirigent, nøkkelansvarlig, riggegruppe, vikarer og en fri merknad. Kartlenka går gjennom `parseMapUrl` — kun `http(s):`, kontrolltegn strippes FØR skjemasjekken, samme disiplin som `safeHref`. Riggegruppe/vikarer/dirigent er fritekst med vilje: en riggegruppe er tre personer og av og til en innleid sjåfør, og en medlemsreferanse per rolle ville krevd en tabell til for noe som avtales i en chattetråd. **Fravær/RSVP og øvingsrekkefølge er IKKE duplisert** — `event_attendance` og `event_setlist` eier dem fortsatt, og den praktiske blokka lenker til dem.
  - Reglene er rene funksjoner i `src/lib/practical.ts` (`parseClockTime`, `parseIsoDate`, `parseMapUrl`, `parseContactPhone`, `parseProjectTimeInput`, `sortProjectTimes`, `nextProjectTime`, `parseEventPracticalInput`) med tester i `practical.test.ts`. Serverfunksjonene bor der de hører hjemme: tidsplanen i `src/server/projects.ts` (`projects.manage`), praktisk info og prosjektkobling i `src/server/event-meta.ts` (`calendar.manage`). Prosjektsiden leser øvingene gjennom `loadCalendar` — samme ti-minutters cache som hub-en — og faller tilbake på `event_meta`-snapshotet for en øvelse som har falt ut av firemånedersvinduet.
- **Prosjektvarsling og prosjektkommentarer (#18 + #51 + #27), 5. september 2026:** prosjektsiden kan nå si fra til korpset, og korpset kan spørre tilbake. Migrasjon `0017_prosjektvarsling-og-kommentarer.sql` er rent additiv (tre CREATE TABLE, tre CREATE INDEX, én ADD COLUMN med DEFAULT). #18 og #51 er bygget som ÉTT system: samme mottakerliste, samme varslingsvalg, samme idempotenstabell og samme e-postramme — to parallelle systemer ville før eller siden gitt medlemmet to brytere for det samme. Fem ting er ikke til forhandling:
  - **`project_notifications` er sannheten om hvem som har fått hva**, som `notification_log` er for veggen. PK er `(project_id, user_id, kind)`, og `kind` er en del av nøkkelen fordi de to typene oppfører seg ULIKT: `published` skrives ÉN gang per mottaker og røres aldri igjen (avpubliser/republiser sender ALDRI dobbelt, og «send på nytt» går kun til dem som MANGLER en rad), mens `update` er gjentakende og oppdateres med nytt `sent_at` hver runde. For `update` ER `sent_at` nyttelasten: den definerer hva «siden forrige varsel» betyr. Utsendingen går via `sendEmail` i puljer på fem, feil velter aldri handlingen, og `logged` presenteres ALDRI som «sendt» (`projectNotifyMessage`, samme prinsipp som `notifyResultMessage`).
  - **Avkryssingen «Send e-post …» er AVSLÅTT som standard** (`DEFAULT_PROJECT_NOTIFY` i `src/lib/project-notify.ts`, låst av en test) — samme regel som `DEFAULT_NOTIFY` for beskjeder (#85). Publisering og masseutsending er to bevisste handlinger, og bare den ene kan angres; et prosjekt publiseres dessuten ofte lenge før programmet er ferdig. Publisering har derfor fått sin egen serverfunksjon (`publishProject`) i stedet for `updateProject({ isPublished: true })`, av samme grunn som `publishPost` er skilt fra `updatePost`.
  - **`project_changes` er grunnlaget for ÉN e-post i stedet for én per endring (#51).** Rader skrives KUN for publiserte prosjekter — et utkast er ikke synlig for noen, så publiseringen er nullpunktet; uten regelen ville det første endringsvarselet inneholdt hele oppbyggingen av programmet. Raden holder STRUKTUR (`kind`, `subject`, `detail`), aldri ferdig tekst: setningen bygges av `describeProjectChange`, så formuleringen kan rettes uten datamigrering. `summarizeProjectChanges` deduperer på den ferdige SETNINGEN (ti flyttinger blir én linje) og kutter på `MAX_CHANGE_LINES` = 12. Nullpunktet for «hva er nytt» er forrige `update`-utsending — publiseringsvarselet teller bevisst ikke, siden det ikke beskriver endringer. Radene slettes ALDRI; filtreringen skjer på tidspunkt, slik at «hva ble det egentlig varslet om?» kan besvares i ettertid. Endringer logges fra `addWorkToProject`, `removeWorkFromProject`, `moveWorkInProject`, `updateProjectWorkPercussion`, `updateProject` (navn/dato/sted/beskrivelse/slagverksnotater, kun det som FAKTISK ble annerledes) og de tre `projectTime`-funksjonene. Utsendingen er en BEVISST handling («Send oppdateringsvarsel»), aldri automatikk — og prosjektsiden viser nøyaktig de linjene mottakerne får, så knappen ikke trykkes i blinde.
  - **Varslingsvalget er `notification_preferences.projects`** (`'all' | 'off'`, ingen rad = `'all'`) på `/min-profil`, og dekker BÅDE publiseringsvarselet og endringsvarselet — ett valg, av samme grunn som `board_tasks` dekker to e-poster. **SMS er bevisst ikke bygget** (#51 nevner det som en mulighet): kostnad, samtykke og telefonnummer er tre selvstendige avklaringer, og telefonnummer er dessuten administrasjonsdata i denne modellen. Malene `projectPublishedEmail`/`projectUpdateEmail` bor i `email.ts`; sendingen i `src/server/project-notify.ts`, som har LEVENDE eksport som rører `cloudflare:workers` og derfor aldri importeres fra en rutekomponent (mønsteret `board-notify.ts`). `ProjectNotify.tsx` utleder til og med typen sin fra loaderen i stedet for å importere den derfra.
  - **Prosjektkommentarer (#27) er én tabell med to roller.** `project_comments.parent_id = NULL` er en tråd (spørsmålet), en rad med `parent_id` er et svar. Ett nivå: `addProjectComment` nekter å svare på et svar, og selv-fremmednøkkelen cascader, så en tråd modereres som en tråd. Alle som ser prosjektet kan spørre (`requireMe()` + samme synlighetsregel som `getProject`, gjentatt i `readableProject` slik at en id i et rått kall ikke kan bekrefte et upublisert prosjekt); `projects.manage` svarer og markerer «avklart» — uten det skillet kunne den som spurte lukket sitt eget spørsmål før noen så det. Sletting følger veggens regel (egen kommentar eller moderator). REN TEKST, som veggens kommentarer: teksten rendres som en tekstnode, aldri HTML, og @-omtaler er IKKE bygget her. Trådene sorteres av `threadsFrom` i `src/lib/project-comments.ts` — åpne først, nyeste øverst, svar kronologisk. **Ingen e-post fra kommentarer**, bevisst: en tråd som varsler hele korpset ville vært nøyaktig den kanalen #51 ber oss holde stille. Det er også det åpenbare neste steget hvis spørsmål blir liggende ubesvart.
- Styre: `/styre` er styrets eget område (oppgaver, styreprosjekter, møter,
  chat, kommentarer, dokumenter), gated på `board.manage` — også for lesing.
  `src/server/board.ts` har serverfunksjonene, `src/lib/board.ts` den rene
  logikken (oppgavesortering, «forfalt», gruppering, prosjektfremdrift,
  dag-gruppering og ulest-telling i chatten) med tester. Dokumenter ligger i
  R2-bindingen `FILES` under prefikset `board/`; de lastes opp med én `PUT` mot
  `src/routes/api/board-files/upload.ts` og kan KUN hentes gjennom den gatede
  ruten `src/routes/api/board-files/$documentId.ts` — aldri via note-gaten i
  `api/files/$fileId`. `src/server/board-files.ts` er R2-laget og
  `src/server/board-notify.ts` sender begge e-postene om oppgaver
  (`taskAssignedEmail` ved delegering, `overdueTasksEmail` ved forfalt frist);
  begge har levende eksport som rører `cloudflare:workers` og importeres aldri
  fra en rutekomponent.
- **Utstyr (#13):** `/utstyr` er utstyrsregisteret — hvem eier hva, hva er lånt
  inn, og hvilket prosjekt skal det brukes til. Tabellene er `assets` /
  `asset_images` / `asset_projects` (migrasjon `0016_utstyrsregister.sql`, kun
  CREATE TABLE + CREATE INDEX + rettighetsseeding). Serverfunksjonene bor i
  `src/server/utstyr.ts`, R2-laget og bildegaten i `src/server/utstyr-images.ts`
  (levende eksporter, importeres aldri fra en rutekomponent — post-images.ts-mønsteret),
  de rene reglene i `src/lib/utstyr.ts` med tester. Fire ting er ikke til forhandling:
  - **Tilgangsmodellen er skjev med vilje.** Lesing krever bare `requireMe()`:
    «kven eiger denne skarptromma?» er et spørsmål alle stiller, og et register
    bare materialforvalteren ser er et regneark med ekstra steg. ALL skriving
    krever `assets.manage`. Eierskap i registeret er en OPPLYSNING om en fysisk
    gjenstand, ikke en rettighet — den som eier pauken sin privat får ikke
    skriverett av den grunn, og det finnes derfor ingen «egen» gjenstand slik
    det finnes et eget innlegg på veggen.
  - **Ingen klistremerker eller QR-koder.** Saken ba uttrykkelig om det: merking
    kan påvirke klangen på et slagverksinstrument. Identiteten er bildet pluss
    opplysningene. Bildene ligger i `FILES` under prefikset `utstyr/`, lastes opp
    med én PUT mot `/api/utstyr-images/upload` og kan KUN hentes gjennom den
    gatede `/api/utstyr-images/$imageId` — aldri via note-gaten i
    `api/files/$fileId`, og aldri med note-arkivets multipart-flyt. Nøkkelen
    bygges alltid av en fersk id og en endelse utledet av innholdstypen, aldri av
    filnavnet. R2-bytene slettes FØR raden (`deleteAsset`/`deleteAssetImage`);
    motsatt rekkefølge ville mistet nøkkelen og etterlatt objekter ingen finner.
  - **`loanedFrom` er den ENE sannheten om «er den lånt?»** Et eget boolsk felt
    ville før eller siden gitt to svar på samme spørsmål (samme grunn som at
    `event_attendance` er én tabell). `loanStatus` i `src/lib/utstyr.ts` leser
    navnet; `sanitizeAssetInput` nekter en låneperiode uten utlåner og nullstiller
    datoene når utlåneren fjernes. `sanitizeAssetInput` kalles på BÅDE oppretting
    og redigering, så et rått kall ikke kan legge igjen eierfelt som motsier
    hverandre (f.eks. et `owner_user_id` som blir stående etter at eierskapet er
    endret til «Tertnes Brass»).
  - **`asset_projects` er en koblingstabell, ikke en kolonne.** PK er
    (asset, prosjekt): en gjenstand har én relasjon til ett prosjekt om gangen, og
    `usage` flyttes fra `planned` til `used` når konserten er spilt. «Sist brukt
    på» leses av prosjektets `event_date` (`lastUsedLink`), ikke av en egen
    datokolonne — de to kan da aldri komme i utakt. Kun PUBLISERTE prosjekter kan
    kobles, og en kobling til et upublisert prosjekt filtreres bort for lesere
    uten `projects.manage`/`assets.manage`: en utstyrskobling skal ikke være en
    bakvei til navnet. **Riggelister (#12) er bevisst ikke bygget** — de kommer
    som egen sak og kan referere `assets.id` direkte uten å endre modellen.
  Navigasjon: Utstyr har **ingen oppføring i toppmenyen**. §6 i
  `docs/designprinsipper.md` er på taket, og et sjette punkt for et vanlig medlem
  ville forsvunnet bak fade-gradienten på mobil. Området nås fra «Områder» på
  hub-en (`areasFor` i `src/lib/hub.ts`) — samme løsning som Filtilganger fikk.
- **Cron og worker-entry:** `wrangler.jsonc` peker `main` på `src/worker.ts` i
  stedet for `@tanstack/react-start/server-entry`, fordi Start sin entry bare
  eksporterer `fetch` og vi trenger en `scheduled`-handler ved siden av.
  Cloudflare-pluginen pakker `main` inn og setter den som input for
  `ssr`-miljøet; Start-pluginen respekterer en input som allerede er satt, så
  SSR-oppsettet er uendret. `triggers.crons: ["0 7 * * *"]` (07:00 UTC ≈ 09:00
  norsk tid) kaller `runOverdueReminders()`, som sender ÉN e-post per ansvarlig
  med alle hens forfalte oppgaver. Idempotens uten kø: `settings`-raden
  `board.reminders.lastRunDate` settes til dagens dato (norsk tid) FØR
  utsendingen, som compare-and-set (`UPDATE … WHERE value <> today`) — to
  samtidige kjøringer kan aldri begge vinne. Lokalt trigges cron-en med
  `curl "http://localhost:<port>/cdn-cgi/handler/scheduled?cron=0+7+*+*+*"`
  (`pnpm dev`); den kjører aldri av seg selv i dev.
- Varslingsvalget for styreoppgaver er `notification_preferences.board_tasks`
  (`'all' | 'off'`, ingen rad = `'all'`) og dekker BÅDE delegering og den
  daglige påminnelsen. Regelen er `wantsTaskEmail` i `src/lib/board.ts`, og
  valget vises på `/min-profil` kun for dem som har `board.manage`.
- **Styrechatten** er kanaler som strenger: `general`, `project:<id>` eller
  `custom:<id>` (`parseChannel`/`projectChannel`/`customChannel` i
  `src/lib/board.ts` er sannhetskilden for formatet). De to første har en eier
  andre steder i modellen og har derfor INGEN rad noe sted; de egendefinerte
  kanalene (#80) bor i `board_channels` og er de eneste `custom:`-nøklene som
  finnes. `board_messages.channel` er fortsatt en streng — kanaltabellen kom
  additivt, uten datamigrering. `assertChannelExists` gater både lesing og
  skriving på at kanalen finnes; `{ write: true }` krever i tillegg at den ikke
  er arkivert (arkivering er myk: historikken leses, samtalen er over).
  Ingen websockets og ingen Durable Objects — `listMessages({channel, after})`
  pollet hvert 12. sek fra `src/components/BoardChat.tsx`, kun mens
  `document.visibilityState` er `visible`. Uleste bor i `board_channel_reads`;
  tellerne beregnes i SQL over kanalene som faktisk STÅR i kanallista (arkiverte
  og lagte-bort prosjekter teller ikke — en prikk man ikke kan lese bort er en
  prikk ingen stoler på), mens «nye meldinger»-skillet i den åpne kanalen bruker
  den rene `unreadCount`.
- **Svar i chatten:** `board_messages.reply_to_id` (ON DELETE SET NULL) pluss
  `reply_to_deleted`. Fremmednøkkelen alene ville slettet selve opplysningen om
  at meldingen VAR et svar, så `deleteMessage` merker svarene før originalen
  forsvinner, og `replyReference` i `src/lib/board.ts` gjør raden om til enten
  en klikkbar referanse eller «Meldingen er slettet». Ett nivå, aldri nøstet.
- **Gruppeledere (#81):** `/gruppeledere` er stemmegruppeledernes eget område
  (oversikt + chat), og det første som **ikke** gates på en rettighet alene.
  `requireGroupLeader()` i `src/server/gruppeledere.ts` krever
  `members.manage.section` (eller `*`) OG minst én aktiv rad i `section_leaders`
  (`me.leadsPartIds.length > 0`) — en admin uten leiarbinding kommer ikke inn.
  Regelen er den rene `isGroupLeader` i `src/lib/gruppeledere.ts`, delt av
  guarden, `beforeLoad`, `Shell.tsx` og `areasFor` (som derfor tar
  `{ leadsPartIds }` som andre argument). Siden `leadsPartIds` beregnes i
  `currentUser()` ved hvert kall, forsvinner tilgangen straks bindingen fjernes.
  Guarden er bevisst **ikke eksportert**: en levende eksport i den modulen ville
  holdt modulkroppen i live i klientbygget og dratt `./access` +
  `@tanstack/react-start/server` med seg (samme felle som `post-images.ts`).
  **Datamodellen er egen:** `leader_channels`/`leader_messages`/
  `leader_channel_reads` (migrasjon `0013_gruppeledere-og-omtaler.sql`, kun CREATE TABLE)
  speiler styrets tabeller, men ingen spørring her rører `board_*` — én tabell
  med en `area`-kolonne ville gjort én glemt WHERE til en lekkasje. Ingen
  prosjekttråder: `assertChannelExists` godtar bare `general` og `custom:<id>`.
- **ChatPanel:** chat-UI-et bor i `src/components/ChatPanel.tsx` og deles av
  `/styre/chat`, `/gruppeledere/chat` og prosjekttråden. `ChatThread` er tråden
  (det `BoardChat` var), `ChatPanel` er kanallista + tråden + navnedialogen.
  Begge tar serverfunksjonene inn som `api`/`channelApi` — komponenten kjenner
  ingen tabell, og tilgangskontrollen ligger i modulen funksjonene kom fra.
  `BoardChat.tsx` er nå bare skallet som binder `ChatThread` til
  `src/server/board.ts`, så kallstedene i styreområdet er uendret. `api` og
  `onRead` bor i refs inne i `ChatThread`: begge er objektliteraler hos
  kalleren, og ville ellers restartet polling og lest-markering ved hver render.
- **Chat-format:** `src/lib/chat-format.ts` er en egen liten tokenizer for
  backticks (inline, doble backticks når koden selv har en backtick, og fenced
  blokker med valgfri språkmarkør) — IKKE en markdown-rendrer. Alt annet er ren
  tekst, og `src/components/ChatText.tsx` rendrer bitene som tekstnoder i
  `<code>`/`<pre>`, aldri HTML. Rå HTML og annen markdown skal aldri tolkes;
  `chat-text.test.ts` låser både formateringen og escapingen.
- Hub-forsiden: `src/server/hub.ts` (`getHub`) henter kalender, neste publiserte prosjekt (med antall verk) og `me` i parallell og returnerer en liten payload. Reglene — hvilken hendelse som blir hero, og hvilke områdesnarveier rettighetene gir — ligger i `src/lib/hub.ts` (`chooseHero`, `eventsAfter`, `areasFor`), testet i `hub.test.ts`. `areasFor` må holdes i takt med `BASE_NAV` i `Shell.tsx` — med ett bevisst unntak: Filtilganger har kort på hub-en, men ingen toppmeny-oppføring (docs/designprinsipper.md §6). Hub-en henter også de tre siste beskjedene, audience-filtrert på samme regel som `/beskjeder`.
- **Medlemsprofil: kontaktinfo og interesser (#14 + #25):** profilen er utvidet
  additivt (migrasjon `0016_medlemsprofil-kontakt-interesser.sql`: tre
  `ADD COLUMN` på `member_profiles` + `CREATE TABLE member_instruments`). De
  rene reglene bor i `src/lib/member-profile.ts` (`INTEREST_CATALOG`,
  `normalizeInterests`, `matchesInterests`, `cleanSecondaryParts`,
  `canSeeContactInfo`, `redactContact`) med tester; skrivelaget er
  `src/server/member-details.ts`, som har levende eksport og derfor bare
  importeres fra `profile.ts` og `members.ts` — aldri fra en rutekomponent
  (samme felle som `post-images.ts`). Fire ting er ikke til forhandling:
  - **Innsynsregelen er snudd med vilje.** Telefon var «kun for
    administratorer»; nå er kontaktinfo synlig for alle innloggede medlemmer,
    fordi `currentUser()` allerede returnerer `null` for deaktiverte og hele
    poenget i #14 er å få tak i folk ved fravær. Unntaket går andre veien: et
    DEAKTIVERT medlems e-post og telefon fjernes SERVER-side i `redactContact`
    (feltene finnes ikke i payloaden, ikke bare skjult i UI-et) for alle andre
    enn `members.manage` og medlemmet selv.
  - **Bistemme er kompetanse, ikke tilgang.** `member_instruments` leses ALDRI
    av `effectivePartIds` i `access.ts`; `user_parts` er fortsatt det eneste som
    gir stemmefiler. Derfor kan medlemmet sette bistemmene sine selv, mens
    stemmetildeling fortsatt krever `members.manage`/`members.manage.section`.
    `cleanSecondaryParts` fjerner tildelte stemmer fra bistemmelista, slik at
    hovedstemmen aldri får en parallell sannhet.
  - **Interessene er en fast katalog, ikke fritekst-tagger.** «Hvem kan hjelpe
    med rigg?» krever at alle har krysset av det samme ordet; nyansen bor i
    fritekstfeltet ved siden av. Kolonnen er JSON (som `invitations.part_ids`) —
    det finnes ingen FK å peke på, og en tabell ville blitt en tabell med
    strenger. `parseInterests` dropper ukjente nøkler, så en rå payload kan
    ikke lage egne tagger. Filteret i medlemslista er AND: to valgte tagger
    betyr noen som kan begge deler.
  - **Ett skjema, to steder.** `src/components/MemberDetailsFields.tsx` deles av
    `/min-profil` og medlemsansvarliges dialog i `/medlemmer`, og
    `saveMemberDetails` er felles skrivelag — bare gaten (`requireMe()` mot
    `requirePermission('members.manage')`), navnefeltet og revisjonshandlingen
    skiller dem. Selvbetjeningen skriver alltid til `me.id`, aldri til en
    `userId` fra payloaden.
- Roller: `SEED_ROLES` i `src/server/seed-data.ts` (`admin`, `archivist`, `conductor`, `board` «Styremedlem», `member`). `seedBaseConfig` legger inn systemroller som MANGLER og seeder standardrettighetene kun for dem den nettopp opprettet (fjernede rettigheter skal ikke komme tilbake). Prod seedes ikke av seg selv, så en ny systemrolle eller rettighet krever fortsatt en migrasjon — se `migrations/0008_board-role.sql` og `0009_styre-og-vegg.sql`. NB: `INSERT OR IGNORE` dekker ikke fremmednøkler — skriv `INSERT ... SELECT id, '<rettighet>' FROM roles WHERE id IN (…)` så migrasjonen også går gjennom i en database uten roller. `board` har `scores.view` + `board.manage` (styreområdet) + `posts.publish` (veggen); `conductor` har også `posts.publish`.
- **Flere roller per medlem (#48):** koblingstabellen `member_roles` (PK `(auth_user_id, role_id)`) er SANNHETEN om hvilke roller et medlem har, og `invitation_roles` det samme for en invitasjon (migrasjon `0016_flere-roller-per-medlem.sql`, kun CREATE TABLE + CREATE INDEX + `INSERT ... SELECT`-backfill). **Tilgangene er UNIONEN** av rettighetene fra alle rollene (`unionRolePermissions` i `src/lib/roles.ts`); roller er rent additive, og ingen rolle kan trekke fra. `Me` har derfor `roles: Array<{id, name}>` — `roleId`/`roleName` finnes ikke lenger.
  - **`member_profiles.role_id` og `invitations.role_id` er DEPRECATED, men står.** De er NOT NULL uten standardverdi og kan ikke droppes uten en tabell-rebuild, som i D1 cascader til barnetabellene (se punktet om tabell-rebuild under). Les dem ALDRI som rollen. Skrivestien holder dem i takt med hovedrollen (`primaryRoleId`), og `effectiveRoleIds(linked, legacy)` faller tilbake på kolonnen KUN når koblingsradene mangler — vinduet mellom migrasjon og deploy, der gammel kode fortsatt bare skrev til kolonnen. Fjernes fallbacken, mister de kontoene all tilgang.
  - **Andre medlemmers rettigheter slås opp ÉTT sted:** `memberPermissionsByUser()` i `src/server/access.ts` (Map `userId → unionen`), brukt av `posts.ts` (hvem kan publisere / omtales), `board.ts` (hvem er i styret) og alle andre som vurderer noen andre enn den innloggede. Det gamle mønsteret — «sett av roller med rettigheten» + `roles.has(m.roleId)` — gir feil svar for alle med mer enn én rolle, og skal ikke gjenskapes med en ny join.
  - `role_id` i begge koblingstabellene har BEVISST ingen `ON DELETE`: en slettet rolle skal ikke kunne ta med seg medlemmenes tilganger i stillhet. `deleteRole` teller alle fire stedene (begge koblingstabeller + begge deprecated kolonner) og nekter mens rollen er i bruk.
  - **`PERMISSION_CATALOG` bor nå i `src/lib/permissions.ts`** (ren data, re-eksportert fra `settings.ts`). Flyttingen var nødvendig for at `/medlemmer` skal kunne forklare hva et rollevalg gir: importerte `members.ts` katalogen fra `settings.ts`, ville en modul full av `createServerFn`-kall — og dermed `cloudflare:workers` — havnet i klientbygget for medlemsruta.
  - **Rolleoversikten** er `src/components/RoleAccess.tsx` (rene visningskomponenter): `RoleGuide` på `/innstillinger` over rettighetsmatrisen, `RolePermissionList` + `AccessSummary` i rollevelgeren på `/medlemmer`. `accessSources` i `src/lib/roles.ts` er logikken — hver rettighet i unionen med rollen(e) som gir den.
  - I demodata har Karim (`karim@demo…`) rollene **Musiker + Styremedlem** — den kombinasjonen er hele poenget i #48, og gjør den testbar med dev-login. `SEED_MEMBERS.roleIds` er derfor en liste; første element er hovedrollen.
  - `isGroupLeader` er fortsatt KUN bindingsbasert og er ikke rørt. Det finnes med vilje INGEN systemrolle som heter «Gruppeleder»: en slik rolle ville ikke gitt tilgang til `/gruppeledere` (det gjør `section_leaders`-raden), og navnet ville løyet. `AccessSummary` sier dette eksplisitt i UI-et.
- **Tabell-rebuild i D1:** drizzle-kit genererer `PRAGMA foreign_keys=OFF` + `CREATE __new_x` / `DROP TABLE x` / `RENAME` når en kolonne endres. D1 kjører migrasjonen i en transaksjon, der PRAGMA-en er en **no-op** — `DROP TABLE` cascader altså til barnetabellene og sletter data i stillhet. Sjekk alltid hvem som peker på tabellen før du lar en generert rebuild passere — sikre barnetabellenes rader i en midlertidig tabell og legg dem tilbake etterpå, eller unngå rebuilden helt ved å gjøre skjemaendringen additiv.
- Slagverksoppsett (regnearkets siste rest): `project_works.percussion_setup` (oppsettet for ETT stykke i ETT prosjekt) og `projects.percussion_notes` (transport/lån/rigging for hele konserten) — begge nullbar fri tekst. Skriving gates på `projects.manage` (`updateProjectWorkPercussion` + `percussionNotes` i `updateProject`), lesing er åpen for alle som ser prosjektet. Reglene er rene funksjoner i `src/lib/percussion.ts` (`showPercussionFor`, `sharedPartsSeePercussion`, `parsePercussionSetup`) med tester: på «Mine noter» og i vikarvisningen fjernes feltene SERVER-side for alle som ikke har en stemme i seksjonen `perc` (eller `archive.viewAll`/`works.manage`/`projects.manage`) — UI-et skal ikke måtte huske regelen. Samlesiden `/noter/prosjekter/$projectId/slagverk` (`$projectId_.slagverk.tsx` — understrek fordi `$projectId.tsx` er en bladrute uten `Outlet`) er utskriftsvennlig via `@media print` i `src/styles.css`; skjermkrom merkes `.print-hidden`.
- Demodata: `src/server/seed.ts`, kun via dev-ruten `/api/dev-seed` (gated på `import.meta.env.DEV`). `seedWallDemo()` og `seedLeaderDemo()` kjører i tillegg ved hver dev-innlogging og er idempotente (faste demo-id-er / vakter per bolk): forfattere, kommentarer, likes og leiarbindinger kobles på etter hvert som demobrukerne faktisk opprettes ved første innlogging — så den FØRSTE innloggingen som ny demobruker gir ennå ikke bindingen, den andre gjør det. `seedLeaderDemo()` gir dessuten «Musiker»-rollen `members.manage.section` **kun i dev**, siden ingen seedet rolle har den: Ingrid og Karim blir gruppeledere fordi de har en `section_leaders`-rad, mens Jonas (samme rolle, ingen rad) fortsatt avvises — nettopp poenget i #81.

## Nye features = eget app-område

`docs/designprinsipper.md` er normativt: hvert større område er en liten app med
eget inngangspunkt, én primærbruker, én primærhandling og egen oversikt — men
felles navigasjon, auth, roller, designsystem og datamodell. Ikke samle nye
funksjoner i én stor administrasjonsside, og ikke parker dem under
`/innstillinger` fordi de føles administrative. Navigasjonsmodellen er avgjort
(§6, alternativ (a), 30. august 2026): kort toppmeny i `Shell.tsx` + egen
områdemeny per område, slik `src/routes/noter/route.tsx` gjør det.

Besvar disse sju punktene i saken eller PR-en **før** du skriver koden: **navn ·
formål · primærbruker · primærhandling · plass i navigasjonen · rettigheten som
gater det** (`PERMISSION_CATALOG` i `src/server/settings.ts`, håndhevet
server-side) **· eget rutenavnerom?** Toppmenyen i `src/components/Shell.tsx`
har begrenset plass (mobilstripen scroller alt ved seks oppføringer) — se §6 i
dokumentet før du legger til en ny; undernavigasjon i et eksisterende område er
som regel riktigere.

Tilgangsstyring: `docs/tilgangsstyring.md`. Reglene der er ikke til forhandling.

## Konvensjoner

- UI-tekst på norsk (bokmål); kodeidentifikatorer på engelsk
- Env-tilgang via `import { env } from 'cloudflare:workers'` — kun i serverkode
- Ikke importer `@tanstack/start-server-core` direkte (knekker vite-pluginens virtuelle moduler) — bruk `@tanstack/react-start/server`

<!-- intent-skills:start -->
# Skill mappings - load `use` with `pnpm dlx @tanstack/intent@latest load <use>`.
skills:
  - when: "Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence."
    use: "@tanstack/devtools#devtools-app-setup"
  - when: "Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins."
    use: "@tanstack/devtools#devtools-marketplace"
  - when: "Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels."
    use: "@tanstack/devtools#devtools-plugin-panel"
  - when: "Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns."
    use: "@tanstack/devtools#devtools-production"
  - when: "Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only."
    use: "@tanstack/devtools-event-client#devtools-bidirectional"
  - when: "Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions."
    use: "@tanstack/devtools-event-client#devtools-event-client"
  - when: "Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging."
    use: "@tanstack/devtools-event-client#devtools-instrumentation"
  - when: "Configure @tanstack/devtools-vite for source inspection (data-tsd-source, inspectHotkey, ignore patterns), console piping (client-to-server, server-to-client, levels), enhanced logging, server event bus (port, host, HTTPS), production stripping (removeDevtoolsOnBuild), editor integration (launch-editor, custom editor.open). Must be FIRST plugin in Vite config. Vite ^6 || ^7 only."
    use: "@tanstack/devtools-vite#devtools-vite-plugin"
  - when: "Step-by-step migration from Next.js App Router to TanStack Start: route definition conversion, API mapping, server function conversion from Server Actions, middleware conversion, data fetching pattern changes."
    use: "@tanstack/react-start#lifecycle/migrate-from-nextjs"
  - when: "React bindings for TanStack Start: createStart, StartClient, StartServer, React-specific imports, re-exports from @tanstack/react-router, full project setup with React, useServerFn hook."
    use: "@tanstack/react-start#react-start"
  - when: "Implement, review, debug, and refactor TanStack Start React Server Components in React 19 apps. Use when tasks mention @tanstack/react-start/rsc, renderServerComponent, createCompositeComponent, CompositeComponent, renderToReadableStream, createFromReadableStream, createFromFetch, Composite Components, React Flight streams, loader or query owned RSC caching, router.invalidate, structuralSharing: false, selective SSR, stale names like renderRsc or .validator, or migration from Next App Router RSC patterns. Do not use for generic SSR or non-TanStack RSC frameworks except brief comparison."
    use: "@tanstack/react-start#react-start/server-components"
  - when: "Framework-agnostic core concepts for TanStack Router: route trees, createRouter, createRoute, createRootRoute, createRootRouteWithContext, addChildren, Register type declaration, route matching, route sorting, file naming conventions. Entry point for all router skills."
    use: "@tanstack/router-core#router-core"
  - when: "Route protection with beforeLoad, redirect()/throw redirect(), isRedirect helper, authenticated layout routes (_authenticated), non-redirect auth (inline login), RBAC with roles and permissions, auth provider integration (Auth0, Clerk, Supabase), router context for auth state."
    use: "@tanstack/router-core#router-core/auth-and-guards"
  - when: "Automatic code splitting (autoCodeSplitting), .lazy.tsx convention, createLazyFileRoute, createLazyRoute, lazyRouteComponent, getRouteApi for typed hooks in split files, codeSplitGroupings per-route override, splitBehavior programmatic config, critical vs non-critical properties."
    use: "@tanstack/router-core#router-core/code-splitting"
  - when: "Route loader option, loaderDeps for cache keys, staleTime/gcTime/ defaultPreloadStaleTime SWR caching, pendingComponent/pendingMs/ pendingMinMs, errorComponent/onError/onCatch, beforeLoad, router context and createRootRouteWithContext DI pattern, router.invalidate, Await component, deferred data loading with unawaited promises."
    use: "@tanstack/router-core#router-core/data-loading"
  - when: "Link component, useNavigate, Navigate component, router.navigate, ToOptions/NavigateOptions/LinkOptions, from/to relative navigation, activeOptions/activeProps, preloading (intent/viewport/render), preloadDelay, navigation blocking (useBlocker, Block), createLink, linkOptions helper, scroll restoration, MatchRoute."
    use: "@tanstack/router-core#router-core/navigation"
  - when: "notFound() function, notFoundComponent, defaultNotFoundComponent, notFoundMode (fuzzy/root), errorComponent, CatchBoundary, CatchNotFound, isNotFound, NotFoundRoute (deprecated), route masking (mask option, createRouteMask, unmaskOnReload)."
    use: "@tanstack/router-core#router-core/not-found-and-errors"
  - when: "Dynamic path segments ($paramName), splat routes ($ / _splat), optional params ({-$paramName}), prefix/suffix patterns ({$param}.ext), useParams, params.parse/stringify, pathParamsAllowedCharacters, i18n locale patterns."
    use: "@tanstack/router-core#router-core/path-params"
  - when: "validateSearch, search param validation with Zod/Valibot/ArkType adapters, fallback(), search middlewares (retainSearchParams, stripSearchParams), custom serialization (parseSearch, stringifySearch), search param inheritance, loaderDeps for cache keys, reading and writing search params."
    use: "@tanstack/router-core#router-core/search-params"
  - when: "Non-streaming and streaming SSR, RouterClient/RouterServer, renderRouterToString/renderRouterToStream, createRequestHandler, defaultRenderHandler/defaultStreamHandler, HeadContent/Scripts components, head route option (meta/links/styles/scripts), ScriptOnce, automatic loader dehydration/hydration, memory history on server, data serialization, document head management."
    use: "@tanstack/router-core#router-core/ssr"
  - when: "Full type inference philosophy (never cast, never annotate inferred values), Register module declaration, from narrowing on hooks and Link, strict:false for shared components, getRouteApi for code-split typed access, addChildren with object syntax for TS perf, LinkProps and ValidateLinkOptions type utilities, as const satisfies pattern."
    use: "@tanstack/router-core#router-core/type-safety"
  - when: "TanStack Router bundler plugin for route generation and automatic code splitting. Supports Vite, Webpack, Rspack, and esbuild. Configures autoCodeSplitting, routesDirectory, target framework, and code split groupings."
    use: "@tanstack/router-plugin#router-plugin"
  - when: "Programmatic route tree building as an alternative to filesystem conventions: rootRoute, index, route, layout, physical, defineVirtualSubtreeConfig. Use with TanStack Router plugin's virtualRouteConfig option."
    use: "@tanstack/virtual-file-routes#virtual-file-routes"
<!-- intent-skills:end -->
