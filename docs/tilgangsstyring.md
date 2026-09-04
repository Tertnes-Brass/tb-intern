# Nøstede stemmer + hard tilgangsstyring + seksjonsleder

Designdokument for `feat/tilgangsstyring`. Utgangspunkt: testtilbakemelding om at
slagverk blir et puslespill med mange stemmer, og ønsket om at en tildelt
forelder-stemme («Slagverk») gir tilgang til alle understemmer, mens «Slagverk 1»
kun gir den ene. Besluttet modell: **hard tilgangsstyring** (tildelt stemme styrer
faktisk nedlasting), ikke bare filtrering.

> **Grunnregel:** server-gaten `src/routes/api/files/$fileId.ts` er det ENESTE
> reelle forsvaret. Alt annet (getWork, assembleRepertoire, getShareView, UI) er
> kosmetikk og må aldri bli eneste skranke.

> **Status per 28. juni 2026:** Fase 4 er deployet til prod (versjon `0e016750`)
> og den harde fil-gaten er **aktiv**. Migrasjonen `0001_nested_parts` er
> applisert `--remote`, og `archive.viewAll` er seedet til `archivist` +
> `conductor` i prod. Samme dag ble det besluttet å **ikke bygge stemme-treet**:
> strukturen forblir flat — tilgang på stemme-nivå er godt nok — og
> `parent_id` brukes nå til den visuelle koblingen Partitur → Dirigent, men
> tilgangstreet er fortsatt flatt for instrumentstemmer.

## 1. Valgt modell

- **Grunnstamme:** én nullable self-FK `parts.parent_id` + ekspansjon ved oppslag
  i `currentUser()`. Ingen closure-tabell. Instrumentstemmene forblir flate.
  Partitur kan ligge visuelt under Dirigent, men `score` ekskluderes eksplisitt
  fra tilgangstreet og styres fortsatt av `scores.view`.
- **Seksjonsleder:** ny scoped evne `members.manage.section` + scope-tabell
  `section_leaders` + `canManageMemberParts(me, targetUserId, partIds)` med streng
  `⊆`-validering (`.every()`) på HVER innsendt partId.
- **Privilegerte roller:** ny rettighet `archive.viewAll` (seedes til `archivist`
  + `conductor`; dekket av `*` for admin) bevarer full arkivinnsyn etter
  innstrammingen.
- **Én sannhetskilde for ekspansjon:** ren helper `expandPartIds(rawIds, childrenMap)`
  (`src/server/parts-tree.ts`) brukt av effektive stemmer, ledelsesomfang OG
  share-snapshot. Sykel-vern (visited-set) + hard dybdegrense.
- **Share-scope snapshottes til løvnoder ved opprettelse** — vikar-grenen blir en
  ren `includes` uten lesetids-ekspansjon, immun mot senere tre-endringer.
- **Additiv datamodell:** én `ALTER` + én ny tabell. Ingen tabell-rebuild, ingen
  eksisterende rad endres.

Sentral invariant: **maks 2 nivåer** (forelder med `parent_id IS NULL`, blad med
`parent_id` satt), håndhevet i app-laget (`createPart`/`updatePart`), ikke i DB.

## 2. Faseinndelt rollout

Faserekkefølgen er den sikkerhetskritiske delen. Fase 0–3 endrer **ingen
brukersynlig oppførsel**. Innstrammingen kommer først i fase 4, gated bak en
oppstartssjekk (fase 3) som fail-faster hvis privilegerte roller mangler
`archive.viewAll`.

- **Fase 0 — Skjema + ren helper (FERDIG i denne PR-en, bakoverkompatibelt):**
  `parent_id` på `parts` (nullable) + `section_leaders`-tabell + migrasjon.
  Ren `expandPartIds`/`buildChildrenMap` med visited-set, `MAX_PART_DEPTH` og
  `'score'`-eksklusjon. Enhetstester (flat=identitet, forelder→barn, sykel,
  dybdekutt, score utenfor tre, tomt input). **Verifiserbar no-op.**
- **Fase 1 — `Me` utvides (FERDIG, fortsatt ingen håndhevelse):** `effectivePartIds`
  + `leadsPartIds` beregnes i `currentUser()`. Dødt `myPartIds` byttet til
  `effectivePartIds` i `getWork` og `assembleRepertoire`. Flatt tre ⇒ null
  atferdsendring.
- **Fase 2 — Seksjonsleder-evne + scope (FERDIG, additiv server-maskineri):**
  `members.manage.section` + `archive.viewAll` i `PERMISSION_CATALOG`.
  `canManageMemberParts` + ren `leaderCanAssign` (krever at både målets nåværende
  OG innsendte stemmer ⊆ omfang ⇒ trygg full-overskriving). `updateMemberParts`
  ny gate + self-edit avviser forelder-stemmer. `setSectionLeaderParts` gated på
  **global** `members.manage`. `createPart`/`updatePart` tar `parentId` med
  invarianter (`assertValidParent`: maks 2 nivåer, ingen sykel, aldri score);
  `deletePart` avviser forelder med barn. `archive.viewAll` seedet til
  archivist+conductor (fresh installs). UI (tre-visning, leder-binding) gjøres i
  fase 4 sammen med gaten.
