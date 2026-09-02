// Sorterer INSERT-setningene i en D1-dataeksport i FK-avhengighetsrekkefølge.
//
// Hvorfor: `wrangler d1 export` legger tabellene alfabetisk, men D1 kjører
// importen med FK-håndheving på og committer i bolker — en INSERT som peker på
// en rad i en tabell som kommer senere i filen velter da hele importen
// (SQLITE_CONSTRAINT_FOREIGNKEY). Med tabellgruppene i topologisk rekkefølge er
// ethvert prefiks av filen konsistent, så hver bolk kan committe trygt.
// Selvreferanser (f.eks. kommentar → forelder i samme tabell) er ufarlige:
// radene eksporteres i rowid-rekkefølge, og forelderen er alltid eldst.
//
// Bruk: node scripts/reorder-inserts.mjs <skjema.sql> <data.sql> <ut.sql>
import { readFileSync, writeFileSync } from 'node:fs'

const [schemaPath, dataPath, outPath] = process.argv.slice(2)
if (!outPath) {
  console.error('bruk: reorder-inserts.mjs <skjema.sql> <data.sql> <ut.sql>')
  process.exit(1)
}

// FK-graf fra skjemaet: tabell → tabeller den refererer til.
const schema = readFileSync(schemaPath, 'utf8')
const deps = new Map()
const tableRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\);/g
let m
while ((m = tableRe.exec(schema))) {
  const [, table, body] = m
  const refs = new Set()
  const refRe = /REFERENCES\s+[`"]?(\w+)[`"]?/gi
  let r
  while ((r = refRe.exec(body))) {
    if (r[1] !== table) refs.add(r[1])
  }
  deps.set(table, refs)
}

// Kahns algoritme. Skulle grafen ha en sykel, legges resten bakerst i
// alfabetisk rekkefølge — da er vi ikke verre stilt enn før sorteringen.
const order = []
const pending = new Map(
  [...deps].map(([t, refs]) => [t, new Set([...refs].filter((x) => deps.has(x)))]),
)
while (pending.size > 0) {
  const ready = [...pending]
    .filter(([, refs]) => refs.size === 0)
    .map(([t]) => t)
    .sort()
  if (ready.length === 0) {
    order.push(...[...pending.keys()].sort())
    break
  }
  for (const t of ready) {
    order.push(t)
    pending.delete(t)
  }
  for (const refs of pending.values()) for (const t of ready) refs.delete(t)
}
const rank = new Map(order.map((t, i) => [t, i]))

// Grupper datafilen per tabell. En INSERT kan spenne flere linjer (tekstfelt
// med linjeskift), så linjer uten INSERT-prefiks henger på forrige setning.
const head = []
const groups = new Map()
let current = null
for (const line of readFileSync(dataPath, 'utf8').split('\n')) {
  const im = /^INSERT INTO [`"]?(\w+)[`"]?/.exec(line)
  if (im) {
    current = im[1]
    if (!groups.has(current)) groups.set(current, [])
    groups.get(current).push(line)
  } else if (current !== null && line.trim() !== '') {
    const g = groups.get(current)
    g[g.length - 1] += '\n' + line
  } else if (current === null && line.trim() !== '') {
    head.push(line)
  }
}

const sortedTables = [...groups.keys()].sort(
  (a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
)
const out = [
  ...head,
  ...sortedTables.flatMap((t) => groups.get(t)),
  '', // avsluttende linjeskift
].join('\n')
writeFileSync(outPath, out)
console.log(
  `Sorterte INSERT-er for ${sortedTables.length} tabeller i FK-rekkefølge (${order.length} tabeller i skjemaet).`,
)
