# GIF-er, memes, bilder og emoji-reaksjoner

To ting som hører sammen, slik de gjør i Discord og andre chatteapper:

1. **GIF-er, stickers, memes og egne bilder** i forumet, i kommentarene på veggen
   og i chattene — med en GIF-velger (KLIPY) og opplasting fra enheten.
2. **Emoji-reaksjoner** på innlegg og kommentarer på veggen og i forumet. De
   erstatter «👍 Liker».

## De sju punktene

- **Navn:** GIF-er og reaksjoner (ingen egen meny — det er en del av skrivefeltene
  og innleggene).
- **Formål:** Gjøre samtalene levende: svare med en GIF eller et meme, og reagere
  med en emoji uten å skrive en kommentar.
- **Primærbruker:** Medlemmet som skriver eller leser et innlegg, svar, kommentar
  eller en chatmelding.
- **Primærhandling:** Trykke «GIF» i skrivefeltet og velge, eller trykke
  smilefjeset under et innlegg og velge en emoji.
- **Plass i navigasjonen:** Ingen ny. Knappene står i skrivefeltene i `/forum`
  (ny tråd, svar, svar på svar), på `/beskjeder/$postId` (kommentarer og svar)
  og i chattene (`/styre/chat`, prosjekttrådene, `/gruppeledere/chat`).
  Reaksjonene står under innleggene på veggen (også i feeden), under
  kommentarene, og under forumtråder og -svar.
- **Rettighet:** Ingen ny. Å sende og å reagere følger lesetilgangen til stedet
  (forum: innlogget; veggen: kan lese innlegget; styrechat: `board.manage`;
  lederchat: leiarbinding). Se `docs/tilgangsstyring.md` §10 og §11.
- **Eget rutenavnerom:** Nei. Bytene og KLIPY-valgene går via
  `/api/message-media/*`; reaksjonene er en serverfunksjon.

## GIF-velgeren (KLIPY)

Knappen «GIF» i skrivefeltet åpner en velger med fanene **GIF-er · Stickers ·
Memes · Emoji**: søk («Search KLIPY»), «Trending», «Nylig brukt» og KLIPYs
kategorier som fliser. Rull for flere treff. I chatten sendes et valg med en gang
som egen melding (som i Discord, og som svar hvis man holdt på å svare); ellers
legges det ved innlegget/kommentaren. Emoji-fanen og smilefjes-knappen (bare med
mus — telefonen har emoji på tastaturet) setter inn emoji der markøren står.

**Personvern — et bevisst valg (4. november 2026).** Tenors API ble lagt ned
30. juni 2026. KLIPY (som Discord bruker) er erstatningen, og standardvilkårene
deres krever at søket går fra medlemmets nettleser rett til `api.klipy.com`, at
GIF-ene vises rett fra KLIPYs CDN, og at vi verken proxyer eller lagrer kopier.
Det betyr at KLIPY ser leserens IP-adresse og tidspunkt når en GIF vises — et
unntak fra regelen om ingen bilder fra tredjepart, valgt av Sindre for å få
GIF-er som i Discord. Unntaket er avgrenset:

- Bare adresser på KLIPYs CDN-er godtas (`isKlipyMediaUrl`: https,
  `static.klipy.com`, `static1.klipy.com`, `static2.klipy.com`, bildeformat). Et
  rått kall kan ikke legge inn et sporingsbilde fra en annen vert.
- `referrerPolicy="no-referrer"` og ingen informasjonskapsler: KLIPY får vite at
  en GIF ble vist eller søkt etter, ikke hvor.
- `customer_id` er et pseudonym (HMAC av bruker-id-en med `BETTER_AUTH_SECRET`),
  aldri bruker-id eller e-post.
- Egne opplastede bilder er uendret: de ligger hos oss og vises bare gjennom gaten.
- Annonser er av (standard per nøkkel i KLIPYs partnerpanel). La dem være av —
  velgeren kan ikke vise annonser riktig, og hopper over dem.

**Oppsett:** Lag en nøkkel i KLIPYs partnerpanel (https://partner.klipy.com →
API Keys) og legg den inn som secret per miljø:
`wrangler secret put KLIPY_API_KEY` (og `--env staging`). Uten nøkkel er
GIF-søket av («GIF-søket er ikke slått på ennå»); opplasting virker. I `pnpm dev`
uten nøkkel svarer en etterligning (`/api/dev-klipy`) med KLIPYs egne
eksempelfiler. Testnøkler har en grense på 100 kall i timen; be om
produksjonstilgang i partnerpanelet før det tas i bruk av hele korpset.

