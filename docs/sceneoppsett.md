# Sceneoppsett

Tegninger av hvordan korpset og slagverket skal stå på scenen, per prosjekt —
laget i en innebygd Excalidraw-editor med ferdige komponenter, og sendt til
arrangøren som PDF med utstyrslisten talt opp.

Standardoppsettet og tellereglene er hentet fra Kim Systads
[easy-seatingplan](https://github.com/kimsystad/easy-seatingplan) (oktober
2026), en frittstående side for det samme behovet. Ideene er tatt med — ikke
koden eller symbolene (repoet har ingen lisens).

Integrasjonen er modellert etter lerretene i trestl (`CanvasEditor.tsx`,
`CanvasSaveQueue`), men uten sanntidssamarbeid: internsiden har ingen
websockets eller Durable Objects, og to som tegner samtidig er sjeldent nok til
at en ærlig konflikt er bedre enn en stille overskriving.

## Sjekklisten (designprinsipper §3)

1. **Navn:** Sceneoppsett. Samme ord på prosjektsiden, i overskriften og i
   rettigheten («Sceneoppsett» i rollematrisen).
2. **Formål:** Riggen for en konsert eller konkurranse beskrives i dag med
   skisser på papir, regneark og e-post. Med sceneoppsett tegnes den én gang,
   gjenbrukes neste år, og sendes som én PDF der stoler, stativ og instrumenter
   allerede er talt opp.
3. **Primærbruker:** Den som rigger — dirigent, slagverksansvarlig eller
   prosjektleder (`stage.manage`). Medlemmene er lesere: de kan åpne oppsettet
   for å se hvor de sitter.
4. **Primærhandling:** «+ Nytt oppsett» på prosjektsiden → start fra en mal →
   dra inn/flytt komponenter → «Last ned PDF».
5. **Plass i navigasjonen:** Ingen ny toppmeny-oppføring og ingen flis. Dette er
   en side i Prosjekter-området (§1: ingen logger inn *bare* for å tegne en
   scene), på samme måte som slagverksoppsettet: en seksjon på prosjektsiden og
   en fullskjermsrute for selve tegningen.
6. **Rettighet:** ny `stage.manage` i `PERMISSION_CATALOG`. Lesing følger
   prosjektet (se under). Håndheves i `src/server/stage-setups.ts`.
7. **Rutenavnerom:** `/noter/oppsett/$setupId` (`src/routes/noter_.oppsett.$setupId.tsx`),
   utenfor noteområdets layout (`noter_`) og uten skall (`bare` i `__root.tsx`)
   — som notestativet. Lista bor på prosjektsiden; det finnes ingen egen
   oversiktsside, fordi et oppsett aldri finnes uten et prosjekt.

## Slik er det bygget

| Hva | Hvor |
|---|---|
| Tabell | `stage_setups` (migrasjon `0025_sceneoppsett.sql`, kun CREATE TABLE/INDEX + rettighetsseeding; `0027_scene-kontakt.sql`, tre ADD COLUMN for kontaktpersonen — journal-idx 28, se kommentaren i fila) |
| Serverfunksjoner | `src/server/stage-setups.ts` (`getStageSetup`, `createStageSetup`, `saveStageSetup`, `deleteStageSetup`, `listStageSetupSources`) |
| Delt spørring | `src/server/stage-setup-store.ts` (lista på prosjektsiden, brukt av `getProject`) |
| Regler og validering | `src/lib/stage-scene.ts` (`parseStageScene`, `canReadStageSetups`, grenser) |
| Elementfabrikk | `src/lib/stage-elements.ts` — Excalidraw-elementer som rene data |
| Komponenter, utstyrsliste og riggerekkefølge | `src/lib/stage-components.ts` |
| Snu mot dirigenten, enkel/dobbel stol | `src/lib/stage-arrange.ts` |
| Maler | `src/lib/stage-templates.ts` |
| Autolagring | `src/lib/stage-save-queue.ts` |
| Editor | `src/components/stage/StageEditor.tsx` (lastes kun via `StageEditorLoader.tsx`) |
| Palett | `src/components/stage/StagePalette.tsx` |
| PDF | `src/components/stage/stage-pdf.ts` (pdf-lib, lastes ved bruk) |
| Prosjektsiden | `src/components/stage/StageSetups.tsx` |
| Fonter | `excalidrawFonts()` i `vite.config.ts` |

