# Gammel arkivliste

- Navn: Arkivliste.
- Formål: Vise det historisk registrerte fysiske notearkivet, med opprinnelige arkivnummer og merknader bevart.
- Primærbruker: Arkivaren.
- Primærhandling: Søke opp en fysisk arkivoppføring.
- Navigasjon: Lenke fra Arkiv; samme Noter-område, ingen ny toppmeny.
- Rettighet: `archive.viewAll` eller `works.manage`, håndhevet server-side med `hasFullArchiveAccess`.
- Rutenavnerom: `/noter/arkiv/liste`.

Import gjøres av arkivaren selv på internsiden med `works.manage`. Excel-filen tolkes lokalt i nettleseren; bare ved bekreftelse sendes oppføringene til den autentiserte serverfunksjonen og D1. Kildedata, filnavn og radnummer lagres privat per oppføring. Ingen kildefiler, arkivdata eller krypteringsnøkler legges i GitHub.

Begge gamle kolonneoppsett støttes via overskriftene MusicID, Title, Composer, Arranger, What_missing, Last_check, CategoryID, Notes og Who_loan, samt Digitalisert der kolonnen finnes. Tomme ark holdes utenfor. Excel-datoer konverteres til ISO-dato. Tekstnumre beholder ledende nuller; numeriske nummer vises uten unødvendig desimal. Oppføringer uten nummer forblir uten nummer.

Last opp den nyeste listen først. Eksisterende arkivnummer hoppes over og overskrives aldri. Nummerløse oppføringer identifiseres med kildefilnavn og radnummer ved gjentatt import. Samme nummerløse oppføring i forskjellige filer kan ikke matches sikkert og kan derfor bli to registreringer. Digitale verk, filene deres og arkivnumrene deres endres ikke. CategoryID bevares uten å gjette betydningen; markeringen Digitalisert er historisk og sier ikke at filene finnes i appen.

Skjemamigrasjonen oppretter bare tabell og indekser, uten kildedata. Vanlig produksjonsworkflow deployer løsningen. Importen valideres server-side, bruker deterministiske ID-er og en atomisk D1-batch med konfliktvern.
