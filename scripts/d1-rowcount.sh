#!/usr/bin/env bash
# Radtelling per tabell i en D1-database (remote): «tabell antall» per linje.
#
# Én SELECT count(*) per tabell, men sendt som separate setninger i ÉN
# wrangler-kjøring — D1 tåler ikke lange UNION-kjeder, og én kjøring per tabell
# er for tregt i CI. Brukes av deploy-workflowen før/etter migrering, sammen
# med scripts/compare-rowcounts.mjs.
#
# Bruk: scripts/d1-rowcount.sh <database-navn>
set -euo pipefail
DB="${1:?bruk: d1-rowcount.sh <database-navn>}"

# Leser wrangler sin --json-utskrift fra stdin og skriver én rad per resultat.
# Hopper frem til første «[» i tilfelle wrangler skriver en banner først.
parse() {
  node -e '
    let s = require("fs").readFileSync(0, "utf8")
    s = s.slice(s.indexOf("["))
    for (const row of JSON.parse(s).flatMap((r) => r.results)) {
      console.log(Object.values(row).join(" "))
    }
  '
}

TABLES=$(pnpm exec wrangler d1 execute "$DB" --remote --json --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\' AND name NOT LIKE '\_cf\_%' ESCAPE '\' AND name != 'd1_migrations' ORDER BY name" | parse)

SQL=""
while IFS= read -r t; do
  [ -z "$t" ] && continue
  SQL+="SELECT '$t' AS tbl, count(*) AS n FROM \"$t\";"
done <<<"$TABLES"

pnpm exec wrangler d1 execute "$DB" --remote --json --command "$SQL" | parse