- **Fase 3 — Forutsetnings-vakt (FERDIG, realisert som fail-safe):** i stedet for
  en egen oppstartssjekk gir fil-gaten **implisitt fullt innsyn til `works.manage`**
  (i tillegg til `archive.viewAll`). Siden seedede `archivist`+`conductor` har
  `works.manage`, kan de aldri låses ute selv om `archive.viewAll` skulle mangle i
  prod. `archive.viewAll` er dessuten synlig i rolle-matrisen så egendefinerte
  «se alt»-roller kan få den. Drift-status: `archive.viewAll` er seedet i prod,
  og treet bygges **ikke** (flat struktur besluttet 28. juni 2026). Eventuelle
  `section_leaders` settes ved behov i `/medlemmer`.
- **Fase 4 — Hard fil-gate (FERDIG — deployet til prod 28. juni 2026, AKTIV):**
  `$fileId.ts` bruker nå felles `memberCanAccessFile`/`shareAllows`
  (`src/server/file-access.ts`); `getWork`/`assembleRepertoire` filtrerer
  part-filer server-side via `memberCanSeeFile`; `getShareView` bruker samme
  `shareAllows` som gaten; `createShare` snapshotter forelder→løv. UI: forelder-
  velger + tre-visning i `/innstillinger`, seksjonsleder-binding (`LeaderModal`) +
  scoped stemme-dropdown i `/medlemmer`. **Self-service fjernet:** `updateMemberParts`
  tillater ikke lenger `me.id === userId` — kun global `members.manage` eller
  seksjonsleder; `/medlemmer` viser stemme skrivebeskyttet for andre. 13 enhetstester
  for `file-access`. Deployet til prod 28. juni 2026 (versjon `0e016750`);
  migrasjonen `0001_nested_parts` er applisert `--remote`, og `archive.viewAll`
  er bekreftet seedet til `archivist` + `conductor` i prod. Treet ble besluttet
  ikke bygd (flat struktur), så gaten håndhever tilgang på stemme-nivå.

**Rollback:** drop `section_leaders`, ignorer `parent_id` (NULL = ingen effekt),
reverter `$fileId.ts` + serverfunksjons-filtre. Ingen destruktive steg.

## 3. Fil-for-fil (fase 1–4)

- `src/db/schema.ts` — ✅ `parts.parentId` + `sectionLeaders` (fase 0).
- `src/server/parts-tree.ts` — ✅ `expandPartIds` / `buildChildrenMap` (fase 0).
- `src/server/access.ts` — utvid `Me` med `effectivePartIds`/`leadsPartIds`
  (én ekstra `select {id, parentId} from parts` i `Promise.all`); `canManageMemberParts`.
- `src/server/settings.ts` — `members.manage.section` + `archive.viewAll` i
  `PERMISSION_CATALOG`; `createPart`/`updatePart` tar `parentId` + validerer
  invarianter (eksisterende forelder, maks 2 nivåer, ingen sykel, aldri `score`);
  ny `section_leaders`-CRUD gated på **global** `members.manage`.
- `src/server/members.ts` — `updateMemberParts` bruker `canManageMemberParts`;
  self-edit avviser forelder-rader for ikke-`members.manage`; scoped ledere får
  **delvis** overskriving (behold stemmer utenfor `leadsPartIds`); les mål-primær
  fra DB, ikke fra innkommende data.
- `src/routes/api/files/$fileId.ts` — **kind-først** if-kjede (score→scores.view,
  part→effectivePartIds∨archive.viewAll, other→archive.viewAll, audio→åpen);
  share-grenen ren `includes` mot snapshottet løvliste. Bevar
  `if(me)/else if(shareToken)`-rekkefølgen; aldri `archive.viewAll` i share-grenen.
- `src/server/works.ts` (`getWork`) / `src/server/projects.ts`
  (`assembleRepertoire`) — filtrer part-filer **server-side** på `effectivePartIds`
  når `!archive.viewAll`/`!works.manage`.
- `src/server/shares.ts` — `createShare` validerer partIds mot `parts` og
  snapshotter forelder→løv før lagring; felles `shareAllows(file, sharedLeafIds)`
  importeres av både `$fileId.ts` og `getShareView`.
- UI (`medlemmer`, `innstillinger`, `arkiv/$workId`, `Repertoire`) — tre-visning
  med innrykk, parent-felt, rollematrise-kolonner, leder-binding; alt kosmetikk
  som må byttes SAMTIDIG med gaten.

## 4. Sikkerhetsfunn → lukking (utvalg fra adversarisk review)

| Funn | Alvor | Lukking |
|---|---|---|
| Reparenting utvider eksisterende vikarlenke stille (scope-creep) | medium | Snapshot-til-løv i `createShare`; gate = ren `includes` |
| Desync gate ↔ `getShareView` | medium | Felles `shareAllows()` importert av begge |
| Dirigent/arkivar uten stemme låses ute | **høy** | `archive.viewAll` seedet + **fase 3 fail-fast** før gate; `works.manage` gir implisitt part/other-innsyn |
| Custom privilegert rolle uten `archive.viewAll` | medium | Synlig/forklart i rollematrise; works.manage degraderer trygt |
| Sykel i `parent_id` henger `currentUser()` → total utestenging | medium | Visited-set + `MAX_PART_DEPTH`; `createPart/updatePart` avviser sykel |
| Metadata-lekk i `getWork`/`assembleRepertoire` | medium | Server-side filtrering, ikke bare UI |
| Seksjonsleder binder seg selv i `section_leaders` (eskalering) | **kritisk** | `section_leaders`-skriving gated på **global** `members.manage`, aldri `.section` |
| Leder kaprer medlem via ny-primær | **høy** | Mål-primær leses fra NÅVÆRENDE `user_parts` |
| Leder sletter stemmer utenfor seksjon (full overskriving) | medium | Delvis overskriving innenfor `leadsPartIds` |
| `other`/uplassert som åpen restkategori | medium | `other` krever `archive.viewAll` i gaten |
| `'score'`-rad trekkes inn i tre | høy | Ekskludert i `buildChildrenMap` + kan ikke settes forelder/barn |
| IDOR/eksistens-orakel (403 vs 404) | lav | Harmonisert respons + ingen metadata-lekk |