### Komponentene

En komponent er en gruppe Excalidraw-elementer (stol + navnelapp + stativ,
fire pauker + krakk, …) bygget av `stage-elements.ts`, ikke av Excalidraw.
Det gir tre ting:

- **Serveren kan bygge malene** uten å laste editoren, og alt kan testes i
  Vitest (`stage-components.test.ts`, `stage-templates.test.ts`).
- **Paletten tegner ikonene** (`StageGlyph`) fra de samme elementene som
  settes inn, så ikon og resultat aldri kan bli ulike.
- **Utstyrslisten telles fra tegningen.** Hovedelementet i hver komponent har
  `customData.tb` (`'chair'`, `'stand'`, `'timpani'`, …). Merket følger med når
  Excalidraw kopierer, limer inn og dupliserer, og `equipmentList` teller det —
  ingen liste som må holdes i takt med tegningen. Praktikabler telles per
  størrelse. Derfor er alt som telles, også synlig: en **dobbel stol** (en
  ekstra stol til instrument og dempere) er en ekstra stol som stikker ut bak
  den med navnet (`customData.extra`), og slagverket som spilles fra noter
  (pauker, stortromme, skarptromme, trommesett og stavspillene) har sitt eget
  **notestativ** i komponenten.

En komponent er elementene i samme **innerste** gruppe (`groupIds[0]`).
Excalidraw legger nye, ytre grupper bakerst, så en stol er fortsatt én
komponent når noen grupperer hele kornettrekka.

Målestokken er 100 px per meter, og rutenettet har en hovedlinje per meter.
Stolene dreies aldri (navnet skal kunne leses); notestativet viser hvilken vei
musikeren ser. Komponentene ligger både i paletten (trykk eller dra) og i
Excalidraw sitt «Bibliotek». Det man selv legger i biblioteket, huskes i
`localStorage` på enheten.

Malene (`src/lib/stage-templates.ts`):

- **Standard** — Kims hestesko, 14 × 9 m: kornettene i to rekker langs venstre
  side (solokornettene innerst), eufonier og barytoner innerst til høyre med
  trombonene utenfor, hornene tvers over bak med flygelhornet i hjørnet og
  bassene bak dem. Stavspillene står på langs ytterst til venstre (marimbaen
  fremst), skarptromme, cymbaler og stortromme på bakerste rad med tam-tam bak,
  trommesettet bak til høyre og paukene ytterst til høyre, dreid mot
  dirigenten. Doble stoler etter Kims regel: sopran, repiano, 2. og 3.
  kornett, bassene og trombonene. Det gir 39 stoler + paukekrakken og 35
  notestativ — de samme tallene som i Kims app (40 stoler der, fordi han teller
  krakken som stol).
- **Storband** — trommesettet i midten, trombonene og bassene på hver sin side
  av det, horn/barytoner/eufonier foran og kornettene på bakerste rad.
- **Slagverk** — riggen alene, uten dirigent.
- **Tom scene** — scenen, dirigenten og publikum.

Scenen, «Publikum» og målestokken er låst i malene, så de ikke dras med når man
flytter stoler. Malene er bare et utgangspunkt: et oppsett som ikke ligner noen
av dem, lages fra «Tom scene» med komponentene, eller ved å kopiere et
tidligere oppsett (som da blir korpsets egen mal). Testene låser at alle malene
holder seg innenfor scenen, at stolene ikke overlapper, og at stativene
allerede står mot dirigenten.

