// Skriver tabellnavnene fra et SQL-skjema i FK-avhengighetsrekkefølge
// (foreldre først), én per linje. Brukes av staging-refresh.sh til å droppe
// tabeller i OMVENDT rekkefølge: med FK-håndheving på må barn droppes før
// foreldre, ellers feiler DROP av barnet med «no such table» når forelderen
// alt er borte. Ved en sykel legges resten bakerst alfabetisk.
//
// Bruk: node scripts/fk-order.mjs <skjema.sql>
import { readFileSync } from 'node:fs'

const schema = readFileSync(process.argv[2], 'utf8')
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
console.log(order.join('\n'))
