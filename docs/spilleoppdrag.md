# Spilleoppdrag

Oppdrag der bare noen av musikerne skal være med, for eksempel fire personer på
et julebord. Bygget i november 2026.

## De sju punktene (designprinsipper)

- **Navn:** Spilleoppdrag.
- **Formål:** Gi de som skal spille oppdraget i kalenderen og prosjektene, med
  notene de skal ha, uten at resten av korpset ser det.
- **Primærbruker:** den som setter opp oppdraget (`projects.manage`).
- **Primærhandling:** velge hvem som er med og hvilken stemme de spiller.
- **Plass i navigasjonen:** ingen ny. Det er en prosjekttype under Noter ·
  Prosjekter, og en rad i kalenderen til dem som er med.
- **Rettighet:** `projects.manage` for å sette opp, `project_crew` for å se.
- **Eget rutenavnerom:** nei, det bruker `/noter/prosjekter/$projectId`.

## Regler

- Bare de som er med og `projects.manage` ser oppdraget. For alle andre svarer
  serveren som om det ikke finnes.
- Velges ingen stemme, får medlemmet sine vanlige. Velges en stemme, gjelder den
  i stedet for de vanlige på dette oppdraget.
- Oppdraget må publiseres før de som er med ser det.
- Oppdraget skal **ikke** legges inn i Google-kalenderen, for den ser alle. Det
  flettes inn i `/kalender` og «Kommende» på Hjem for dem som er med.
- Kalenderraden lenker til prosjektet. Oppdrag har verken øvingsplan eller
  fravær. Den som blir valgt, får et push-varsel, og den ansvarlige får et hvis
  noen i besetningen svarer at de likevel ikke kan.
- Vet du ikke hvem som kan, bruker du «Spør korpset». Se `docs/kan-du.md`.
- iPhone-appen viser oppdraget under prosjekter og noter, men ikke i kalenderen,
  og besetningen velges på nettsiden.
