# Hver feature som egen app i plattformen

Designdokument for sak #39. Utgangspunkt: notearkivet var én app med én oppgave,
men repertoar, medlemsforvaltning, filtilgangslogg og en håndfull ventende
funksjoner (#32, #28, #24, #26, #13) er ikke varianter av «finn nota di» — de har
egne brukere og egne arbeidsflyter. Alternativet til å gi hver av dem et eget rom
er å presse alt inn i samme sideoppsett, eller å samle restene i én stor
administrasjonsside. Begge ender med et grensesnitt ingen eier.

> **Grunnregel:** hvert større område er en liten app med *eget* inngangspunkt,
> *én* primærbruker, *én* primærhandling og *egen* oversikt — men deler
> navigasjon, innlogging, roller, designsystem (`src/styles.css`) og datamodell
> (`src/db/schema.ts`) med resten av plattformen. Deler man ikke fundamentet, er
> det ikke én plattform; deler man alt, er det ikke flere apper.

> **Status per 29. juli 2026:** dette dokumentet er normativt for nye features.
> Det er ikke gjort UI-endringer sammen med det. Navigasjonsspørsmålet i §6 er
> **åpent** og venter på et produktvalg — dokumentet beskriver alternativene, det
> avgjør dem ikke.
>
> **Oppdatert 30. august 2026:** navigasjonsspørsmålet er avgjort — alternativ
> **(a)** ble valgt da notearkivet ble utvidet til internsiden «Tertnes Brass
> Intern». Se §6 og §7.

## 1. Prinsippet

- Et **app-område** er en funksjon en bruker kan komme til plattformen *for*. Har
  du ikke en bruker som logger inn nettopp for å gjøre dette, er det ikke et
  område — det er en side i et eksisterende område.
- Hvert område har et **navn** brukeren kjenner igjen: samme ord i toppmenyen, i
  URL-en, i overskriften og i saken som ba om det.
- Hvert område har **én primærbruker**. Er svaret «alle», er området enten for
  stort eller egentlig to områder.
- Hvert område har **én primærhandling** som skal kunne gjøres fra første skjerm
  uten å lete. På `/noter/arkiv` er det «legg inn et verk», på `/noter` er det «åpne
  min stemme».
- Hvert område har **egen oversikt** — sin egen liste, sin egen tomtilstand, sin
  egen tone. Områder skal ikke låne hverandres sideoppsett bare fordi det finnes.
- Områdene deler **plattformlaget**: `Shell` (`src/components/Shell.tsx`),
  `requireMe()`/`requirePermission()` (`src/server/access.ts`), rettighetene i
  `PERMISSION_CATALOG` (`src/server/settings.ts`), komponentene i
  `src/components/ui.tsx` og tokens i `src/styles.css`. Ingen nye ad-hoc-farger,
  ingen egen auth, ingen egen knappestil.
- Et område **kan** droppe plattform-kromet når brukeren ikke er en
  plattformbruker. `/v/$token` gjør nettopp det, og det er ikke et unntak fra
  prinsippet — det er prinsippet tatt på ordet.
- Plattformen skal **ikke** ha én stor administrasjonsside. Se §4.

## 2. App-områdene i dag

Slik de faktisk finnes i koden. «Gate» er rettigheten som avgjør *skriving* der
lesing er åpnere; håndhevelsen ligger alltid i `src/server/*.ts`, aldri bare i
`beforeLoad`.

| Område | Rute | Primærbruker | Primærhandling | Gate |
|---|---|---|---|---|
| **Hjem** (hub-flaten) | `src/routes/index.tsx` (`getHub`) | Medlemmet | Se hva som skjer nå, og komme seg videre til riktig område | `requireMe()`; områdesnarveiene følger rettighetene (`areasFor` i `src/lib/hub.ts`) |
| **Beskjeder** (veggen) | `src/routes/beskjeder/` (`index`, `ny`, `$postId/`) | Medlemmet | Se hva som er nytt i korpset — og selv legge ut noe | Lesing og skriving: `requireMe()`. `posts.publish` gir «Fra styret», «Viktig», styre-målgruppen, e-post og moderasjon. Bilder: `/api/post-images/$imageId` bak samme regel |
| **Noter** / «Mine noter» | `src/routes/noter/index.tsx` (`getHome`) | Musikeren | Åpne egne stemmer + lytteeksempler til neste prosjekt | `requireMe()`; stemmefiltrering via `effectivePartIds` |
| **Prosjekter** | `src/routes/noter/prosjekter/index.tsx`, `$projectId.tsx`, `$projectId_.slagverk.tsx` | Dirigent / prosjektansvarlig | Klikke sammen et program i rekkefølge og publisere det | `projects.manage`; upublisert er usynlig ellers. Deling: `shares.manage`. Slagverksoppsettet per stykke redigeres inline med samme gate, og har en utskriftsvennlig samleside |
| **Arkiv** | `src/routes/noter/arkiv/index.tsx`, `$workId.tsx` | Arkivaren | Katalogisere et verk og laste opp PDF per stemme | Innsyn: `archive.viewAll` ∨ `works.manage`; skriving: `works.manage` |
| **Kalender** | `src/routes/kalender/index.tsx` (`getCalendar`), `kalender/$eventId.tsx` (`getEventDetail`) | Alle medlemmer | Se når neste øvelse og konsert er — og hva som skal øves på | `requireMe()` for lesing; feeden er en secret (`CALENDAR_ICS_URL`), aldri til klienten. Detaljruta hører til Kalender-området, ikke et nytt navnerom: øvingsplanen skrives med `calendar.manage`, oppmøtelista og registrert fravær med `attendance.manage` (gruppeleder ser og setter kun egen seksjon) |
| **Medlemmer** | `src/routes/medlemmer/index.tsx` | Admin (seksjonsleder i redusert form) | Invitere et medlem og sette rolle + stemme | Lesing: `requireMe()`; skriving: `members.manage` / `members.manage.section` |
| **Gruppeledere** | `src/routes/gruppeledere/{route,index}.tsx`, `gruppeledere/chat/index.tsx` | Gruppelederen | Åpne kanalen og koordinere med de andre gruppelederne | `members.manage.section` **pluss** minst én aktiv `section_leaders`-rad (`isGroupLeader` i `src/lib/gruppeledere.ts`) — også for **lesing**. En admin uten leiarbinding kommer ikke inn |
| **Styre** | `src/routes/styre/{index,$taskId}.tsx`, `styre/prosjekter/*`, `styre/moter/*`, `styre/chat/index.tsx`, `styre/dokumenter/index.tsx` | Styremedlemmet | Se åpne oppgaver og hake av / opprette en ny | `board.manage` — også for **lesing**; hele området er usynlig ellers. Dokumentbytene gates i `src/routes/api/board-files/$documentId.ts` |
| **Innstillinger** | `src/routes/innstillinger/index.tsx` | Admin | Forvalte besetning og rollematrisen | `settings.manage` |
| **Filtilganger** | `src/routes/innstillinger/nedlastinger.tsx` | Admin / arkivar | Svare på «hvem har hatt denne fila?» | `downloads.view` |
| **Vikarvisning** | `src/routes/v/$token.tsx` | Vikaren, uten konto | Åpne de stemmene hen har fått, nå | Token + `shareAllows()` mot snapshottet løvliste |

Fire observasjoner som er verdt å ta med videre:

- **Arkiv er prinsippet i praksis.** Området har eget inngangspunkt som er skjult
  i navigasjonen for et vanlig medlem (områdemenyen i `src/routes/noter/route.tsx`
  legger inn `/noter/arkiv` kun ved `canBrowseArchive`), og `beforeLoad` sender
  resten til `/noter`. Området finnes, men bare for dem det er laget for.
- **Filtilganger er prinsippet brutt i praksis.** Det er et eget område med egen
  primærbruker, men URL-en (`/innstillinger/nedlastinger`) parkerer det i et
  annet områdes navnerom — og siden 31. august 2026 har det heller ingen
  toppmeny-oppføring (§6), bare inngang fra `/innstillinger` og hub-ens
  «Områder». Det er ikke verdt en migrering i seg
  selv, men det er mønsteret å ikke gjenta: en funksjon havnet i «Innstillinger»
  fordi den føltes administrativ.
- **Veggen er unntaket som prøver §1 punkt 3.** «Én primærbruker» er medlemmet,
  men medlemmet er her både leser og skriver, og styret er en *rolle* i samme rom
  snarere enn et eget område. Det ble vurdert å skille «Beskjeder fra styret» og
  «Veggen» i to områder; det ville gitt to inngangspunkt for det samme sosiale
  rommet og tvunget medlemmene til å velge riktig sted å spørre om notestativet.
  I stedet er skillet gjort *inne* i området: «Fra styret»-innlegg har eget
  stempel, egen kortstil og eget filter.

- **`/` er plattformflaten, ikke et område.** Hub-en har ingen egen oversikt å
  eie og ingen egen gate: den viser *det neste* og *veien videre*, og lenker inn
  i områdene (§7 pkt 3). Den står i tabellen fordi den er en skjerm med eget
  datagrunnlag (`src/server/hub.ts`), ikke fordi den er en app etter §1.
  Noteområdet (Mine noter, Prosjekter, Arkiv) har layout-ruten
  `src/routes/noter/route.tsx` som felles områdemeny.
- **Vikarvisningen rendres bevisst utenfor `Shell`.** `src/routes/__root.tsx` har
  en `bare`-sjekk (`pathname.startsWith('/v/')`) som dropper toppmeny, brukermeny
  og temabryter. Vikaren har ingen konto, ingen rolle og ingen andre områder å
  navigere til — kromet ville vært løgn.

## 3. Sjekkliste for nye app-områder (obligatorisk)

Alle sju punktene skal besvares i saken eller PR-beskrivelsen **før** koden
skrives. «Vet ikke» er et gyldig svar, men da er punktet en avklaring, ikke en
detalj som kan falle ut underveis.

1. **Navn** — norsk substantiv, entall eller flertall som i dag. Samme ord i
   toppmenyen, URL-en og overskriften.
2. **Formål** — én setning: hvilket problem forsvinner når dette finnes?
3. **Primærbruker** — én rolle. Er svaret «alle», del opp området.
4. **Primærhandling** — den ene handlingen som skal kunne gjøres fra første
   skjerm uten å lete. Hvis den krever tre klikk, er oversikten feil.
5. **Plass i navigasjonen** — egen toppnivå-oppføring, undernavigasjon i et
   eksisterende område, eller kun krysslenke fra et annet område? Begrunn valget
   mot taket i §6.
6. **Rettighet som gater det** — en nøkkel i `PERMISSION_CATALOG`
   (`src/server/settings.ts`), ny eller eksisterende, håndhevet server-side via
   `requirePermission()` i `src/server/*.ts`. Filer skal aldri kunne nås utenom
   gaten i `src/routes/api/files/$fileId.ts` (se `docs/tilgangsstyring.md`).
7. **Eget rutenavnerom** — `src/routes/<navn>/` med `index.tsx` (+ detaljrute)
   hvis området har mer enn én skjerm eller vil vokse. Ellers én fil. Nye
   rutefiler krever `pnpm generate-routes` og commit av `src/routeTree.gen.ts`.

## 4. Krysskobling mellom apper

Områder skal være selvstendige, ikke isolerte. Koblingen skjer med **målrettede
lenker**, ikke med felles sider.

Slik det skal se ut — og delvis gjør i dag:

- **Finnes:** arkivblokken på «Mine noter» lenker til `/noter/arkiv/$workId` for
  det enkelte verket (`src/routes/noter/index.tsx`), og filtilgangsloggen lenker fra en rad til
  verket den gjelder (`nedlastinger.tsx`).
- **Finnes:** `nedlastinger.tsx` validerer `workId`, `projectId`, `userId` og
  `shareLinkId` i `validateSearch` — nettopp for at andre områder skal kunne
  lenke inn i en ferdig filtrert visning. Det er mønsteret å kopiere: gjør
  visningen lenkbar, ikke innebygd i den som vil bruke den.
- **Mangler:** fra et verk i prosjektrepertoaret til verkets side i arkivet.
  Brukeren står i «hva spiller vi» og har ingen vei til «hvilke filer finnes»
  uten å søke opp verket på nytt. Dette er den mest åpenbare krysslenken som
  burde eksistert, og et lite, selvstendig arbeid (gated på `canBrowseArchive`).
- **Kommer:** fra et opptak (#32) til verket det er et opptak *av*, og til
  prosjektet det ble spilt på.

Regler for slike lenker:

- Lenken går til en **konkret ressurs eller en ferdig filtrert visning**, aldri
  til et områdes forside med en beskjed om å søke opp igjen det brukeren nettopp
  sto i.
- Filtre som skal kunne lenkes til, må valideres i `validateSearch` på ruten —
  ellers er lenken ikke stabil.
- Vis aldri en krysslenke brukeren mangler rettighet til. Skjul den i UI-et, og
  la serveren avvise uansett; UI-et er kosmetikk.
- En krysslenke er **aldri** eneste vei inn i et område. Har området ikke eget
  inngangspunkt, er det ikke et område.

Slik det ikke skal se ut:

- Én `/admin`-side med faner for medlemmer, besetning, roller, logg, media,
  kunngjøringer og utstyr. Det er ikke integrasjon, det er en skuff.
- En ny funksjon lagt under `/innstillinger` fordi «det er administrasjon».
  Administrasjon er ikke en arbeidsflyt; det er en rolle.
- Et «kontrollpanel» som gjengir hvert områdes oversikt i miniatyr. Da har
  områdene mistet sin egen oversikt, og forsiden har fått en den ikke kan holde
  oppdatert.

## 5. Hvor de ventende funksjonene lander

Anbefalt plassering. Ingen av dem er bygget, og hver av dem skal gjennom §3 før
den bygges — også de som allerede har en anbefaling her.

| Sak | Anbefaling | Primærbruker → primærhandling | Begrunnelse |
|---|---|---|---|
| **#32 Mediearkiv** | Eget område, eget navnerom (`/media`) | Stab → registrere et opptak og knytte det til prosjekt/verk | Ikke en fane i Arkiv: andre filtyper, og et helt annet tilgangsbegrep (intern / styre / offentlig kandidat) enn notearkivets stemmebaserte gate. Krever egne rettigheter. |
| **#28 Kunngjøringer** → **bygget som «Beskjeder»/veggen** (31. august 2026) | Delt: lesing som blokk på Hjem, skriving i eget navnerom | Opprinnelig: styre/dirigent → publisere; medlem → se den. **Utvidet samme dag:** medlemmet → se hva som er nytt, og selv legge ut noe | Bygget slik anbefalingen sa — de tre siste ligger øverst på hub-en, resten i `/beskjeder` — men med ett bevisst brudd på premisset: skriving er ikke lenger reservert for styret. Skal veggen erstatte Facebook-gruppen, må den tåle et notestativ som er kommet bort, ikke bare vedtak. `posts.publish` gjelder derfor de fire tingene som gjør et innlegg til en *beskjed fra styret* («Fra styret», «Viktig», styre-målgruppen, e-post) pluss moderasjon. «Lest-status» ble bevisst ikke bygget: kommentarer og likes viser at noen har sett den, uten å overvåke medlemmene. |
| **#24 Oppmøte** → **bygget sammen med #82** (2. september 2026) | Inne i Kalender-området, på detaljruta for én forekomst | Medlem → svare kommer / kommer ikke / usikker | Bygget slik anbefalingen sa — RSVP uten aktivitet er meningsløst — men aktiviteten ble kalenderforekomsten (`/kalender/$eventId`), ikke prosjektet: øvelser er der fraværet faktisk føres, og de finnes bare i kalenderen. RSVP og administrert fravær deler ÉN rad (`event_attendance`), som #82 krevde, slik at det aldri finnes to statuser for samme medlem og hendelse. «Mine datoer» er dekket av kalenderen + eget svar; ingen egen skjerm. |
| **#26 Kalender/aktiviteter** | Eget område (`/aktiviteter`) | Alle medlemmer → se hva som skjer, og «Mine datoer» | Sterkeste kandidat til ny toppnivå-oppføring: primærbruker er *hele* korpset, ikke stab. Det er også den som først presser navigasjonen (§6). |
| **#13 Utstyr** | Eget område (`/utstyr`) | Materialforvalter → registrere en gjenstand med bilde, eier og lånestatus | Skal ikke under Innstillinger selv om det føles administrativt. Egen rettighet; lesing kan være åpen for medlemmer. Kobles til medlem ved privat eier og til prosjekt ved bruk — krysslenker, ikke felles side. |

## 6. Ærlige begrensninger: taket i toppnavigasjonen

`src/components/Shell.tsx` bygger `NAV` av `BASE_NAV` (Hjem, Beskjeder, Noter,
Kalender, Medlemmer) pluss ett betinget innslag: `/innstillinger` ved
`settings.manage`. Et vanlig medlem ser **fem** oppføringer; en admin ser
**seks** — altså akkurat på terskelen under. Kalender kom til 31. august 2026;
Beskjeder samme dag.

Det er omtrent taket:

- Desktop-menyen (`hidden items-center gap-6 md:flex`) tar seks greit og syv
  trangt før den konkurrerer med logoen og brukermenyen om plassen.
- Mobilstripen (`md:hidden`, `overflow-x-auto` med en fade-gradient til høyre)
  **scroller allerede** for en admin på en smal telefon. Oppføringer bak faden
  er i praksis usynlige — feilmodusen er stille, ikke ødelagt layout.
- Beskjeder tok den ledige plassen 31. august 2026 (og fortrengte Filtilganger,
  se boksen under). Legger vi til Mediearkiv og Utstyr òg, er en admin på åtte
  oppføringer. Flat toppmeny knekker først på mobil, og den knekker uten at
  noen merker det. Neste område som vil ha en toppnivå-oppføring, må derfor
  enten fortrenge en av dagens seks eller ta launcher-spørsmålet opp igjen.

Det er en reell begrensning, ikke en smakssak. To retninger ble vurdert
(**(a) er valgt**, se boksen under):

- **(a) Undernavigasjon per område.** Toppmenyen holdes kort, og hvert område
  eier sin egen interne navigasjon. Krever at noe demoteres — Filtilganger inn
  under Arkiv eller Innstillinger, og Innstillinger eventuelt bare via
  brukermenyen (der `Min profil` allerede bor; `UserMenu` er en fungerende
  sekundærflate i dag). Billig, ingen nye konsepter, ingen ny flate å designe.
  Men toppmenyen vokser fortsatt med én per nytt område, så taket flyttes
  bare — det fjernes ikke.
- **(b) Launcher-flate.** En eksplisitt app-oversikt (rutenett med app-kort,
  på `/` eller bak en menyknapp) der toppmenyen beholder kun de tre–fire mest
  brukte områdene og resten oppdages fra launcheren. Skalerer i praksis
  ubegrenset og er den mest ordrette tolkningen av «hver feature som egen app».
  Men den koster et klikk for alle, den er en ny flate som må designes godt, og
  gjort dårlig blir den nøyaktig den store, utydelige administrasjonssiden §4
  advarer mot — bare med ikoner.

> **Fulgt opp 31. august 2026 (Beskjeder, #28):** da Beskjeder fikk sin egen
> toppnivå-oppføring, ville admin havnet på **sju** — over taket. Løsningen er
> den §6 (a) selv peker på: **«Filtilganger» er fjernet fra toppmenyen.**
> URL-en `/innstillinger/nedlastinger` består uendret (gamle lenker virker), og
> området nås nå fra to steder: en tydelig knapp øverst på `/innstillinger` og
> kortet i «Områder» på hub-en (`areasFor` beholder det ved `downloads.view`).
> Filtilganger er dermed fortsatt et app-område etter §1 — det har eget
> inngangspunkt, egen oversikt og egen gate — men ikke lenger en fast plass i
> toppmenyen. Det er nøyaktig avveiningen (a) beskrev: taket flyttes, det
> fjernes ikke, og neste område må igjen fortrenge noe eller ta launcheren (b)
> opp til vurdering.

> **Valgt 30. august 2026: (a).** Som del av arbeidet med å utvide notearkivet
> til internsiden «Tertnes Brass Intern» ble toppmenyen kortet ned til Hjem ·
> Noter · Medlemmer (+ Filtilganger/Innstillinger betinget — Filtilganger ble
> tatt ut igjen 31. august 2026, se boksen over), og noteområdet fikk
> sin egen områdemeny i layout-ruten `src/routes/noter/route.tsx`: «Mine noter»
> (`/noter`) · «Prosjekter» (`/noter/prosjekter`) · «Arkiv» (`/noter/arkiv`, kun
> ved `canBrowseArchive`). Prosjekter og Arkiv er dermed sider i noteområdet i
> navigasjonen, men fortsatt egne app-områder etter §1 — de har eget
> inngangspunkt, egen oversikt og egen gate. Gamle stier (`/prosjekter`,
> `/arkiv`, med detaljruter og søkeparametre) svarer 301 til de nye.

**Begrunnelsen bak valget:** Grunnen er ikke at (b) er feil, men
at plattformen har en håndfull områder og ikke ti — vi har ikke smerten som gjør
launcheren verdt en ny flate, og undernavigasjon er noe hvert område trenger
uansett. Terskelen for å ta opp spørsmålet igjen bør være målbar:

> Vurder launcher når `NAV` passerer seks oppføringer for én og samme rolle,
> eller når mobilstripen må scrolle for et **vanlig medlem** — ikke bare for
> admin.

> **Terskelen er nådd (31. august 2026).** «Styre» (`board.manage`) ble lagt til
> som toppnivå-oppføring da styreområdet ble bygget, og en admin ser nå **sju**
> oppføringer: Hjem · Noter · Kalender · Medlemmer · Styre · Filtilganger ·
> Innstillinger. Et vanlig medlem ser fortsatt fire, så mobilstripen scroller
> ikke for dem — men første betingelse over er passert, og launcher-spørsmålet
> (b) skal opp igjen før neste område tar en toppnivå-oppføring. Det mest
> nærliggende grepet er å demotere Filtilganger og Innstillinger til
> brukermenyen; det er ikke gjort her fordi det er et eget produktvalg, ikke en
> detalj i styrearbeidet.

> **Fulgt opp 2. september 2026 (Gruppeledere, #81):** området fikk en
> toppnivå-oppføring, og det er den første som ikke gis av en rettighet alene —
> den krever `members.manage.section` **og** en aktiv `section_leaders`-binding
> (`isGroupLeader`). Slik ser menyen ut nå, per rolle:
>
> | Hvem | Oppføringer | Antall |
> |---|---|---|
> | Musiker | Hjem · Beskjeder · Noter · Kalender · Medlemmer | 5 |
> | Gruppeleder (musiker med binding) | + Gruppeledere | 6 |
> | Styremedlem | + Styre | 6 |
> | Styremedlem som også er gruppeleder | + Gruppeledere + Styre | 7 |
> | Admin uten leiarbinding | + Styre + Innstillinger | 7 |
> | Admin med leiarbinding | + Gruppeledere + Styre + Innstillinger | 8 |
>
> Vanlige medlemmer ligger fortsatt på fem, og de to store gruppene (gruppeleder
> og styremedlem) på seks — altså på taket, ikke over det. De to
> kombinasjonsradene er reelle, men små: de gjelder folk som har to verv
> samtidig, og for dem scroller mobilstripen. Det er den nøyaktige feilmodusen
> §6 advarer mot, og terskelen for launcher-spørsmålet (b) er dermed passert for
> andre gang. Neste område med toppnivå-ambisjoner skal ikke bare fortrenge noe —
> det bør ta (b) opp til reell vurdering, med demotering av Filtilganger og
> Innstillinger til brukermenyen som det billigste alternativet.

## 7. Hva som ikke er avgjort

1. ~~**Navigasjonsmodellen** (§6)~~ — **avgjort 30. august 2026: alternativ (a)**,
   kort toppmeny + undernavigasjon per område. Terskelen i §6 står ved lag som
   trigger for å ta launcheren (b) opp igjen.
2. **Skal Filtilganger flyttes ut av `/innstillinger`-navnerommet?** Fortsatt
   åpent — men delvis besvart 31. august 2026: oppføringen er ute av
   toppmenyen (§6), mens URL-en står. En flytting er nå et rent URL-spørsmål med
   redirect-kostnad, ikke et navigasjonsspørsmål. Presedensen å ikke gjenta står
   ved lag: legg ikke nye områder under `/innstillinger`.
3. ~~**Skal Hjem være medlemsflaten eller plattformflaten?**~~ — **avgjort
   30. august 2026: plattformflaten.** `Hjem` (`/`) er hub-en for internsiden, og
   medlemsflaten «Mine noter» bor på `/noter` som en del av noteområdet.

   Hub-en ble bygget 31. august 2026 (`src/routes/index.tsx`, `getHub` i
   `src/server/hub.ts`). Rekkefølgen er avgjort, mobil først:

   1. **Hero — «Neste»:** neste kalenderhendelse med ukedag, dato, klokkeslett
      (Europe/Oslo), sted og «om N dager», med vei til `/kalender`. Er kalenderen
      ikke konfigurert eller feiler den, tar neste publiserte prosjekt plassen.
      Finnes ingen av delene: en rolig tomtilstand.
   2. **Mine noter:** ett kort med neste publiserte prosjekt, antall verk i
      programmet, brukerens stemmer som `Stamp`, og primærknappen «Åpne mine
      noter» → `/noter`. Ikke repertoarlisten — den bor på `/noter`.
   3. **Kommende:** de neste fire kalenderhendelsene etter hero, med lenke til
      hele kalenderen. Uten kalender: de neste prosjektene i stedet.
   4. **Områder:** kompakte snarveier til områdene brukeren har tilgang til,
      med samme betingelser som toppmenyen (`areasFor` i `src/lib/hub.ts`).

   **Beskjeder (#28) står øverst** — over hero — siden 31. august 2026. Det er
   det eneste som skal kunne fortrenge «Neste». Blokken viser de tre siste
   publiserte beskjedene brukeren har lov til å se (tittel, tidspunkt, utdrag,
   «Viktig»-stempel) og lenker videre til `/beskjeder`. Uten beskjeder er den én
   rolig linje, ikke en tom boks. Hele teksten, utkastene og publiseringsflyten
   bor i området — hub-en er fortsatt ikke et kontrollpanel (§4).

   Hub-en skal aldri bli et kontrollpanel som gjengir hvert områdes oversikt i
   miniatyr (§4). Den viser *det neste* og *veien videre*.
