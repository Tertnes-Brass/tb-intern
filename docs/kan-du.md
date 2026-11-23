# Kan du?

Et innlegg på veggen som spør om folk kan være med på en dugnad eller et
spilleoppdrag. Folk trykker på svaret sitt og diskuterer i kommentarene.
Bygget i november 2026.

## De sju punktene (designprinsipper)

- **Navn:** Kan du?
- **Formål:** Finne ut hvem som kan, med svar og samtale på ett sted.
- **Primærbruker:** medlemmet som blir spurt. Den ansvarlige er andrebruker.
- **Primærhandling:** trykke Kan, Usikker eller Kan ikke.
- **Plass i navigasjonen:** ingen ny. Det bor på Veggen (eget filter), og står
  på Hjem så lenge du ikke har svart. Dugnader står også i kalenderen.
- **Rettighet:** `posts.publish` eller `projects.manage` for å spørre om en
  dugnad, `projects.manage` for et spilleoppdrag. Alle som kan lese innlegget
  kan svare.
- **Eget rutenavnerom:** nei, det bruker `/beskjeder`.

## Regler

- **Dugnad:** «Kan» betyr at du er med.
- **Spilleoppdrag:** «Kan» betyr at du er aktuell. Den ansvarlige velger hvem
  som spiller, og først da får de oppdraget i kalenderen og notene.
- Ingen rad betyr ikke svart. Dette er bevisst ikke `event_attendance`, der
  ingen rad betyr at man kommer.
- Alle ser hvem som kan. Usikre, nei, ubesvarte og merknader ser bare den
  ansvarlige: forfatteren, `posts.publish`, og `projects.manage` på oppdrag.
- Etter svarfristen, eller når svarene er stengt, kan man bare si fra om at man
  ikke kan. Etter datoen er svaret låst.
- Et spilleoppdrag henter dato, tid og sted fra prosjektet, og hvert oppdrag kan
  bare spørres om én gang.
- Typen og oppdraget kan ikke endres etter at noen har svart.
- Spørsmålet går alltid til hele korpset. Varsel sendes med det vanlige valget
  ved publisering.
- Den som blir valgt, får push. Den ansvarlige får push hvis noen i besetningen
  svarer at de likevel ikke kan. Begge følger valget «Når noen nevner deg».
- iPhone-appen kan svare på innlegget. Spørsmål stilles og besetning velges på
  nettsiden.