## 5. Kanttilfeller (etter fase 4)

| Aktør | score | part (egen) | part (andres) | audio | other |
|---|---|---|---|---|---|
| Medlem med stemme | Ja (scores.view) | Ja | **Nei** | Ja | **Nei** |
| Medlem uten stemme | Ja (scores.view) | — | Nei | Ja | Nei |
| Forelder-tildelt (`percussion`) | Ja | Ja for 1/2/3 | Nei | Ja | Nei |
| Seksjonsleder | Ja* | Ja egne | Nei | Ja | Nei |
| Medlem med **lånt** stemme (#16) | Ja (scores.view) | Ja egne + den lånte | **Nei** | Ja | **Nei** |
| Dirigent/Arkivar (`archive.viewAll`) | Ja | Ja | **Ja** | Ja | **Ja** |
| Arkivforvalter (`works.manage`) | Ja | Ja | Ja | Ja | Ja |
| Admin (`*`) | Ja | Ja | Ja | Ja | Ja |
| Vikar (share, fått `percussion-1`) | **Nei** | Ja for 1 | Nei | **Ja** | **Nei** |
| Uinnlogget uten token | 401 | 401 | 401 | 401 | 401 |

## 5b. Styredokumenter (`board.manage`)

Styreområdet (`/styre`) har sine egne filer, og de går **ikke** gjennom gaten
over. Grunnregelen står ved lag, men den gjelder notefiler: `$fileId.ts`
håndhever stemmer, partitur og vikarlenker — begreper som ikke finnes for et
møtereferat. Å presse styrepapirer inn i den samme if-kjeden ville gjort den
vanskeligere å lese, uten å gjøre noen ting tryggere.

- Bytene ligger i **samme R2-bøtte** (`FILES`), under nøkkelprefikset `board/`.
- Den ENESTE veien inn til dem er `src/routes/api/board-files/$documentId.ts`:
  uinnlogget ⇒ 401, innlogget uten `board.manage` ⇒ 403. Ingen delingstokens,
  ingen offentlige URL-er, ingen `archive.viewAll`-bypass.
- Opplasting skjer i `src/routes/api/board-files/upload.ts` (samme gate, 25 MB).
  R2-nøkkelen bygges av en fersk id, aldri av filnavnet, så ingen kan skrive
  utenfor prefikset eller over en notefil. `deleteBoardObject` nekter å slette
  nøkler utenfor `board/`.
- Alt som ikke er trygt å vise inline (PDF, bilder, ren tekst) strømmes som
  `application/octet-stream` med `attachment` + `nosniff`.
- Metadata og all annen styredata gates i `src/server/board.ts` med
  `requirePermission('board.manage')` — også **lesing**. `beforeLoad` i
  `src/routes/styre/route.tsx` er kosmetikk, som ellers.
- Det gjelder **hele** området: styreprosjekter, oppgaver, kommentarer,
  møtereferater og chatten har ingen egen tilgangsmodell og ingen finere
  oppdeling. Har du `board.manage`, ser du alt styret har; har du det ikke,
  finnes ikke området for deg. Chatten har i tillegg en enkel skranke på
  kanalnøkkelen (`assertChannelExists`), slik at ingen kan skrive i en
  oppdiktet kanal andre ikke ser. Delegerings-e-posten
  (`src/server/board-notify.ts`) sender aldri annet enn oppgavetittel, frist,
  prosjektnavn og en lenke — mottakeren har uansett `board.manage` for å kunne
  åpne den.

## 5b2. Flere roller per medlem (#48, 2. september 2026)

Rollen er ikke lenger et felt på medlemmet, men et **sett**. Reglene:

- **`member_roles` er sannheten.** `member_profiles.role_id` og
  `invitations.role_id` er DEPRECATED og skal aldri leses som rollen. De står
  igjen fordi de er NOT NULL og bare kunne fjernes med en tabell-rebuild, som i
  D1 cascader til barnetabellene inne i transaksjonen.
- **Tilgang = unionen.** `unionRolePermissions` i `src/lib/roles.ts` legger
  sammen rettighetene fra alle rollene. Roller er rent additive — **ingen rolle
  kan trekke fra**. Legger man til en rolle, kan et medlem aldri miste noe; det
  er egenskapen som gjør «musiker som også sitter i styret» trygg, og den er
  låst av en test.
- **Fallbacken er en del av gaten, ikke en snarvei.**
  `effectiveRoleIds(linked, legacy)` bruker den deprecated kolonnen KUN når
  koblingsradene mangler. Det dekker kontoer opprettet i vinduet mellom
  migrasjon og deploy (workflowen migrerer før den deployer). Fjernes
  fallbacken, logger de inn uten en eneste rettighet.
- **Vurderer du en ANNEN enn den innloggede, bruk `memberPermissionsByUser()`**
  i `src/server/access.ts`. Det gamle mønsteret — et sett av «roller med
  rettigheten», sjekket mot medlemmets ene `role_id` — svarer feil for alle med
  mer enn én rolle. Det er en stille feil: den *nekter* tilgang der den skulle
  gitt (varsling, omtaler, ansvarlig-lista), men den kunne like gjerne gått
  andre veien i en fremtidig bruk.
- **Skriving er fortsatt `members.manage` alene**, og ingen kan endre sine egne
  roller (samme vakt som før). Endringen sletter medlemmets sesjoner, siden
  rettighetene bygges ved innlogging og caches i fem minutter.
- **Minst én rolle.** Null roller ville gitt et medlem uten rettigheter og en
  usann NOT NULL-kolonne. Skal noen fratas alt, deaktiveres medlemmet.

## 5c. Gruppelederområdet (`/gruppeledere`, #81, 2. september 2026)

Gruppelederne fikk sitt eget område. Det er det første som **ikke** gates på en
rettighet alene:

- **Guarden er leiarbindingen.** `requireGroupLeader()` i
  `src/server/gruppeledere.ts` krever minst én aktiv rad i `section_leaders` —
  `me.leadsPartIds.length > 0`. (Justert 2. september 2026: kravet var
  opprinnelig rettighet OG binding, men med én rolle per medlem hadde de
  faktiske lederne rollene Styremedlem og Musiker og kunne aldri fått
  rettigheten. Flere roller per medlem (#48) endrer ikke dette: en rolle som
  het «Gruppeleder» ville ikke åpnet området, og navnet ville løyet — derfor
  finnes ingen slik systemrolle. Bindingen settes uansett kun via «Seksjonsleder»-modalen i
  `/medlemmer`, gated på global `members.manage`, så den er en eksplisitt,
  admin-styrt tilgang alene. `members.manage.section` styrer fortsatt
  stemme-tildeling i eget omfang — en annen ting enn å se området.) Regelen
  er den rene `isGroupLeader` i `src/lib/gruppeledere.ts`, delt av guarden,
  `beforeLoad`, toppmenyen i `Shell.tsx` og `areasFor` på hub-en, slik at de
  fire ikke kan komme i utakt.
- **En admin uten leiarbinding får ikke tilgang.** Det er ikke en forglemmelse:
  `*` betyr «kan alt», og området handler om hva du *gjør*. Vil en admin inn,
  binder hen seg selv i `/medlemmer` — en handling som logges
  (`member.section_leadership_changed`).
- **Tilgangen faller bort umiddelbart.** `leadsPartIds` beregnes i
  `currentUser()` ved hvert kall, aldri fra en cache eller et token, så en
  fjernet binding stenger området ved neste forespørsel.
  `setSectionLeaderParts` sletter dessuten brukerens sesjoner.
- **Egne tabeller, aldri styredata.** `leader_channels`, `leader_messages` og
  `leader_channel_reads` speiler styrets chat-modell, men deler ingen rad med
  den. Ingen spørring i `src/server/gruppeledere.ts` rører en `board_`-tabell,
  og ingen serverfunksjon der aksepterer en `project:`-kanalnøkkel. Alternativet
  — én tabell med en `area`-kolonne — ville gjort én glemt `WHERE` til en
  lekkasje av styrets samtaler.
- **Delt komponent, delte data er noe annet.** `src/components/ChatPanel.tsx` og
  den rene logikken i `src/lib/board.ts` brukes av begge områdene. De kjenner
  ingen tabell: serverfunksjonene sendes inn som props, og hver av dem gater seg
  selv. Ingen filer, ingen R2, ingen e-post i området — det er ren tekst.
- **Historikken består.** `leader_messages.author_id` er `ON DELETE SET NULL`
  mot `user`, ikke mot `section_leaders`: mister noen leiarbindingen, står
  meldingene igjen med navnet på den som skrev dem.

## 5d. Oppmøte og fravær (`attendance.manage`, #82 + #24, 2. september 2026)

Kalenderen fikk en detaljrute per forekomst (`/kalender/$eventId`) med
øvingsplan og oppmøte. Øvingsplanen er ufarlig — alle innloggede leser den, og
`calendar.manage` skriver den. Oppmøtet er ikke: hvem som ikke kommer på øvelse
er en personopplysning, og kommentarfeltet er det stedet en fraværsgrunn kunne
snike seg inn. Reglene:

- **Innsynet er en trapp, håndhevet i `getEventDetail`:**

  | Aktør | Tallene | Egen status og kommentar | Andres navn og status | Andres kommentarer |
  |---|---|---|---|---|
  | Medlem | Ja | Ja | **Nei** | **Nei** |
  | Gruppeleder (aktiv `section_leaders`-binding) | Ja | Ja | Ja, **kun egne seksjoner** | Ja, kun egne seksjoner |
  | `attendance.manage` | Ja | Ja | Ja | Ja |
  | Admin (`*`) | Ja | Ja | Ja | Ja |
  | Uinnlogget | **Redirect til /login** | — | — | — |

  Regelen er den rene `attendanceScope`/`canSeeMemberAttendance` i
  `src/lib/attendance.ts`, og serveren returnerer `groups: null` når leseren
  bare skal se tall — navnene forlater aldri serveren. Et rått kall gir
  nøyaktig det samme som skjermen viser. **Tallene er bevisst åpne:** «18
  kommer» handler om øvelsen kan gjennomføres, ikke om hvem som er borte.
- **Skriving er tre veier til SAMME rad.** Medlemmet svarer for seg selv
  (`setMyAttendance`, som ikke har en `userId`-parameter i det hele tatt —
  ingen kan svare på andres vegne), `attendance.manage` registrerer for hvem
  som helst, og en gruppeleder for sine egne seksjoner
  (`setMemberAttendance` → `canSetAttendanceFor`). Målets stemmer leses
  **ferskt fra databasen**, aldri fra kallet, av samme grunn som
  `canManageMemberParts` gjør det. Siste skriving vinner; `source`
  (`self`/`admin`) og `registered_by` settes av serveren og sier hvem som
  registrerte.
- **Bare aktive medlemmer.** `requireMe()` avviser deaktiverte, og
  `setMemberAttendance` slår opp målets profil og svarer likt på «finnes ikke»
  og «er deaktivert».
- **Ingen fraværsgrunn.** Feltet er en kort kommentar (200 tegn, trimmet), og
  den følger navnelisten i innsynstrappen over. Skal noe sensitivt sies, sies
  det utenfor systemet.
- **Nøkkelen kan ikke brukes som et fritt tekstfelt.** `occurrenceKey` valideres
  med `isOccurrenceKey` i hver `validator(zod)`, og `event_meta` kan bare
  opprettes for en forekomst som FAKTISK finnes i feeden — snapshotet
  (`summary`, `start`) tas derfra, aldri fra klienten.
- **Foreldreløse rader lekker ikke.** Er hendelsen borte fra feeden, ser en
  vanlig leser kun beskjeden om at den ikke finnes lenger; øvingsplan og
  oppmøte vises bare for dem med skriverett eller en lederbinding. Selve
  teksten på siden skiller heller ikke mellom «det finnes data du ikke får se»
  og «det finnes ingenting».
- **`calendar.manage` er ikke `projects.manage`.** Verkssøket på detaljruta er
  en egen serverfunksjon (`searchWorksForEvent`) gated på `calendar.manage`,
  slik at den som setter opp en øvelse ikke må kunne publisere prosjekter. Og
  prosjektkoblingen godtar kun **publiserte** prosjekter — et utkast er ikke
  synlig for medlemmene, og navnet skulle ikke lekket via en kobling.

## 5e. Tidsplan og praktisk info (#9 + #10 + #29, 2. september 2026)

Prosjektet fikk en tidsplan, og øvingen fikk praktisk info. Ingen av delene
trengte en ny rettighet — men to ting måtte avgjøres eksplisitt.

- **To rettigheter, to eiere.** Tidsplanen (`project_times`) skrives med
  `projects.manage`, fordi det er prosjektansvarlig som bestemmer når
  lastebilen kjører. Den praktiske infoen på en øving og
  prosjektkoblingene (`event_meta`, `event_projects`) skrives med
  `calendar.manage`, fordi det er den som setter opp øvelsen. Lesing er åpen
  for alle som allerede ser prosjektet eller hendelsen. Prosjektkoblingen
  godtar fortsatt kun **publiserte** prosjekter, og `getEventDetail` leser
  bare ut publiserte: et prosjekt som avpubliseres etter at koblingen ble
  laget, skal ikke bli stående synlig med navn for hele korpset.
- **Telefonnummeret er kopiert, ikke speilet.** #9 ber om kontaktinfo på den
  som kjører lastebilen, «kan hentes fra person i medlemslista». Men
  `listMembers` gir bare `phone` til `members.manage` — telefonnummer er
  administrasjonsdata, ikke katalogdata. Løsningen bryter ikke den regelen:
  - `project_times.contact_phone` er et EGET felt som stab skriver inn, ikke en
    join mot `member_profiles`. Ingen spørring i prosjektområdet leser
    medlemmets telefonnummer ut til en side hele korpset ser.
  - `listProjectMembers` (gated på `projects.manage`) tar med `phone` **kun**
    når den som spør også har `members.manage` — nøyaktig samme regel som
    medlemslista. Har hen den ikke, får hen navn og stemme, og skriver et
    nummer selv.
  - Nummeret prefylles ÉN gang i skjemaet, som et forslag. Den som lagrer ser
    og godkjenner hva som blir stående, og et medlem som senere endrer
    profilen sin får ikke det nye nummeret publisert på en gammel konsert uten
    at noen har bestemt det. Alternativet — å vise medlemmets profilnummer
    direkte — ville gjort tidsplanen til en omvei rundt `members.manage`.
  - **Navnet** på ansvarlig slås derimot alltid opp ferskt mot `user`, som
    omtaler i #83: et navn er allerede synlig for alle i medlemslista, og et
    gammelt navn i en tidsplan er en feil, ikke personvern.
- **Ansvarlig må være et AKTIVT medlem.** `assertResponsibleMember` slår opp
  `member_profiles` før skriving, så et rått kall ikke kan feste en hvilken som
  helst bruker-id — eller en deaktivert konto — på en side hele korpset leser.
- **`projectId` står i WHERE, ikke bare i validatoren.** `updateProjectTime` og
  `removeProjectTime` krever at raden hører til prosjektet som sendes inn;
  id-en alene ville latt et kall redigere et tidspunkt i et annet prosjekt.
- **Kartlenka er en allowlist.** `parseMapUrl` stripper kontrolltegn FØR
  skjemasjekken og godtar kun `http(s):` — samme disiplin som `safeHref` i
  markdown-rendringen (§8). En `javascript:`-lenke skal ikke kunne lagres av
  stab og senere klikkes av et medlem.

## 5e. Delte stemmer mellom medlemmer (`part_shares`, #16, 5. september 2026)

Saken spurte om «noe lavt i horn som ønskes flyttet til bariton». Den inneholdt
to ulike features med hver sin trusselmodell, og valget er nå tatt: dette er
**medlem låner til medlem**. Stab-til-vikar er allerede dekket av vikarlenkene
(`share_links`, `/v/$token`), og de er **urørt** av dette arbeidet — de er
fortsatt det tidsbegrensede verktøyet for folk uten konto.

- **En deling er en trippel:** FRA et medlem, AV én av medlemmets EGNE tildelte
  stemmer, TIL ett navngitt, aktivt medlem. `part_shares` har sammensatt
  primærnøkkel `(from_user_id, to_user_id, part_id)` — en deling *er* trippelen,
  så den samme stemmen kan ikke deles to ganger til samme medlem. Alle tre
  fremmednøklene er `ON DELETE CASCADE`.
- **Delingen er ALLTID avledet av delerens egen tilgang.** Raden er en intensjon;
  delerens `user_parts` er fasiten. `currentUser()` join-er delingene mot
  `user_parts` og `member_profiles.is_active`, så en deling slutter å virke i det
  øyeblikket deleren mister stemmen eller blir deaktivert — uten at noen rad må
  ryddes, og uten et opprydningssteg som kunne slettet feil. Dette er join-en,
  ikke en etterkontroll: glemmer man den, faller regelen bort i stillhet.
- **Håndhevelsen ligger ETT sted.** Den delte stemmen kommer inn som
  `AccessCtx.sharedParts` og vurderes av `memberCanAccessPart` i
  `src/server/file-access.ts`, side om side med egne stemmer og lederomfang.
  Fil-gaten (`api/files/$fileId.ts`), `assembleRepertoire` og `memberCanSeeFile`
  arver den derfor gratis — det finnes ingen parallell sjekk i UI-laget.
  Prosjektkravet (`inAccessibleProject`) gjelder som for alle andre stemmer.
- **En deling gir ALDRI mer enn stemme-lesing.** Den rører kun `part`-grenen i
  `memberCanAccessFile`. Partitur følger fortsatt `scores.view`, uplassert
  (`other`) fortsatt `archive.viewAll`, og ingen rettighet, rolle eller
  forvaltningstilgang følger med. Har deleren fullt arkivinnsyn, arves ikke det:
  `canViewAll` leses av MOTTAKERENS kontekst, aldri av delerens.
- **Ingen kjede.** Man kan bare dele stemmer i sin egen `user_parts`. En mottatt
  deling står aldri der, så Anne → Bjørn → Carl kan ikke oppstå. En seksjonsleder
  kan heller ikke dele stemmene hen *leder* — bare dem hen selv er tildelt.
- **Ingen ny rettighet.** Å dele sin egen stemme er en medlemshandling, som å
  legge ut noe på veggen; gaten er eierskapet. En rettighet ville dessuten vært
  feil verktøy — den ville gitt noen retten til å dele *andres* stemmer.
- **Begge parter kan fjerne delingen når som helst.** `removePartShare` krever at
  den innloggede er én av de to, og både `from_user_id` og `to_user_id` står i
  `WHERE` — id-ene alene ville latt et rått kall rive ned en deling mellom to
  andre. Mottakeren skal kunne takke nei til en stemme hen ikke vil ha liggende.
- **Ingen utløpsdato.** Saken ba om tidsbegrensning, men en dato som tømmer
  notestativet midt i en prosjektperiode er verre enn ingen: delingen faller
  uansett bort av seg selv når deleren mister stemmen, og begge kan fjerne den
  med ett klikk. Trenger man et tidsbegrenset lån til noen uten konto, er det en
  vikarlenke. Taket `MAX_PART_SHARES` = 10 hindrer at «del stemmen din» blir
  «del stemmen din med hele korpset». Taket er en **veiledende skranke, ikke en
  sikkerhetsgrense**: det telles og settes inn uten transaksjon, så mange
  samtidige kall kan i teorien passere det. Konsekvensen er noen delinger for
  mye av ens EGEN stemme — ikke tilgang til noe nytt — og en DB-side CHECK var
  ikke verdt en ikke-additiv migrasjon.
- **Delingen logges** som `member.part_shared` / `member.part_share_removed` i
  `audit_log`, med hvem som fjernet den (`sharer`/`recipient`).
- **Mottakeren ser den i appen, ikke på e-post.** Stemmen dukker opp på «Mine
  noter» og på prosjektsiden i en egen seksjon — «Delt med deg av Navn» — aldri
  blandet inn blant egne stemmer. Har du senere selv fått stemmen tildelt, er
  nota din egen og merkes ikke lenger som lånt (`sharedFileFrom`).
- **Slagverksoppsettet følger IKKE med et lån.** Det ble prøvd — en lånt
  slagverksstemme uten oppsettet er en halv leveranse — men `showPercussion` er
  ikke avgrenset til den lånte stemmen: den åpner `percussion_notes` for HELE
  konserten og `percussion_setup` på ALLE verk, også dem låntakeren ikke har en
  eneste fil på. Da gir delingen mer enn stemme-lesing, og det er den ene tingen
  den aldri skal gjøre. Trenger en låntaker oppsettet, er riktig svar en
  stemmetildeling, ikke et lån.
- **En deling dør med stemmen den gjelder.** `updateMemberParts` sletter
  `part_shares`-radene for stemmer medlemmet ikke lenger har, i samme batch som
  `user_parts` skrives om. Join-en i `currentUser()` ville gjort dem uvirksomme
  uansett, men en rad som ble liggende ville VÅKNET til live igjen dersom
  stemmen senere ble tildelt på nytt — en tilgang ingen av partene hadde bedt om.
  Delinger av stemmer medlemmet fortsatt har, står urørt.
- **Vikarløypa er bevisst urørt.** `shareAllows` tar ikke `AccessCtx` i det hele
  tatt, og en test låser at en deling mellom medlemmer ikke kan lekke inn i
  token-grenen.

Reglene er testet i `src/server/file-access.test.ts` (tilgangen) og
`src/lib/part-shares.test.ts` (hva som er en gyldig deling).

## 6. Produktvalg før fase 4 (avgjort — historikk)

Alle valg ble avgjort før deploy, i tråd med de anbefalte alternativene (se
fase 4-beskrivelsen og kanttilfelle-tabellen). For punkt 6 ble det i tillegg
besluttet 28. juni 2026 å ikke bygge treet i det hele tatt (flat struktur).

1. **Omfang:** gate kun fil-nedlasting (medlem ser fortsatt verksliste +
   metadata) — *anbefalt* — eller skjul også verk hen ikke har stemme i?
2. **Medlem uten stemme:** ingen `part`-filer (*anbefalt*) vs. behold tilgang.
3. **`audio` + `other`:** audio åpen + `other` bak `archive.viewAll` (*anbefalt*),
   eller begge åpne / begge gated?
4. **`scores.view` på member:** la stå (*anbefalt* — egen rolle-policy) vs. fjern nå.
5. **Vikar + forelder-stemme:** snapshot-til-løv ved opprettelse (*anbefalt*) vs.
   levende ekspansjon vs. skjul forelder fra delemodal.
6. **Utrulling:** bygg tre + `archive.viewAll` + varsle FØRST, hard gate som
   separat senere deploy (*anbefalt*); vurder feature-flag på gaten.

## 7. Bilder på veggen (#28, 31. august 2026)

Beskjeder/veggen har egne filer, og de følger **ikke** notearkivets regler.
Grunnregelen over gjelder likevel uendret: det finnes én server-gate, og den er
den eneste reelle skranken.

- **Egen rute, aldri `$fileId`.** Veggbilder ligger i R2 under
  `posts/<fersk id>.<ext>` og strømmes kun fra
  `src/routes/api/post-images/$imageId.ts`. De er ikke `work_files`, har ingen
  stemme, og skal aldri kunne nås gjennom `src/routes/api/files/$fileId.ts` —
  gaten der handler om stemmetilgang og ville vært feil spørsmål å stille.
- **Gaten:** innlogging (`currentUser()`) **pluss** samme synlighetsregel som
  innlegget selv (`canReadPost` — utkast og `audience: 'board'`), med ett
  tillegg: forfatteren ser sine egne bilder mens innlegget fortsatt er et
  utkast. Logikken ligger i `src/server/post-images.ts` (`postImageAccess`), i
  en egen modul fordi levende eksporter i `posts.ts` ville dratt
  `cloudflare:workers` inn i klientbygget.
- **Ingen tokens.** Veggen er intern; det finnes ingen vikar- eller delelenke
  til et veggbilde. Uinnlogget gir 401.
- **«Finnes ikke» og «ikke for deg» svarer likt** (404), slik at en id ikke kan
  brukes til å bekrefte at et styre-innlegg finnes.
- **Opplasting** (`api/post-images/upload.ts`, PUT) krever innlogging og at du
  eier innlegget — eller har `posts.publish` (moderasjon). Kun
  `image/jpeg|png|webp|gif|heic`, maks 10 MB per bilde og 10 bilder per
  innlegg, håndhevet på de faktiske bytene, ikke på `Content-Length` alene.
  R2-nøkkelen bygges alltid av en fersk id, aldri av det brukerstyrte filnavnet.
- **Svarhoder:** `nosniff`, `private, max-age=300`, `X-Robots-Tag: noindex`,
  `Referrer-Policy: no-referrer`. Bildene er aldri offentlige.
- **Sletting:** R2-objektet slettes før databaseraden (`deletePost`,
  `deletePostImage`) — raden er den eneste veien tilbake til nøkkelen.

| Aktør | Bilde på åpent innlegg | Bilde på `audience: 'board'` | Bilde på andres utkast | Opplasting til eget innlegg | Opplasting til andres |
|---|---|---|---|---|---|
| Medlem | Ja | **404** | **404** | Ja | **403** |
| `posts.publish` | Ja | Ja | Ja | Ja | Ja (moderasjon) |
| Uinnlogget | **401** | 401 | 401 | 401 | 401 |

## 8. Markdown på veggen (#79, 1. september 2026)

Et innlegg kan skrives som markdown (`posts.format`). Formatet er **ikke** en
rettighet — alle som kan skrive på veggen kan velge det. Det tilgangsstyringen
angår, er at brukerstyrt tekst nå blir markering, og der gjelder én regel:

- **Ingen rå HTML, i noen form.** `src/lib/markdown.ts` bruker bare lexeren i
  `marked` og skriver HTML-en selv, av en fast allowlist (`p`, `h2`–`h6`,
  `strong`, `em`, `del`, `ul`/`ol`/`li`, `blockquote`, `pre`/`code`, `a`, `hr`,
  `br`, tabell). Det finnes ingen passthrough å sanitere i etterkant. HTML i
  teksten (`<script>`, `<img onerror=…>`, `<iframe>`) escapes og vises som den
  teksten den er — den blir aldri markering.
- **Lenker:** kun `http:`, `https:`, `mailto:` og relative lenker/fragmenter.
  Alt annet (`javascript:`, `data:`, `vbscript:`, …) mister lenken og blir
  stående som tekst. Kontrolltegn strippes **før** skjemasjekken, slik at
  `java<TAB>script:` ikke slipper forbi.
- **Eksterne bilder rendres aldri som `<img>`.** De blir en vanlig lenke.
  Begrunnelsen er personvern og §7: et innbakt bilde ville lastet av seg selv og
  fortalt en tredjepart hvilke medlemmer som leser hvilket innlegg, og når.
  Bilder som hører til innlegget går gjennom den gatede opplastingen i §7.
- Rendreren er ren og deles av server, klient og e-post, så forhåndsvisningen i
  skjemaet kan aldri vise noe annet enn det som faktisk publiseres.
- Angrepsforsøkene ligger i `src/lib/markdown.test.ts`. Faller en av dem, er det
  et hull — ikke en kosmetisk endring.

## 5f. Riggeliste og sceneoppsett (#12 + #11, 5. september 2026)

Begge er nye skriveflater på et prosjekt (og riggelista dessuten på én
kalenderforekomst). Ingen av dem fikk en ny rettighet, og avkryssingen på
riggelista er den mest liberale skrivetilgangen i plattformen. Begge deler er
bevisste valg, ikke forglemmelser.

- **Redigering: `projects.manage` ∨ `assets.manage`.** Reglene er
  `canManageRigList` og `canManageStagePlot` (`src/lib/rigg.ts` /
  `src/lib/scene.ts`), begge over `permissionsInclude`, så `*` behandles likt
  som overalt ellers. Grunnen til at det er en ELLER og ikke en ny rettighet:
  lista og tegningen har to naturlige eiere. Prosjektansvarlig vet hva konserten
  trenger; materialforvalteren vet hva korpset eier. En `rig.manage` ville
  betydd at begge måtte be om en rettighet til, og en sjekkliste ingen får
  redigert er en sjekkliste ingen bruker.
- **Avkryssing: `requireMe()` alene — og det er poenget i #12.** «Tatt med fra
  Tertnes» og «kommet tilbake» kan settes av ALLE aktive medlemmer. Riggegruppa
  er tre personer på et gulv med en kasse i hendene, ofte uten en eneste
  rettighet i rollematrisen. En sjekkliste bare stab kan hake av, er et regneark
  med ekstra steg. `currentUser()` returnerer allerede `null` for deaktiverte
  medlemmer, så `requireMe()` ER regelen — det finnes ikke noe strengere krav å
  legge på uten å ødelegge funksjonen.
  - **Sporbarheten er ivaretatt i stedet for tilgangen.** Hver avkryssing lagrer
    `taken_by`/`taken_at` og `returned_by`/`returned_at`. Man vet altså alltid
    hvem som sa hva, selv om hvem som helst kan si det. Klienten sender KUN
    hvilket kryss og av/på; tidsstempel og person settes server-side, og
    tilstanden leses fra databasen før `applyRigCheck` kjøres. Et rått kall kan
    ikke datere en avkryssing eller skrive den på en annen person.
- **Synlighet arves fra prosjektet, ikke fra lista.** `loadVisibleProject` i
  `src/server/project-access.ts` er nå felles for `getProject`, sceneoppsettet og
  riggelista: er prosjektet upublisert (eller gammelt og du mangler arkivinnsyn),
  får du verken tegningen eller riggelista. Uten den delingen ville riggelista
  vært en bakvei til navnet på et upublisert prosjekt — samme hull som
  utstyrskoblingen måtte tette i #13.
- **Avkryssing krever samme synlighet som lesing.** `setRigCheck` slår opp
  linjas eierskap og kjører den gjennom `resolveScope` før den skriver: en linje
  på et prosjekt du ikke får se, kan du heller ikke hake av.
- **Velgerlister er data, ikke pynt.** `memberOptions` (både i `getRigList`,
  `getProject` og `getEventDetail`) sendes kun til den som faktisk kan redigere
  lista. Det samme gjelder utstyrssøket `searchAssetsForRig`, som er gated på
  skriveretten til riggelista.
- **Gjenstandens navn tas fra registeret, aldri fra klienten.** Velger man en
  gjenstand, slår `addRigItem` opp `assets.name` og lagrer DET som snapshot.
  Ellers kunne et rått kall lagt inn linja «Sølvfat» med en `asset_id` som peker
  på et notestativ, og lista ville løyet om hva som skulle med.
- **Eierskapet til en linje kan ikke endres.** `updateRigItem` skriver kun navn
  og ansvarlig. En linje som kunne flyttes mellom to lister ville tatt
  avkryssingene sine med seg, og «tatt med» ville plutselig gjeldt en annen
  konsert.
