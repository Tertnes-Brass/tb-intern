# Utgivelsesnotater

`neste.md` er notatet for det som ligger på staging (test.tertnesbrass.com)
og venter på verifisering før det går til prod. Det skrives av den som
integrerer en runde, på samme gren som endringene, og postes automatisk til
Discord-kanalen **#dev**:

- ved deploy til staging (push til `test`) — med påminnelse om at det må
  testes før merge til `main`;
- ved deploy til prod (merge til `main`) — som «ute i prod».

Skriv for medlemmene som skal teste, ikke for utviklerne: hva som er nytt,
hvor de finner det, og hva de bør prøve. Discord-markdown (fet, punktlister,
`kode`) fungerer; lange notat deles automatisk i flere meldinger.

Når en runde er i prod, flyttes `neste.md` til `ÅÅÅÅ-MM-DD.md` her, og en
tom/ny `neste.md` skrives for neste runde. Mangler `neste.md`, poster
workflowen commit-titlene utover `main` i stedet.

Webhooken ligger i repo-secreten `DISCORD_DEV_WEBHOOK_URL` (egen webhook for
#dev; `DISCORD_WEBHOOK_URL` er #git-tracker). «Utgivelsesnotat»-workflowen
kan kjøres manuelt for å poste notatet på nytt.

## Manuell kjøring

Workflow-fila må finnes på standardgrenen `main` før GitHub viser
«Run workflow». Velg **Use workflow from: main** og **mode: staging** for
å sende notatet fra `test`, eller **mode: prod** for notatet fra `main`.
Kjøringen bruker skriptet fra valgt workflow-gren og henter notat, SHA og
commit-logg fra miljøets gren. Den deployer ikke.

```sh
gh workflow run utgivelsesnotat.yml --repo Tertnes-Brass/tb-intern --ref main -f mode=staging
```

Skriptets regresjonstester kjøres uten Discord-tilgang:

```sh
node --test scripts/discord-release-note.test.mjs
```
