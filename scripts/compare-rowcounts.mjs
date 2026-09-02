// Sammenligner radtellinger fra scripts/d1-rowcount.sh før og etter migrering.
// Nye tabeller er greit; en eksisterende tabell med FÆRRE rader etter migrering
// stopper deployen FØR ny Worker-kode publiseres.
//
// Kan slå falskt ut hvis et medlem sletter noe (innlegg, kommentar) i
// sekundene mellom de to tellingene — da er det bare å kjøre workflowen på
// nytt fra Actions-fanen.
//
// Bruk: node scripts/compare-rowcounts.mjs <før.txt> <etter.txt>
import { readFileSync } from 'node:fs'

const read = (path) =>
  new Map(
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [table, count] = line.split(' ')
        return [table, Number(count)]
      }),
  )

const before = read(process.argv[2])
const after = read(process.argv[3])

let bad = false
for (const [table, n] of before) {
  const m = after.get(table)
  if (m === undefined) {
    console.error(`STOPP: tabellen ${table} forsvant under migreringen`)
    bad = true
  } else if (m < n) {
    console.error(`STOPP: ${table} krympet fra ${n} til ${m} rader`)
    bad = true
  }
}

if (bad) {
  console.error(
    'Deployen er stanset før ny kode ble publisert. Backupen fra rett før ligger i R2: tb-notearkiv-backup/d1/pre-deploy/.',
  )
  process.exit(1)
}
console.log('Radtelling OK — ingen tabell krympet.')
