# Beskjeder fra notearkivar

- Navn: Fra notearkivar.
- Formål: Varsle medlemmene om nye eller endrede noter.
- Primærbruker: Notearkivaren.
- Primærhandling: Publisere en tydelig merket beskjed, eventuelt med e-post.
- Navigasjon: Eksisterende Beskjeder, med eget filter på veggen.
- Rettighet: `posts.archive`, håndhevet på serveren. Gir merking, viktighet og
  e-post på egne innlegg, ikke styreinnsyn eller moderasjon. Seedet til Arkivar.
- Rutenavnerom: Eksisterende `/beskjeder`, ingen ny app.

Eksisterende `official` og «Fra styret» beholdes. En additiv `from_archive`-
kolonne skiller notearkivarbeskjeder fra styrebeskjeder. Ingen automatisk
utsending ved endring av noter; arkivaren skriver og velger varsling selv.
