# Utgaver av verk

- Navn: Utgaver.
- Formål: Beholde gamle noter når et nytt notesett kommer, og vite hvilket sett et prosjekt bruker.
- Primærbruker: Arkivaren.
- Primærhandling: Opprette en utgave og laste opp tilhørende filer.
- Navigasjon: På verkets detaljside i Arkiv; prosjektets repertoar har et utgavevalg.
- Rettigheter: `works.manage` for utgaver og filer, `projects.manage` for prosjektets utgavevalg. Arkivlesing og filtilgang følger eksisterende regler.
- Rutenavnerom: Eksisterende `/noter/arkiv/$workId`, med `utgave` i URL-en; ikke et nytt app-område.

Utgave 1 er representert ved null i utgavefeltene. Eksisterende filer og prosjektkoblinger trenger derfor ingen omskriving, og nye demodata fungerer som før. Nye utgaver har egne rader og filer. Gjeldende utgave er standard ved nye prosjektkoblinger; eksisterende prosjektkoblinger endres aldri når gjeldende utgave byttes. En påbegynt opplasting bindes til utgaven i den signerte opplastingsbilletten.

En utgave kan opprettes tom, fylles med nye filer og deretter settes som gjeldende. Den kan også velges eksplisitt i et prosjekt. Ingen utgave slettes automatisk. Filer kan fortsatt slettes med eksisterende filhandlinger, og sletting av hele verket fjerner alle utgaver og filer.

Fil-gaten krever at filens utgave er den som er valgt i et tilgjengelig prosjekt eller vikarens prosjekt. Fullt arkivinnsyn gir fortsatt tilgang til historiske utgaver med samme stemme-/partiturregler. Mobil v1 beholder kontrakten og får filene fra prosjektets valgte utgave.
