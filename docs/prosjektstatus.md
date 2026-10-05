# Prosjektstatus per 5. oktober 2026

Internsiden har nå notearkiv, prosjekter, fysisk arkivliste, beskjeder, forum,
kalender med øvingsplan/oppmøte, medlemsprofil og administrasjon, styrearbeid og
samarbeid for gruppeledere. Denne leveransen legger til nedlastbare vedlegg på
beskjeder, også ved redigering av publiserte innlegg.

Gjennomgangen omfatter **alle 24 åpne issues** i
[Tertnes-Brass/tb-intern](https://github.com/Tertnes-Brass/tb-intern/issues), samt
leverte funksjoner og de 37 lukkede sakene. Åpen/lukket-status ble hentet fra
GitHub 5. oktober 2026. Vurderingene nedenfor bygger på kravene i sakene og dagens
kode. «Delvis» betyr at nærliggende funksjoner finnes, men at hele saken ikke er
løst. En lukket sak er historisk registrert som ferdig på GitHub; det er ikke
bevis på at hvert eldre akseptansekriterium er testet på nytt i denne runden.

Utgangspunktet før denne leveransen er `245276d` («Legg til beskjeder fra
notearkivar»). Vedlegg og denne statusrapporten følger samme produksjonsleveranse.
Faktisk deployresultat finnes i [Deploy prod](https://github.com/Tertnes-Brass/tb-intern/actions/workflows/deploy.yml).
Ingen arkivdata eller medlemsopplysninger inngår i dokumentasjonen.

## Hva som er levert

| Område | Tilgjengelig funksjonalitet | Grunnlag i kode/dokumentasjon |
|---|---|---|
| Noter og arkiv | Verk, søk/filter, undertittel og arkivnummer, stemmefiler og partitur, PDF-splitter, ZIP-nedlasting, lyd/lenker og filtilgangslogg. Filtilgangen følger rolle, stemmer og aktuelle prosjekter. | [works.ts](../src/server/works.ts), [pdf.ts](../src/server/pdf.ts), [file-access.ts](../src/server/file-access.ts), [tilgangsstyring.md](tilgangsstyring.md) |
| Utgaver og opprydding | Flere utgaver av samme verk med separate filer, tilgang til tidligere utgaver, prosjektkobling til bestemt utgave og redigering av utgavekommentar. Filfilter, avkryssing og sletting av flere viste filer, inkludert partitur. | [verk-utgaver.md](verk-utgaver.md), [verksiden](../src/routes/noter/arkiv/$workId.tsx), [work-editions.test.ts](../src/server/work-editions.test.ts) |
| Fysisk arkivliste | Privat XLSX-import med forhåndsvisning og bekreftelse. Gamle arkivnummer beholdes; nummerløse rader forblir uten nummer. Historiske mangler, utlån, merknader og digitaliseringsmarkering vises. | [arkivliste.md](arkivliste.md), [legacy-archive.ts](../src/server/legacy-archive.ts) |
| Noteprosjekter | Repertoar, sesong/dato/type, sortering og filtrering, publisering, vikardeling og slagverksoppsett per prosjektverk. Samlet utskriftsvennlig slagverksoversikt og prosjektets transport-/riggnotater. | [projects.ts](../src/server/projects.ts), [project-list.ts](../src/server/project-list.ts), [slagverksoversikten](../src/routes/noter/prosjekter/$projectId_.slagverk.tsx) |
| Beskjeder | Medlemsinnlegg og offisielle beskjeder fra styret/notearkivar, utkast og redigering, viktighet/målgruppe, bilder, markdown, kommentarer, liker og omtaler. Valgfri e-post med mottakerpreferanser og leveringslogg/idempotens; varsling avslått som standard. | [posts.ts](../src/server/posts.ts), [notearkivar-beskjeder.md](notearkivar-beskjeder.md), [posts.test.ts](../src/lib/posts.test.ts) |
| Vedlegg på beskjeder — denne leveransen | Styret kan laste opp, fjerne og erstatte vedlegg, også på publiserte innlegg. Medlemmer kan laste ned vedlegg på beskjeder de kan lese. Maks 10 filer à 25 MB. Delvis mislykket opplasting kan prøves igjen med samme utkast og uten å gjenta allerede bekreftede opplastinger. | [beskjedvedlegg.md](beskjedvedlegg.md), [PostForm.test.ts](../src/components/PostForm.test.ts), [post-attachments.test.ts](../src/server/post-attachments.test.ts) |
| Forum | Tråder og svar, redigering, moderering/låsing, uleste svar, omtaler av medlem/alle og oppdatering av aktiv fane. Ingen forumvedlegg eller e-post/push for forumomtaler. | [forum.ts](../src/server/forum.ts), [diskusjonsforum.md](pr/diskusjonsforum.md), #90 |
| Kalender og oppmøte | Google Calendar-feed, neste hendelse og firemånedersoversikt. Øvingsrekkefølge, prosjektkobling, RSVP og administrert fravær per forekomst. Gruppeledere ser bare navn/status i sine seksjoner. | [event-meta.ts](../src/server/event-meta.ts), [calendar-feed.ts](../src/server/calendar-feed.ts), #24/#26/#82/#84 |
| Medlemmer og innlogging | Invitasjoner, navn/telefon, egen profil, valgfritt passord og e-postkode, passordreset, stemmetildeling, én tilgangsrolle og separate seksjonslederbindinger. Administrative endringer loggføres. | [profile.ts](../src/server/profile.ts), [members.ts](../src/server/members.ts), [auth-instance.ts](../src/server/auth-instance.ts), [audit.ts](../src/server/audit.ts) |
| Styre | Oppgaver med ansvar/frister, styreprosjekter, møter, kommentarer og interne dokumenter. Chat med egne kanaler, svarreferanser, kodeformat, omtaler og uleste-markører. E-post om oppgavetildeling/forfalte oppgaver. | [board.ts](../src/server/board.ts), [board-notify.ts](../src/server/board-notify.ts), #80 |
| Gruppeledere | Eget område med seksjonsoversikt og chat, egne kanaler/omtaler/uleste, gated på aktiv seksjonslederbinding. | [gruppeledere.ts](../src/server/gruppeledere.ts), #81 |
| Plattform og mobil | Felles navigasjon/hub, invitasjonsbasert auth/RBAC og adgangskontroll på serveren. Native v1-API og native skjermkontrakter deler datamodell/tilgang. Produksjonsworkflow med backup, additiv migrasjonskontroll, radtelling og verifisering; separat staging. | [designprinsipper.md](designprinsipper.md), [mobile-api.md](mobile-api.md), [deploy.yml](../.github/workflows/deploy.yml) |

Den fysiske arkivlista er en historisk registrering, ikke en kontroll av skapet.
«Digitalisert i gammel liste» betyr ikke at notefilene er lastet opp her. En
samlet, verifisert status «Fysisk / Digitalt / Begge», med kobling mellom
arkivoppføring og digitalt verk, er **ikke levert**. Privat import av gammel
arkivliste er heller ikke Google Drive-importen i #2. Native vedleggsopplasting
og nedlastingsvisning er ikke lagt til i iPhone-appen av denne web-leveransen.
App Store-distribusjon er ikke verifisert som del av gjennomgangen.

## Alle åpne issues vurdert mot dagens løsning

| Sak | Vurdering | Det som er dekket | Det som står igjen |
|---|---|---|---|
| [#2 Import fra Sheets/Drive](https://github.com/Tertnes-Brass/tb-intern/issues/2) | Delvis, tilgrensende | Privat import av historisk Excel-katalog; manuell noteopplasting, stemmegjetting og utgaver. | Lesing av Google-regneark, nedlasting av Drive-PDF-er, oppretting av digitale verk/filer/lydlenker og prosjekter fra faner, tørrkjøring og idempotent samlet import. |
| [#3 Google-innlogging](https://github.com/Tertnes-Brass/tb-intern/issues/3) | Ikke levert | Invitasjonskrav, e-postkode, magisk lenke og passord finnes. | Google OAuth, knapp, trygg kontokobling og Google Cloud/secrets-oppsett. Callback-domenet i saken er utdatert; bruk `BETTER_AUTH_URL` og dagens kanoniske domene. |
| [#9 Tidspunkter i prosjekt](https://github.com/Tertnes-Brass/tb-intern/issues/9) | Delvis | Prosjektdato/sted og hendelsestidspunkt i kalenderen. | Egne klokkeslett for konsert, øving, rigg og lasting, riggegruppe/sjåfør og koblet kontaktinfo. `projects.eventDate` er en dato, ikke disse tidsfeltene. |
| [#10 Oppkjøring til prosjekter](https://github.com/Tertnes-Brass/tb-intern/issues/10) | Delvis | Kalenderforekomst med sted, øvingsrekkefølge, oppmøte og én prosjektkobling. | Flere prosjekter på samme øving, vikar-/riggegruppe-/dirigent-/nøkkelansvar og særskilte oppmøtetider/slagverksoppsett på øvingen. `event_meta.linkedProjectId` er fortsatt én kobling. |
| [#11 Sceneoppsett](https://github.com/Tertnes-Brass/tb-intern/issues/11) | Ikke levert | Slagverksnotater kan deles som tekst. | Grafisk plassering av stoler, stativer/instrumenter og eksport av sceneplan. Et dokumentvedlegg erstatter ikke editoren. |
| [#12 Riggeliste](https://github.com/Tertnes-Brass/tb-intern/issues/12) | Delvis | Slagverksoppsett og transport-/riggnotater på noteprosjektet. | Strukturert utstyrsliste, ansvarlig person/gruppe, avkryssing for medbrakt/returnert og historikk per prosjekt/øving. |
| [#13 Assets / utstyr](https://github.com/Tertnes-Brass/tb-intern/issues/13) | Ikke levert | Beskjeder/styredokumenter kan dele informasjon om utstyr. | Utstyrskatalog med bilder, produsent/modell/serienummer, eierskap/lån og brukshistorikk/prosjektkobling. |
| [#14 Kontaktinformasjon](https://github.com/Tertnes-Brass/tb-intern/issues/14) | Kjernebehov dekket; kandidat for lukking | Telefonnummer lagres i `member_profiles.phone`. Medlem kan endre eget nummer, og `members.manage` kan se/redigere det med auditlogg. Levert gjennom #65. | Eventuelt utvidet innsyn for fraværsansvarlige må avklares. Telefonbasert passordreset/SMS/2FA er ikke levert; dagens reset bruker registrert e-post. Dette er mulig viderebruk i saken, ikke implementert funksjonalitet. |
| [#16 Medlem deler egen stemme](https://github.com/Tertnes-Brass/tb-intern/issues/16) | Ikke levert | Stab kan lage vikardeling; stemmer kan tildeles administrativt. | Medlemstyrt deling av egen stemme med et annet instrument/medlem, med eksplisitt tilgang og avgrensning. Vikardeling er ikke denne selvbetjeningen. |
| [#18 Varsle ved prosjektpublisering](https://github.com/Tertnes-Brass/tb-intern/issues/18) | Ikke levert | Prosjekt kan publiseres, og separat beskjed kan sendes på e-post. | Varslingsvalg i prosjektets publiseringsflyt, riktig mottakerliste, e-postmal og idempotent leveringslogg for prosjektvarselet. |
| [#25 Medlemsprofil](https://github.com/Tertnes-Brass/tb-intern/issues/25) | Delvis | Egen profil med navn, e-post, telefon, rolle og stemmer; adminredigering og beskyttet telefoninnsyn (#65). Flere stemmetildelinger støttes. | Interesser/kompetanse, uttrykkelig hoved-/bistemmepresentasjon dersom ønskelig og bruk av kompetanse i dugnad/rigg/transport. |
| [#27 Prosjektkommentarer](https://github.com/Tertnes-Brass/tb-intern/issues/27) | Delvis, tilgrensende | Kommentarer på beskjeder, forumtråder og chat på styreprosjekter. | Medlemskommentarer på noteprosjekter, prosjektavgrenset innsyn og «avklart»-markering. Styreprosjekter er et eget lukket område; #90 løser heller ikke dette. |
| [#28 Kunngjøringer med lest-status](https://github.com/Tertnes-Brass/tb-intern/issues/28) | Delvis | Offisielle beskjeder, viktighet, målgruppe alle/styret, hub-visning, valgfri e-post/logg og nå dokumentvedlegg. | Lest/sett-kvittering for beskjeder, målgrupper etter rolle/seksjon/prosjekt og prosjektkobling. E-postleveringslogg viser ikke hvem som har lest. Forumets private uleste-markører er heller ikke kvitteringer for beskjeder. |
| [#29 Prosjekt-dashboard](https://github.com/Tertnes-Brass/tb-intern/issues/29) | Delvis | Repertoar, dato/sted/beskrivelse, utgaver, øvingskobling og slagverksoversikt på noteprosjektet. Oppgaver/dokumenter/chat finnes separat i styreområdet. | Samlet medlemsflate for prosjektbeskjeder/-oppgaver/-filer, tidsplan, rigg og sceneoppsett, med riktige tilganger. Et styreprosjekt erstatter ikke noteprosjektets medlemsflate. |
| [#30 Øvingsstatus per verk](https://github.com/Tertnes-Brass/tb-intern/issues/30) | Ikke levert | Øvingsrekkefølge og oppmøte er tilgjengelig. | Frivillig status «sett på / øves på / trenger hjelp» per medlem, prosjekt og verk, kommentarer og gruppesammendrag. Oppmøte er ikke øvingsstatus. |
| [#31 Sosiale arrangement](https://github.com/Tertnes-Brass/tb-intern/issues/31) | Delvis, tilgrensende | Kalenderhendelser kan ha RSVP; forum kan brukes til sosial planlegging. | Egen opprettelses-/arrangørflyt med påmeldingsfrist, kapasitet, praktisk info og deltakerliste etter valgt innsynsmodell. Forum/RSVP alene dekker ikke hele saken. |
| [#32 Internt mediearkiv](https://github.com/Tertnes-Brass/tb-intern/issues/32) | Ikke levert som område | Lydfiler/lenker på verk, bilder på beskjeder og nå generelle beskjedvedlegg. | Egen mediekatalog med tittel/dato/type/tilgang og prosjekt-/verk-/sesongkobling for opptak, bilder og video. Vedlegg er ikke et mediearkiv. |
| [#34 Perkusjonsinstrumenter](https://github.com/Tertnes-Brass/tb-intern/issues/34) | Delvis | Manuelle slagverksoppsett per prosjektverk og samlet prosjektoversikt. | Gjenbrukbar instrumentliste lagret på selve verket, strukturerte instrumenter/riggkobling og senere PDF/OCR-forslag. Dagens `project_works.percussionSetup` gjelder bare det ene prosjektet. |
| [#48 Flere roller](https://github.com/Tertnes-Brass/tb-intern/issues/48) | Delvis | Gruppelederbindinger kan kombineres med musiker/styremedlem uten å bytte tilgangsrolle; seksjonsinnsyn og rollebeskrivelser finnes. | Generelt mange-til-mange medlemsroller, union av rettigheter, UI og migrering. `member_profiles.roleId` er fortsatt én rolle. |
| [#50 Solistvalg](https://github.com/Tertnes-Brass/tb-intern/issues/50) | Ikke levert | Fritekstnotat kan legges på prosjektverk. | Valg av én/flere interne solister, eksterne solister/gruppe, redigering og tydelig visning på prosjektverket. Fritekstnotatet er ikke solistmodellen. |
| [#51 Varsling](https://github.com/Tertnes-Brass/tb-intern/issues/51) | Første e-postdel dekket; bredere behov delvis | Manuelt valgt beskjed-e-post, viktighets-/mottakerpreferanser, leveringslogg og vern mot dobbeltvarsling. Omtaler i innlegg/kommentarer og styreoppgavevarsler finnes. | Prosjekt-/repertoar-/filendringer, seksjons-/rolle-/prosjektmålgrupper, oppsummeringsvarsler og eventuell SMS. Forum/chatomtaler sender ikke e-post. Saken bør deles i levert første trinn og konkret restomfang. |
| [#69 Sterk autentisering](https://github.com/Tertnes-Brass/tb-intern/issues/69) | Ikke levert | Invitasjonskrav, e-postkode og valgfritt passord fra #65. | Passkeys, innføringsperiode/krav for privilegerte roller, sterk step-up, recovery og audit for disse hendelsene. |
| [#88 Vipps/passnøkler/tofaktor](https://github.com/Tertnes-Brass/tb-intern/issues/88) | Ikke levert | Eksisterende Better Auth, profil, invitasjonskrav og miljøseparasjon kan gjenbrukes. | Vipps OIDC/kontokobling/oppsett, passnøkkeladministrasjon og valgfri TOTP/gjenopprettingskoder. Overlapper #69 på passnøkler, men #69 har egne krav til privilegerte roller. |
| [#89 Emneknagger/koblinger](https://github.com/Tertnes-Brass/tb-intern/issues/89) | Ikke levert | Strukturerte relasjoner som prosjekt–verk og øving–prosjekt finnes. | Felles ressursregister, emneknagger, direkte koblinger/tilbakekoblinger, taggside, administrasjon og tilgangsfiltrering per ressurstype. Omtaler av medlemmer og fritekst-#tagger er ikke dette systemet. |

## Konsekvenser for backloggen

- **#14:** Kjernebehovet er dekket gjennom #65. Kan foreslås lukket, med presisering av telefoninnsyn og at SMS/telefonbasert auth ikke følger med.
- **#51:** Første implementasjon av beskjedvarsling oppfyller mye av sakens første-trinn-kriterier. Oppdater restomfanget rundt prosjektendringer/målgrupper, og skill eventuell SMS/digest ut som egne leveranser.
- **#28:** Behold åpen for lest/sett-status og målgrupper/prosjektkobling. Dokumentvedlegg er en levert utvidelse, ikke fullføring av saken.
- **#25/#48:** Skill profilen som finnes fra kompetansefelter og generelle kombinerbare roller. Seksjonslederbindingen løser kombinasjonen musiker + gruppeleder, ikke hele flerrollemodellen.
- **#9/#10/#12/#18/#27/#29/#34:** Dokumenter eksisterende kalender-/prosjekt-/slagverksfunksjoner som delmål og behold de konkrete manglene. Medlemsprosjekt og styreprosjekt må fortsatt skilles i kravene.
- **#69/#88:** Samordne passnøkkelarbeidet. Behold separate krav for Vipps/TOTP og sterk autentisering for privilegerte roller.
- **#2:** Fysisk katalogimport er levert separat. Drive-/Sheets-import til digitale verk og prosjekter står fortsatt igjen.

Ingen issues lukkes eller prosjektfelt endres automatisk av denne gjennomgangen.
Dette er en dokumentert vurdering; det å være i samme område er ikke nok til å
markere en større feature som ferdig.

## GitHub-prosjektet og begrensninger

[Notearkiv og medlemsplattform](https://github.com/orgs/Tertnes-Brass/projects/2)
er dokumentert opprettet i
[#35](https://github.com/Tertnes-Brass/tb-intern/issues/35), med epics og
underissues. Dagens token mangler `read:project`, så nåværende status,
prioritet, størrelse og eventuelle utkast som bare ligger på prosjektbrettet
kunne ikke leses. **Rapporten bekrefter derfor ikke at prosjektets Status-felt er
oppdatert**, eller at prosjektutkast uten issue er gjennomgått.

Hierarkiet som er dokumentert i #35 gir disse nyttige sammenhengene:

- Prosjektflyt #29: #9, #10, #18, #27, #28 og den lukkede #52; rigg/scene i #11/#12 hører også til produktbehovet.
- Medlemsdata #25: #14, #48 og den lukkede #54; mye grunnleggende profilarbeid er senere levert i #65.
- Utstyr #13: #11, #12 og #34.
- Kalender #26 (lukket): oppmøte #24 (lukket), øvingsplan #82 (lukket) og sosial påmelding #31 (åpen).

Dette er **dokumenterte relasjoner**, ikke en ny live-avlesning av prosjektbrettet.

## Verifisering av denne leveransen

- Typesjekk og produksjonsbygg er grønne. 703 enhet-/integrasjonstester er grønne.
- Vedleggstestene dekker innlogging/roller, direkte nedlasting av utkast og styreinternt innhold, skjulte metadata, filstørrelse, atomisk antallsgrense, opprydding ved DB-feil og R2-feil ved sletting.
- Skjematesten dekker nye vedlegg og fjerning av eksisterende vedlegg på et **publisert** innlegg, samt nytt forsøk etter delvis mislykket opplasting.
- Faktisk lokal opplasting/nedlasting mot D1/R2 og HTTP-rendering av skjema/detaljside er verifisert. Uinnlogget nedlasting gir 401; medlemstilgang til vedlegg på utkast gir 404.
- Migrasjon `0021_beskjedvedlegg.sql` oppretter bare ny tabell og indeks. Eksisterende tabeller bygges ikke om.
- Visuell testing med agentstyrt nettleser var ikke tilgjengelig. Gjennomgangen av eldre features er kilde-/kravkontroll, ikke en ny ende-til-ende-test av alle tidligere leveranser.

## Lukkede saker på GitHub

Denne listen viser den faktiske issue-statusen ved gjennomgangen. Den skilles
fra vurderingene av de åpne sakene ovenfor, særlig der en nyere lukket sak
leverer deler av en eldre epic.

| Sak | GitHub-status |
|---|---|
| [#1 Backup-rutiner: ukentlig D1-dump + R2 off-site + restore-test (cron)](https://github.com/Tertnes-Brass/tb-intern/issues/1) | Lukket |
| [#4 Admin: administrere besetning (stemmer) og roller i appen](https://github.com/Tertnes-Brass/tb-intern/issues/4) | Lukket |
| [#15 Flytte på stemmer i hierarki](https://github.com/Tertnes-Brass/tb-intern/issues/15) | Lukket |
| [#17 PDF-splitter: del samle-PDF opp i stemmer](https://github.com/Tertnes-Brass/tb-intern/issues/17) | Lukket |
| [#19 ZIP-nedlasting for prosjekt og stemmer](https://github.com/Tertnes-Brass/tb-intern/issues/19) | Lukket |
| [#20 Nedlastingslogg i admin-UI](https://github.com/Tertnes-Brass/tb-intern/issues/20) | Lukket |
| [#21 Nedlasting av noter fungerer ikke på iphone](https://github.com/Tertnes-Brass/tb-intern/issues/21) | Lukket |
| [#22 Bedre søk og filter i verksarkivet](https://github.com/Tertnes-Brass/tb-intern/issues/22) | Lukket |
| [#23 Større vindu for avspilling av opptak](https://github.com/Tertnes-Brass/tb-intern/issues/23) | Lukket |
| [#24 Oppmøte og RSVP for øvinger, prosjekter og konserter](https://github.com/Tertnes-Brass/tb-intern/issues/24) | Lukket |
| [#26 Kalender og årsplan med Google Calendar-integrasjon](https://github.com/Tertnes-Brass/tb-intern/issues/26) | Lukket |
| [#33 Endre seksjonen «Partitur» til «Dirigent»](https://github.com/Tertnes-Brass/tb-intern/issues/33) | Lukket |
| [#35 Etablere GitHub Project for backlog, bugs og features](https://github.com/Tertnes-Brass/tb-intern/issues/35) | Lukket |
| [#36 Gi medieansvarlege redigeringstilgang til nettsida](https://github.com/Tertnes-Brass/tb-intern/issues/36) | Lukket |
| [#37 Flytt domene frå saynain.com til tertnesbrass.no](https://github.com/Tertnes-Brass/tb-intern/issues/37) | Lukket |
| [#38 Migrer tertnesbrass og tb-notearkiv til Tertnes-Brass-organisasjonen](https://github.com/Tertnes-Brass/tb-intern/issues/38) | Lukket |
| [#39 Designprinsipp: kvar feature som eigen app i plattforma](https://github.com/Tertnes-Brass/tb-intern/issues/39) | Lukket |
| [#46 Fjern grovmessing som eigen seksjon](https://github.com/Tertnes-Brass/tb-intern/issues/46) | Lukket |
| [#47 Tuba-stemme blir vist under Kornetter i medlemslista](https://github.com/Tertnes-Brass/tb-intern/issues/47) | Lukket |
| [#49 Legg til undertittel og arkivnummer på verk](https://github.com/Tertnes-Brass/tb-intern/issues/49) | Lukket |
| [#52 Sorter og filtrer prosjekt, og knytt øvingar til prosjekt](https://github.com/Tertnes-Brass/tb-intern/issues/52) | Lukket |
| [#53 Plasser dirigent og partitur riktig i medlemslista](https://github.com/Tertnes-Brass/tb-intern/issues/53) | Lukket |
| [#54 Utvid medlemsinvitasjon med navn, stemme, gruppe og tilgangar](https://github.com/Tertnes-Brass/tb-intern/issues/54) | Lukket |
| [#55 Avgrens musiker-tilgang til kommande prosjekt og prosjektnoter](https://github.com/Tertnes-Brass/tb-intern/issues/55) | Lukket |
| [#56 Spor notevisning og nedlasting frå viewer i nedlastingsloggen](https://github.com/Tertnes-Brass/tb-intern/issues/56) | Lukket |
| [#57 Gruppeleder med 'Lede egen seksjon' får ikkje tilgang til seksjonsnoter i prosjekt](https://github.com/Tertnes-Brass/tb-intern/issues/57) | Lukket |
| [#65 Min profil: medlemmer kan endre navn, passord og kontaktinfo; admin kan administrere med logging](https://github.com/Tertnes-Brass/tb-intern/issues/65) | Lukket |
| [#66 Filtilganger viser feil ved åpning av nedlastingsloggen](https://github.com/Tertnes-Brass/tb-intern/issues/66) | Lukket |
| [#78 Slå saman duplikate «Styremedlem»-roller og rydd eksisterande medlemstilknytingar](https://github.com/Tertnes-Brass/tb-intern/issues/78) | Lukket |
| [#79 Støtt Markdown-formatering i Beskjeder](https://github.com/Tertnes-Brass/tb-intern/issues/79) | Lukket |
| [#80 Utvid styrechatten med eigne kanalar, svarreferansar og kodeformattering](https://github.com/Tertnes-Brass/tb-intern/issues/80) | Lukket |
| [#81 Lag eit eige samarbeidsområde for gruppeleiarar](https://github.com/Tertnes-Brass/tb-intern/issues/81) | Lukket |
| [#82 Legg øvingsrekkefølgje og administrert fråvær på kalenderhendingar](https://github.com/Tertnes-Brass/tb-intern/issues/82) | Lukket |
| [#83 Støtt @-omtalar av medlem i kommentarar på Beskjeder](https://github.com/Tertnes-Brass/tb-intern/issues/83) | Lukket |
| [#84 Vis fleire månader i den interne kalenderlista](https://github.com/Tertnes-Brass/tb-intern/issues/84) | Lukket |
| [#85 Ha e-postvarsling avslått som standard ved publisering av beskjed](https://github.com/Tertnes-Brass/tb-intern/issues/85) | Lukket |
| [#90 Diskusjonsforum for medlemmer med uleste svar og omtaler](https://github.com/Tertnes-Brass/tb-intern/issues/90) | Lukket |
