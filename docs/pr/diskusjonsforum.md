# Diskusjonsforum

**Levert i [sak #90](https://github.com/Tertnes-Brass/tb-intern/issues/90).**
Publisert 26. september 2026 i [commit c1c1e93](https://github.com/Tertnes-Brass/tb-intern/commit/c1c1e937b2c5fbd38cadb833fa31451613c346a9)
via [vellykket produksjonsdeploy](https://github.com/Tertnes-Brass/tb-intern/actions/runs/36257216131).

Relatert til [#27](https://github.com/Tertnes-Brass/tb-intern/issues/27), men
prosjektbundne kommentarer, prosjektavgrenset innsyn, avklart-status og sletting
står fortsatt igjen i den saken. Forumet leverer heller ikke påmelding fra
[#31](https://github.com/Tertnes-Brass/tb-intern/issues/31) eller emneknagger og
ressurskoblinger fra [#89](https://github.com/Tertnes-Brass/tb-intern/issues/89).
Medlemsomtaler gjenbruker løsningen fra [#83](https://github.com/Tertnes-Brass/tb-intern/issues/83).

Områdevalg (dokumentert før implementasjon og oppdatert etter brukerens avklaringer):

- Navn: Forum.
- Formål: Samle diskusjoner i varige emner som er enkle å finne igjen.
- Primærbruker: Medlemmet.
- Primærhandling: Starte et emne og delta i samtalen.
- Navigasjon: Forum i toppmenyen rett etter Hjem, både på mobil og desktop, etter brukerens uttrykkelige ønske. Eget kort i Hjem → Områder beholdes. Lange menyer kan rulles vannrett, jf. plassbegrensningen i designprinsipper §6.
- Gate: requireMe() for lesing og deltakelse, som på veggen. Ny forum.moderate i rettighetskatalogen for låsing og moderasjon, seedet til styret. Serveren håndhever alle regler.
- Rutenavnerom: /forum, /forum/ny og /forum/$topicId.

Første versjon: paginert emneliste og svar, opprette emner,
redigere egen tekst, moderere tekst og låse/gjenåpne emner. Ren tekst. Ingen kategorier, etter brukerens avklaring.
Ingen e-postvarsler eller vedlegg. Beskjeder og chat beholder sine eksisterende formål.

## Lokal demo og validering

Dev-server: http://localhost:3001. Demoinnlogging som vanlig medlem:
/api/dev-login?as=ingrid@demo.tertnesbrass.no&to=/forum/demo-forum-fest
Eksempeltråden «Hvem blir med på fest?» har to svar fra Ingrid og Jonas.
scripts/forum-demo.sql fyller bare demo-ID-er. Kjør med wrangler d1 execute
tb-notearkiv --local --file scripts/forum-demo.sql etter lokal dev-innlogging
som begge demobrukerne.

Verifisert: typesjekk, produksjonsbygg, lokal D1-migrasjon og 654 tester.
Forumtestene kjører serverfunksjonenes Drizzle-spørringer mot ekte SQLite og
kontrollerer innlogging, eierskap, moderering, låsing, paginering og slettet konto.
Innlogget HTTP-kall returnerer eksempeltråden med svar og svarskjema.
Visuell nettlesertest kunne ikke kjøres: ingen nettleser tilgjengelig.

## Uleste svar og tettere samtalevisning

Trådlista viser antall uleste svar fra andre medlemmer. Hvert svar får en
privat lesekvittering når det kommer inn i synsfeltet i en synlig nettleserfane.
GET og forhåndslasting skriver aldri lesestatus. Kvitteringen gjelder bare
konkrete svar-ID-er, så andre sider og samtidig innkomne svar forblir uleste.
Egne svar teller ikke som uleste. Lesekvitteringer deles ikke med andre medlemmer.
Forumet oppdateres hvert 12. sekund mens fanen er synlig.

Svarene vises som kompakte rader med skillelinjer, navn/tid/redigering på samme
linje og en liten «Nytt»-merking. Svarskjemaet har mindre luft og ingen kortramme.
Migrasjon 0017 legger bare til kvitteringstabellen med tilhørende indeks.
Migrasjonen er verifisert på lokal demo. Produksjon oppdateres gjennom deploy-workflowen.

## Omtaler i tråder og svar

MentionTextarea brukes ved opprettelse, svar og redigering. Individuelle omtaler
bruker den eksisterende markøren og maksgrensen på ti medlemmer. Søk og validering
bruker samme liste over aktive medlemmer; søket returnerer bare id/navn.
«Alle i korpset» er et eksplisitt valg, lagret som @[all], ikke en falsk bruker.
Navn slås opp ved lesing, tekst og navn escapes i rendringen, og redigering
bevarer markørene via navn i tekstfeltet. Uleste svar som omtaler deg eller alle
får en ekstra @-markering i oversikten.

Omtalene vises bare i forumet; e-post er ikke aktivert i denne versjonen.
Typesjekk, produksjonsbygg og alle 654 tester er grønne.

Svar vises med nyeste først. Svarfeltet ligger rett under innlegget, før svarene.
Et nytt svar tar brukeren til første side; eldre svar nås gjennom pagineringen.
