# tb-intern — notater for agenter

Repoet het tidligere `tb-notearkiv` (omdøpt 31. august 2026). Cloudflare-Workeren, D1-databasen og R2-bøtta heter fortsatt `tb-notearkiv` — det navnet skal IKKE endres (nytt Worker-navn = ny Worker uten bindinger/secrets).

Notearkiv for brass band (Tertnes Brass). TanStack Start (React) på Cloudflare Workers, D1 (Drizzle) + R2. Norsk UI.

## Kommandoer

- `pnpm dev` — dev-server (lokal D1/R2 via miniflare i `.wrangler/state`)
- `pnpm exec tsc --noEmit` — typesjekk (skal være grønn før commit)
- `pnpm exec drizzle-kit generate --name <navn>` → `pnpm exec wrangler d1 migrations apply tb-notearkiv --local` — skjemaendringer
- `pnpm generate-routes` — regenerer routeTree etter nye filer i `src/routes/`

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
Chat · Dokumenter), gated på `board.manage`. `src/routes/index.tsx` (`/`) er
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
- Beskjeder (#28) — **veggen**: `src/server/posts.ts` (feed, detalj, utkast, publisering, kommentarer, reaksjoner, varsling). Lesing og skriving krever bare `requireMe()` — alle medlemmer kan poste, kommentere og like. `posts.publish` gir de fire tingene som skiller en styrebeskjed fra et innlegg: «Fra styret» (`posts.official`), «Viktig», `audience: 'board'` og e-post — pluss moderasjon av andres innhold. Reglene er rene funksjoner i `src/lib/posts.ts` (`sanitizePostInput`, `canEditPost`, `canDeleteComment`, `canReadPost`, `postHeading`, `recipientsFor`, `toggleReaction`, e-postkopien), testet i `posts.test.ts`. `sanitizePostInput` kalles på BÅDE opprettelse og redigering, så et privilegert felt aldri kan snikes inn i et rått kall; uten `posts.publish` endrer `updatePost` kun tittel og tekst. Utkast og `audience: 'board'` filtreres alltid server-side — med ett tillegg: ditt eget innlegg er alltid synlig for deg, ellers ville et innlegg som stoppet opp under bildeopplasting blitt usynlig for den som skrev det. Tittel er valgfri (`postHeading` faller tilbake til første linje). Teksten er ren tekst med avsnitt, aldri markdown eller betrodd HTML.
- **Bilder på veggen:** R2 via `posts/<fersk id>.<ext>` — nøkkelen bygges aldri av filnavnet. Opplasting er én PUT mot `/api/post-images/upload` (ikke note-arkivets multipart-flyt), visning kun via `/api/post-images/$imageId`. Begge gates i `src/server/post-images.ts` (`canAttachImages`, `postImageAccess`), som er en EGEN modul fordi den har levende eksporter: lå de i `posts.ts`, ville `cloudflare:workers` blitt dratt inn i klientbygget. Bildebytene slettes fra R2 før raden i `deletePost`/`deletePostImage`.
- **E-postvarsling og idempotens:** `publishPost` sender via `sendEmail` i puljer på fem, og skriver én rad i `notification_log` per mottaker (PK `(post_id, user_id)`) med utfallet `sent`/`logged`/`failed`. Loggen er sannheten om hvem som har fått hva: `resendPostNotifications` sender kun til dem som mangler en rad, og en avpublisert/republisert beskjed sender aldri på nytt til de samme. `logged` betyr konsoll-logg (ingen e-post gikk ut) og skal aldri presenteres som «sendt» — `notifyResultMessage` er felles sannhetskilde, som `inviteDeliveryMessage`. Varslingsvalget per medlem ligger i `notification_preferences` (ingen rad = alle beskjeder) og settes på `/min-profil`.
- Kalender: `src/lib/ical.ts` er en egen iCalendar-parser (folding, TZID/UTC/heldag, RRULE+EXDATE+RECURRENCE-ID) som ekspanderer forekomster i veggklokke-tid — ingen avhengigheter, testet i `ical.test.ts`. `src/server/calendar-feed.ts` henter Google-feeden fra secreten `CALENDAR_ICS_URL` (aldri til klienten, aldri i cache-nøkkelen) med ti minutters cache og eksporterer `loadCalendar`; `src/server/calendar.ts` eksponerer `getCalendar`/`getNextEvent` bak `requireMe()`. Delingen er nødvendig: et *levende* eksport i en modul en rute importerer, drar `cloudflare:workers` inn i klientbygget. Serverfunksjoner kaller aldri andre serverfunksjoner — de deler `loadCalendar`. Tidsvinduet (fra i går, 17 uker ≈ fire måneder frem) og taket på antall forekomster bor i `src/lib/calendar-window.ts` — egen ren modul, slik at vinduet kan testes uten Workers-runtime og `/kalender` kan skrive «De neste fire månedene» uten å gjette. Hub-en bruker samme `loadCalendar`, men sender bare `eventsAfter(...4)` til klienten.
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
- Styrechatten er kanaler som strenger: `general` eller `project:<id>` (se
  `projectChannel`/`channelProjectId` i `src/lib/board.ts`). Ingen websockets og
  ingen Durable Objects — `listMessages({channel, after})` pollet hvert 12. sek
  fra `src/components/BoardChat.tsx`, kun mens `document.visibilityState` er
  `visible`. Uleste bor i `board_channel_reads`; tellerne beregnes i SQL, mens
  «nye meldinger»-skillet i den åpne kanalen bruker den rene `unreadCount`.
- Hub-forsiden: `src/server/hub.ts` (`getHub`) henter kalender, neste publiserte prosjekt (med antall verk) og `me` i parallell og returnerer en liten payload. Reglene — hvilken hendelse som blir hero, og hvilke områdesnarveier rettighetene gir — ligger i `src/lib/hub.ts` (`chooseHero`, `eventsAfter`, `areasFor`), testet i `hub.test.ts`. `areasFor` må holdes i takt med `BASE_NAV` i `Shell.tsx` — med ett bevisst unntak: Filtilganger har kort på hub-en, men ingen toppmeny-oppføring (docs/designprinsipper.md §6). Hub-en henter også de tre siste beskjedene, audience-filtrert på samme regel som `/beskjeder`.
- Roller: `SEED_ROLES` i `src/server/seed-data.ts` (`admin`, `archivist`, `conductor`, `board` «Styremedlem», `member`). `seedBaseConfig` legger inn systemroller som MANGLER og seeder standardrettighetene kun for dem den nettopp opprettet (fjernede rettigheter skal ikke komme tilbake). Prod seedes ikke av seg selv, så en ny systemrolle eller rettighet krever fortsatt en migrasjon — se `migrations/0008_board-role.sql` og `0009_styre-og-vegg.sql`. NB: `INSERT OR IGNORE` dekker ikke fremmednøkler — skriv `INSERT ... SELECT id, '<rettighet>' FROM roles WHERE id IN (…)` så migrasjonen også går gjennom i en database uten roller. `board` har `scores.view` + `board.manage` (styreområdet) + `posts.publish` (veggen); `conductor` har også `posts.publish`.
- **Tabell-rebuild i D1:** drizzle-kit genererer `PRAGMA foreign_keys=OFF` + `CREATE __new_x` / `DROP TABLE x` / `RENAME` når en kolonne endres. D1 kjører migrasjonen i en transaksjon, der PRAGMA-en er en **no-op** — `DROP TABLE` cascader altså til barnetabellene og sletter data i stillhet. Sjekk alltid hvem som peker på tabellen før du lar en generert rebuild passere — sikre barnetabellenes rader i en midlertidig tabell og legg dem tilbake etterpå, eller unngå rebuilden helt ved å gjøre skjemaendringen additiv.
- Slagverksoppsett (regnearkets siste rest): `project_works.percussion_setup` (oppsettet for ETT stykke i ETT prosjekt) og `projects.percussion_notes` (transport/lån/rigging for hele konserten) — begge nullbar fri tekst. Skriving gates på `projects.manage` (`updateProjectWorkPercussion` + `percussionNotes` i `updateProject`), lesing er åpen for alle som ser prosjektet. Reglene er rene funksjoner i `src/lib/percussion.ts` (`showPercussionFor`, `sharedPartsSeePercussion`, `parsePercussionSetup`) med tester: på «Mine noter» og i vikarvisningen fjernes feltene SERVER-side for alle som ikke har en stemme i seksjonen `perc` (eller `archive.viewAll`/`works.manage`/`projects.manage`) — UI-et skal ikke måtte huske regelen. Samlesiden `/noter/prosjekter/$projectId/slagverk` (`$projectId_.slagverk.tsx` — understrek fordi `$projectId.tsx` er en bladrute uten `Outlet`) er utskriftsvennlig via `@media print` i `src/styles.css`; skjermkrom merkes `.print-hidden`.
- Demodata: `src/server/seed.ts`, kun via dev-ruten `/api/dev-seed` (gated på `import.meta.env.DEV`). `seedWallDemo()` kjører i tillegg ved hver dev-innlogging og er idempotent (faste demo-id-er): forfattere, kommentarer og likes kobles på etter hvert som demobrukerne faktisk opprettes ved første innlogging.

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