### Snu mot dirigenten og doble stoler

Velger man stoler eller instrumenter med stativ, kommer en liten verktøylinje
over tegningen: **Enkel stol / Dobbel stol** og **Snu mot dirigenten** (også i
hovedmenyen, for hele tegningen). Begge er rene funksjoner i
`stage-arrange.ts` som tar hele elementlista og gir en ny tilbake, og editoren
legger den inn med `updateScene` som ett steg i angre-historikken.

- `faceConductor` flytter hvert stativ rundt stolen/instrumentet så det peker
  mot nærmeste dirigentpodium, og den ekstra stolen bak på motsatt side.
  Paukebuen dreies om krakken, med stativet i buen. Stolene dreies aldri (navnet
  skal kunne leses). Uten utvalg gjelder det alle. Det er en knapp, ikke
  automatikk som hos Kim: i et storband eller på en konsert skal noen stativ
  kanskje peke mot salen, og da må de få stå.
- `setChairCount` legger til eller fjerner den ekstra stolen. Fjerning er
  `isDeleted: true`, så angre virker.
- Knappene tar ikke fokus fra tegningen, og fokus legges tilbake etterpå —
  ellers virker ikke ⌘Z/Esc før man klikker i den (`handleKeyboardGlobally` er
  av).

### Lagring og konflikter

`StageSaveQueue` lagrer 1,2 s etter siste endring, én skriving om gangen.
Excalidraw sender `onChange` for hver musebevegelse; editoren tar et
øyeblikksbilde først etter 200 ms ro (`commit`), og alltid før lagring,
eksport og når man forlater siden (`useBlocker`).

Hver lagring sender revisjonen den bygger på, og `saveStageSetup` gjør en
compare-and-set (`UPDATE … WHERE revision = ?`). Har noen andre lagret
imellom, kommer `{ ok: false, conflict }` tilbake, køen stopper, og editoren
viser hvem som lagret, med «Last ned min kopi» og «Hent siste versjon». Den
prøver aldri på nytt av seg selv.

Den første `onChange` etter innlasting er Excalidraw som normaliserer tegningen
(indekser, bindinger). Den blir det nye utgangspunktet (`rebase`) i stedet for
en lagring — så lenge brukeren ikke har rørt noe.

Ruten har `gcTime: 0`, og editoren leser lasterdataene én gang: ny lasterdata
(f.eks. fra en `router.invalidate()` et annet sted) bytter aldri ut tegningen
noen sitter med.

### Tilgang

- **Lesing følger prosjektet.** `canReadStageSetups` bygger på
  `projectReadError` (`src/lib/project-access.ts`), som er regelen
  `getProject` alltid har brukt — nå trukket ut slik at de to ikke kan gli fra
  hverandre. Utkast: bare `projects.manage`. Tidligere prosjekter:
  `projects.manage` og fullt arkivinnsyn.
- **`stage.manage` kan i tillegg lese oppsett i tidligere *publiserte*
  prosjekter** — fjorårets konkurranseoppsett er det naturlige utgangspunktet
  for årets. Aldri i et utkast.
- **Skriving krever `stage.manage`**, og at oppsettet kan leses.
- **«Finnes ikke» og «ingen tilgang» gir samme svar** («Fant ikke
  sceneoppsettet»), så en id ikke kan brukes til å kartlegge utkast.
- **Seeding:** migrasjonen gir `stage.manage` til alle roller som har
  `projects.manage` i dag (arkivar og dirigent i standardoppsettet) — ingen som
  kunne skrive slagverksoppsettet før, mister noe. Rettigheten er likevel egen,
  så en slagverksansvarlig kan få den uten å kunne endre programmet.

### Hva som lagres

`scene` er JSON — `{ elements, appState }` — og valideres av `parseStageScene`
ved både opprettelse og lagring:

