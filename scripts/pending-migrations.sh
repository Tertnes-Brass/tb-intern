#!/usr/bin/env bash
# Skriver ut stien til migrasjonsfiler i migrations/ som ennå ikke er anvendt i
# den oppgitte databasen (én per linje; tom utskrift = ingenting venter).
#
# Bruk: scripts/pending-migrations.sh <database-navn>
set -euo pipefail
DB="${1:?bruk: pending-migrations.sh <database-navn>}"

APPLIED=$(pnpm exec wrangler d1 execute "$DB" --remote --json --command \
  "SELECT name FROM d1_migrations" | node -e '
    let s = require("fs").readFileSync(0, "utf8")
    s = s.slice(s.indexOf("["))
    for (const row of JSON.parse(s).flatMap((r) => r.results)) console.log(row.name)
  ')

for f in migrations/*.sql; do
  base=$(basename "$f")
  grep -qxF "$base" <<<"$APPLIED" || echo "$f"
done