## Tertnes-fanen: korpsets egne GIF-er (7. november 2026)

Første fane i GIF-velgeren er «Tertnes»: GIF-er og memes laget i korpset, som
kan brukes om og om igjen. Den første var «Galleri 69».

- **Navn:** Tertnes-fanen (Tertnes-GIF-er).
- **Formål:** Korpsets interne vitser som GIF-er, lette å finne igjen, uten at
  de ligger åpent på nettet.
- **Primærbruker:** Medlemmet som skriver. **Primærhandling:** åpne «GIF»,
  velge «Tertnes» og trykke på en GIF.
- **Plass i navigasjonen:** Ingen ny. En fane i GIF-velgeren (først i rekka),
  der både valg, «+ Legg til» og «Rediger» (fjerne) bor. Velgeren åpner på den
  fanen man sist valgte noe fra, per enhet (`localStorage`, bare bekvemmelighet).
- **Rettighet:** Å se og velge krever bare innlogging. Å legge til og fjerne
  krever den nye rettigheten `gifs.manage` («Tertnes-GIF-er»), seedet til
  Styremedlem (migrasjon `0034_tertnes-gif.sql`); admin har den via `*`.
- **Eget rutenavnerom:** Nei. `/api/band-media/upload` (PUT) og
  `/api/band-media/$mediaId` (GET); resten er serverfunksjoner i
  `src/server/band-media.ts`.

**Hvorfor ikke i repoet:** repoet er offentlig, og alt i `public/` kan hentes
uten innlogging. GIF-ene viser folk i korpset, så bytene ligger i R2 under
`band-media/<fersk id>.<ext>` og hentes bare gjennom gaten (innlogget medlem).
Tabellen er `band_media`.

**Et valg er en kopi.** `pickBandMedia` kopierer bytene til et vanlig utkast i
`message_media` (`source = 'upload'`, navnet som alt-tekst) via samme
`storeMessageMedia` som en opplasting: samme kontroll av bytene, samme tak på
utkast, samme gate, og mobilappen viser det som et vanlig bilde. Derfor blir en
GIF som fjernes fra fanen stående i meldingene der den allerede er brukt. Den
slettes med meldingen.

**Legge til:** fil (GIF, PNG, JPEG eller WebP, maks 10 MB, formatet leses fra
bytene) og et navn på maks 60 tegn. Navnet er det man søker på (samme ordregler
som søket på veggen) og det skjermlesere leser opp. Maks 200 i samlingen.
Skjemaet minner om at alle medlemmer ser GIF-ene, og at man bare skal legge til
bilder av folk som er med på det. **Fjerne:** «Rediger» → trykk på GIF-en →
«Fjern» i en bekreftelse i panelet. Det er ikke en egen dialog, fordi velgeren
lukkes ved et trykk utenfor seg selv. Raden slettes først, så R2.

### Lag GIF fra video (8. november 2026)

Velger man en video under «+ Legg til» (filvelgeren tar nå også `video/*`;
på iPhone vises da både bilder og videoer), åpner «Lag GIF fra video». Den
trenger hele skjermen, så velgeren lukkes, og åpnes igjen på Tertnes-fanen med
den nye GIF-en først når den er lagt til.

1. **Klipp** — forhåndsvisningen spiller klippet i loop og står fast øverst:
   - *Utsnitt:* form (Original, 1:1, 4:5, 4:3, 16:9), zoom (glider, knip eller
     rull) og dra i bildet. Rammen står stille; videoen flyttes under den.
   - *Klipp:* tidslinje med småbilder og to håndtak (også piltaster). Høyst
     8 s GIF ved 1× (4 s video ved ½×, 16 s ved 2×). Videoer over 30 s får en
     glider for «Del av videoen».
   - *Fart:* ½×, 1×, 2×.
2. **Slik blir GIF-en** — bildene hentes (~14 per sekund GIF), og man ser
   resultatet: loop (Vanlig, Frem og tilbake, Baklengs), størrelse (lengste side
   320/480/640, aldri forstørret) med den faktiske filstørrelsen, og navn.
   Blir GIF-en over 10 MB, går størrelsen ned av seg selv til man velger selv.