- Bare vektorelementer: rektangel, ellipse, rombe, linje, pil, tekst, frihånd
  og ramme. **Bilder lagres ikke** (de ville trengt R2 og egen
  tilgangskontroll), og heller ikke `embeddable`/`iframe` (fremmede nettsider
  inne i tegningen). Editoren skjuler bildeverktøyet og sier fra om noe slikt
  havner i tegningen.
- Lenker på elementer må være http(s), mailto eller relative; kontrolltegn
  fjernes før skjemasjekken (som `safeHref`).
- Maks 1 MB og 5 000 elementer. Et fullt korps er ~150 kB.
- Fra `appState` lagres bare bakgrunnsfarge og rutenett — ikke zoom, valg
  eller verktøy.
- Slettede elementer tas ut ved lagring.

### Excalidraw i bygget

- `@excalidraw/excalidraw` 0.18 er ~2 MB og kjører bare i nettleseren.
  `StageEditorLoader` laster editoren med `lazy()` bak en
  `import.meta.env.SSR`-vakt (samme grep som `pdf-loader.ts`), så Worker-
  bundelen ikke vokser. Sjekk etter bygg: `grep -rl excalidraw dist/server` skal
  ikke gi treff.
- **Fontene serveres fra eget domene**, under `/excalidraw/<versjon>/fonts/`
  (`excalidrawFonts()` i `vite.config.ts`: mellomvare i dev, `emitFile` i
  klientbygget). Ellers henter Excalidraw dem fra esm.sh, og den som tegner
  sender IP og tidspunkt til en tredjepart. Xiaolai (CJK, ~12 MB) er utelatt.
- Aksentfargen er messing (`stage-editor.css`), og grensesnittet er på norsk
  (`langCode="nb-NO"`).
- `pnpm.overrides` i `package.json` løfter `nanoid`, `lodash-es` og `katex` i
  Excalidraw sitt avhengighetstre forbi kjente sårbarheter (samme som trestl).

### Eksport

- **PDF til arrangøren** (`stage-pdf.ts`): liggende A4 med tittel, prosjekt,
  type, dato og sted, scenestørrelsen, tegningen, og en spalte med
  kontaktperson, utstyr (stoler, stativ, krakker, podium, bord, praktikabler),
  slagverket i riggerekkefølge og merknadene. Helvetica har bare WinAnsi;
  `winAnsi` dropper emoji og markerer manglende bokstaver med «?».
- **Slagverk fra venstre** (`percussionRigOrder`): instrumentene fra venstre mot
  høyre slik slagverkerne ser det, med ansiktet mot salen — altså fra høyre mot
  venstre i tegningen. Ett paukesett er én linje («Pauker (4)»). Instrumentene
  står bare her, ikke også i utstyrslisten, så samme pauke ikke telles to
  steder.
- **Kontaktperson** (navn, e-post, telefon) fylles ut med den som lager
  oppsettet (telefon fra profilen) og kan endres i «Utstyr og merknader».
  Formatet sjekkes ikke, siden feltene lagres mens man skriver.
- **PNG/SVG** via Excalidraw sin egen «Eksporter bilde».
- **.excalidraw**-fil, som også kan importeres igjen (bilder utelates).

## Ikke med i første runde

- **Delingslenke til arrangøren** (som vikarlenkene). PDF-en dekker «send det
  inn»; en lenke ville krevd en tokentabell og en offentlig visning.
- **Navn fra besetningen** på stolene. I dag skriver man navnet i stolen
  (dobbeltklikk). En automatisk utfylling må ta stilling til vikarer og
  fravær.
- **Delt komponentbibliotek og egne maler for korpset.** Egne
  bibliotekselementer ligger per enhet; «kopier et tidligere oppsett» er malen
  inntil videre.
- **Engelsk PDF** til konkurranser i utlandet (Kims app har nynorsk og
  engelsk). De faste tekstene og instrumentnavnene kan oversettes; navnene i
  stolene er det brukeren skrev.
- **Sanntidssamarbeid.**
