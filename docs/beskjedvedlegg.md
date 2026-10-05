# Vedlegg på beskjeder

- Navn: Vedlegg.
- Formål: La styret dele dokumenter som medlemmene kan laste ned fra en beskjed.
- Primærbruker: Styremedlemmet som skriver beskjeden.
- Primærhandling: Velge vedlegg mens beskjeden opprettes eller redigeres.
- Navigasjon: I eksisterende skrive- og detaljsider under Beskjeder; ingen ny meny.
- Rettighet: `posts.publish` for opplasting og fjerning, sammen med innleggets redigeringsregel. Nedlasting krever aktiv innlogging og samme innsyn som beskjeden. Serveren håndhever begge.
- Eget rutenavnerom: Nei; filene har egne API-ruter under `/api/post-attachments`.

Inntil 10 vedlegg per beskjed, maks 25 MB per fil. Filer lagres privat i R2 med servergenererte nøkler. Nedlasting tvinges som vedlegg med `application/octet-stream`, aldri som aktivt innhold på appens domene. Filnavn normaliseres for trygg nedlasting.

Nye innlegg opprettes som utkast, deretter lastes bilder og vedlegg opp før publisering. Ved opplastingsfeil beholdes utkastet, og brukeren får lenke til det for å fortsette uten å opprette et nytt innlegg. På publiserte beskjeder er endringer synlige med det samme. Vedlegg sendes ikke som e-postfiler; e-postens eksisterende lenke fører til beskjeden og nedlasting bak innlogging.

Vedlegg følger beskjeden: utkast og styrebeskjeder er skjult for dem som ikke kan lese dem. Avpublisering eller endring av målgruppe gjelder også direkte nedlastingslenker. Nedlastinger har `private, no-store`. Sletting fjerner R2-bytene før metadata; hele beskjeden sletter også vedlegg før cascade. Vanlige medlemmer får ikke opplastingsrett gjennom rå API-kall.

Tabellen `post_attachments` opprettes additivt. Ingen eksisterende bilder, dokumenter eller mobilkontrakter endres. Vedlegg legges til i web-detaljresponsen, uten å endre v1-mobilresponsen.
