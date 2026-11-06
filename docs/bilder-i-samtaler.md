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