**Alt skjer på enheten.** Videoen spilles av lokalt og leses aldri av serveren;
bare den ferdige GIF-en lastes opp, med samme `uploadBandMedia`, gate og
`sniffImage` som en ferdig GIF. Ingen server- eller skjemaendring.

**Kodingen** (`src/lib/gif-encode.ts`, testet): én felles palett for hele GIF-en
(fra et utvalg av bildene — ingen flimring), ordnet dithering (mønsteret står
stille fra bilde til bilde) og gjennomsiktige piksler der det som vises allerede
er (nesten) riktig, så rolige flater koster nesten ingenting. LZW og blokkene er
`gifenc`. Bildene hentes ved å spole til hvert tidspunkt og lagres som JPEG i
minnet (`src/lib/video-frames.ts`) — rå piksler for 100+ bilder er for mye for
en eldre iPhone. Reglene for utsnitt, klipp, fart og loop er rene funksjoner i
`src/lib/gif-maker.ts`.

**Kjente grenser:** en video nettleseren ikke kan spille av (f.eks. HEVC på en
PC uten støtte) gir «Nettleseren kan ikke spille av denne videoen» — prøv på
telefonen der den ble tatt opp.

## Opplasting av egne bilder

1. Velger man et bilde (knappen «Bilde», lim inn, eller dra inn), lastes det opp
   med én gang (`PUT /api/message-media/upload`) og blir et **utkast**: en rad i
   `message_media` uten mål, som bare eieren ser. Et valg fra GIF-velgeren blir
   et utkast på samme måte (`addKlipyMedia`), bare uten bytes.
2. «Send» sender id-ene sammen med teksten. Serverfunksjonen (`replyToForum`,
   `createForumTopic`, `addComment`, `board.postMessage`,
   `gruppeledere.postMessage`) kobler bildene til den nye raden FØR raden
   skrives — en compare-and-set, så et dobbelttrykk aldri gir to meldinger.
   Feiler skrivingen (låst tråd, nettfeil), blir bildene utkast igjen.
3. Teksten kan være tom når det er minst ett bilde. Der bildet ikke kan vises —
   svarreferanser i chatten, push-varsler, mobilappen — står det «GIF»,
   «Sticker», «Meme», «Bilde» eller «3 bilder» (`mediaLabel`).
4. Krysses et bilde vekk, forlates skrivefeltet eller lukkes fanen, slettes
   utkastet. Den daglige cron-en (07:00 UTC) rydder resten.

Maks fire bilder per melding, 10 MB per fil, tolv utkast per medlem (eldre enn
en time gir plass). GIF, PNG, JPEG og WebP; formatet leses fra bytene. Bildene
vises i sin egen form (maks 320 px høye; stickers mindre og uten ramme), flere
som et rutenett. For den som har slått på «redusert bevegelse» står GIF-er og
stickers stille til man trykker «Spill av», og velgeren viser stillbilder.
Redigering i forumet endrer bare teksten, ikke bildene.

## Emoji-reaksjoner

Under hvert innlegg på veggen (også i feeden), hver kommentar og hver forumtråd
og -svar: én «chip» per emoji med antall, dine markert. Trykk på en chip for å
bli med eller trekke din tilbake; smilefjes-pluss gir hurtigvalgene
👍 ❤️ 😂 😮 😢 🎉 🎺 og «Flere» (hele emoji-velgeren, søk på norsk). Holder man
musepekeren over en chip, står de første navnene; et langt trykk (eller
høyreklikk) åpner et ark med ALLE som har reagert, én fane per emoji.

- Én rad per medlem per emoji (`reactions`, migrasjon `0031_reaksjoner.sql`).
  Flere ulike emojier per medlem er lov, men bare én av hver.
- Maks 20 ulike emojier per innlegg — man kan alltid bli med på en som finnes.
- Bare ekte emoji godtas (`isReactionEmoji`), aldri tekst. Emoji-velgeren viser
  ikke emoji nyere enn Unicode 15.1, så alle i korpset ser det samme.
- Dagens «👍 Liker» ble kopiert til 👍 i migrasjonen. Mobilappens «like» (v1) er
  fortsatt 👍, med samme svar som før.
- Ingen varsler på reaksjoner (som i Discord).
- Ikke i chattene ennå — de var ikke en del av denne runden.
