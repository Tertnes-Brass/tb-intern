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

## 1. Prinsippet

- Et **app-område** er en funksjon en bruker kan komme til plattformen *for*. Har
  du ikke en bruker som logger inn nettopp for å gjøre dette, er det ikke et
  område — det er en side i et eksisterende område.
- Hvert område har et **navn** brukeren kjenner igjen: samme ord i toppmenyen, i
  URL-en, i overskriften og i saken som ba om det.
- Hvert område har **én primærbruker**. Er svaret «alle», er området enten for
  stort eller egentlig to områder.
- Hvert område har **én primærhandling** som skal kunne gjøres fra første skjerm
  uten å lete. På `/arkiv` er det «legg inn et verk», på `/` er det «åpne min
  stemme».
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
| **Hjem** / «Mine noter» | `src/routes/index.tsx` (`getHome`) | Musikeren | Åpne egne stemmer + lytteeksempler til neste prosjekt | `requireMe()`; stemmefiltrering via `effectivePartIds` |
| **Prosjekter** | `src/routes/prosjekter/index.tsx`, `$projectId.tsx` | Dirigent / prosjektansvarlig | Klikke sammen et program i rekkefølge og publisere det | `projects.manage`; upublisert er usynlig ellers. Deling: `shares.manage` |
| **Arkiv** | `src/routes/arkiv/index.tsx`, `$workId.tsx` | Arkivaren | Katalogisere et verk og laste opp PDF per stemme | Innsyn: `archive.viewAll` ∨ `works.manage`; skriving: `works.manage` |
| **Medlemmer** | `src/routes/medlemmer/index.tsx` | Admin (seksjonsleder i redusert form) | Invitere et medlem og sette rolle + stemme | Lesing: `requireMe()`; skriving: `members.manage` / `members.manage.section` |
| **Innstillinger** | `src/routes/innstillinger/index.tsx` | Admin | Forvalte besetning og rollematrisen | `settings.manage` |
| **Filtilganger** | `src/routes/innstillinger/nedlastinger.tsx` | Admin / arkivar | Svare på «hvem har hatt denne fila?» | `downloads.view` |
| **Vikarvisning** | `src/routes/v/$token.tsx` | Vikaren, uten konto | Åpne de stemmene hen har fått, nå | Token + `shareAllows()` mot snapshottet løvliste |

Tre observasjoner som er verdt å ta med videre:

- **Arkiv er prinsippet i praksis.** Området har eget inngangspunkt som er skjult
  i navigasjonen for et vanlig medlem (`Shell.tsx` legger inn `/arkiv` kun ved
  `canBrowseArchive`), og `beforeLoad` sender resten til `/`. Området finnes, men
  bare for dem det er laget for.
- **Filtilganger er prinsippet brutt i praksis.** Det er et eget område med egen
  primærbruker og egen toppmeny-oppføring, men URL-en (`/innstillinger/nedlastinger`)
  parkerer det i et annet områdes navnerom. Det er ikke verdt en migrering i seg
  selv, men det er mønsteret å ikke gjenta: en funksjon havnet i «Innstillinger»
  fordi den føltes administrativ.
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

- **Finnes:** arkivblokken på Hjem lenker til `/arkiv/$workId` for det enkelte
  verket (`src/routes/index.tsx`), og filtilgangsloggen lenker fra en rad til
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
| **#28 Kunngjøringer** | Delt: lesing som blokk på Hjem, skriving i eget navnerom | Styre/dirigent → publisere en melding; medlem → se den | Saken sier selv at medlemmet skal se dem «på forsiden». Lesegrensesnittet er en blokk, ikke et område; publiseringsflyten med målretting og lest-status er stor nok til å fortjene eget rom. |
| **#24 Oppmøte** | Inne i #26, som primærhandling på en aktivitet | Medlem → svare kommer / kommer ikke / usikker | RSVP uten aktivitet er meningsløst; det er ikke et selvstendig område. Bygges #24 før #26, hører det hjemme på `/prosjekter/$projectId` — og da skal det sies eksplisitt at det er midlertidig. |
| **#26 Kalender/aktiviteter** | Eget område (`/aktiviteter`) | Alle medlemmer → se hva som skjer, og «Mine datoer» | Sterkeste kandidat til ny toppnivå-oppføring: primærbruker er *hele* korpset, ikke stab. Det er også den som først presser navigasjonen (§6). |
| **#13 Utstyr** | Eget område (`/utstyr`) | Materialforvalter → registrere en gjenstand med bilde, eier og lånestatus | Skal ikke under Innstillinger selv om det føles administrativt. Egen rettighet; lesing kan være åpen for medlemmer. Kobles til medlem ved privat eier og til prosjekt ved bruk — krysslenker, ikke felles side. |

## 6. Ærlige begrensninger: taket i toppnavigasjonen

`src/components/Shell.tsx` bygger `NAV` av `BASE_NAV` (Hjem, Prosjekter,
Medlemmer) pluss betingede innslag: `/arkiv` ved `canBrowseArchive`,
`/innstillinger/nedlastinger` ved `downloads.view`, `/innstillinger` ved
`settings.manage`. En admin ser altså **seks** oppføringer i dag.

Det er omtrent taket:

- Desktop-menyen (`hidden items-center gap-6 md:flex`) tar seks greit og syv
  trangt før den konkurrerer med logoen og brukermenyen om plassen.
- Mobilstripen (`md:hidden`, `overflow-x-auto` med en fade-gradient til høyre)
  **scroller allerede** for en admin på en smal telefon. Oppføringer bak faden
  er i praksis usynlige — feilmodusen er stille, ikke ødelagt layout.
- Legger vi til Aktiviteter, Mediearkiv, Kunngjøringer og Utstyr, er en admin på
  ti oppføringer. Flat toppmeny knekker først på mobil, og den knekker uten at
  noen merker det.

Det er en reell begrensning, ikke en smakssak. To retninger, **ingen av dem
valgt**:

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

**Anbefaling inntil eieren bestemmer:** (a). Grunnen er ikke at (b) er feil, men
at plattformen har seks områder og ikke ti — vi har ikke smerten som gjør
launcheren verdt en ny flate, og undernavigasjon er noe hvert område trenger
uansett. Terskelen for å ta opp spørsmålet igjen bør være målbar:

> Vurder launcher når `NAV` passerer seks oppføringer for én og samme rolle,
> eller når mobilstripen må scrolle for et **vanlig medlem** — ikke bare for
> admin.

## 7. Hva som ikke er avgjort

1. **Navigasjonsmodellen** (§6): launcher-flate eller flat toppmeny med
   undernavigasjon per område. Anbefalt: flat toppmeny + undernavigasjon nå,
   med terskelen over som trigger for å ta det opp igjen. Venter på eier.
2. **Skal Filtilganger flyttes ut av `/innstillinger`-navnerommet?** Kosmetisk i
   dag, men det er presedensen andre områder kommer til å kopiere.
3. **Skal Hjem være medlemsflaten eller plattformflaten?** #28 vil legge
   kunngjøringer der, #26 vil legge «Mine datoer» der. Hjem tåler ikke å bli
   alles utstillingsvindu; rekkefølgen og taket der må avklares før #28 og #26
   bygges — ellers avgjør den som kommer først.
