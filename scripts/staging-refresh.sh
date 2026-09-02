#!/usr/bin/env bash
# Fyller staging-databasen (tb-notearkiv-staging) med en FERSK kopi av prod.
# Prod leses bare (d1 export); alt innhold i staging slettes og erstattes.
#
# Filbucketen (R2) kopieres IKKE — filsider i staging kan derfor mangle selve
# PDF-en/bildet. Det er et bevisst valg: kopien ville doblet lagringen og
# krever S3-nøkler. Trengs filene, kjør en engangs rclone-synk (se README).
#
# Bruk: pnpm run staging:refresh
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-3709ec57046e3f629f737cf5b6b88a82}"

DUMP=$(mktemp /tmp/tb-staging-refresh-XXXXXX.sql)
SCHEMA="$DUMP.schema"
DATA="$DUMP.data"
DROPS="$DUMP.drop"
trap 'rm -f "$DUMP" "$SCHEMA" "$DATA" "$DROPS"' EXIT

# Skjema og data eksporteres HVER FOR SEG og kjøres i den rekkefølgen. Én samlet
# dump virker ikke: eksporten legger CREATE TABLE alfabetisk, så en INSERT kan
# treffe en tabell hvis FOREIGN KEY peker på en tabell som ikke finnes ennå
# («no such table» — defer_foreign_keys hjelper bare mot brutte rader, ikke mot
# referanser til tabeller som mangler).
echo "→ Eksporterer prod (kun lesing) ..."
pnpm exec wrangler d1 export tb-notearkiv --remote --no-data --output "$SCHEMA"
pnpm exec wrangler d1 export tb-notearkiv --remote --no-schema --output "$DATA"
[ -s "$SCHEMA" ] && [ -s "$DATA" ] || { echo "STOPP: eksporten ble tom — avbryter uten å røre staging." >&2; exit 1; }
grep -q "defer_foreign_keys" "$DATA" || {
  printf 'PRAGMA defer_foreign_keys=TRUE;\n' | cat - "$DATA" >"$DATA.tmp" && mv "$DATA.tmp" "$DATA"
}
# INSERT-ene må i FK-avhengighetsrekkefølge — se kommentaren i reorder-inserts.mjs.
node scripts/reorder-inserts.mjs "$SCHEMA" "$DATA" "$DATA.sorted"
mv "$DATA.sorted" "$DATA"

# Med FK-håndheving på må barn droppes før foreldre («no such table» ellers,
# når barnets FOREIGN KEY peker på en allerede droppet tabell). Vi henter derfor
# stagings eget skjema og dropper i omvendt FK-rekkefølge; views først.
echo "→ Tømmer staging ..."
STAGING_SCHEMA="$DUMP.stagingschema"
pnpm exec wrangler d1 execute tb-notearkiv-staging --remote --json --command \
  "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite\_%' ESCAPE '\' AND name NOT LIKE '\_cf\_%' ESCAPE '\'" | node -e '
    let s = require("fs").readFileSync(0, "utf8")
    s = s.slice(s.indexOf("["))
    const rows = JSON.parse(s).flatMap((r) => r.results)
    const views = rows.filter((r) => r.type === "view").map((r) => r.name)
    const tables = rows.filter((r) => r.type === "table")
    require("fs").writeFileSync(process.argv[1], tables.map((r) => r.sql + ";").join("\n"))
    require("fs").writeFileSync(process.argv[2], views.join("\n"))
  ' "$STAGING_SCHEMA" "$DROPS.views"
{
  echo "PRAGMA defer_foreign_keys = true;"
  while IFS= read -r v; do
    [ -n "$v" ] && echo "DROP VIEW IF EXISTS \"$v\";"
  done <"$DROPS.views"
  node scripts/fk-order.mjs "$STAGING_SCHEMA" |
    awk '{ a[NR] = $0 } END { for (i = NR; i >= 1; i--) print a[i] }' |
    while IFS= read -r t; do
      [ -n "$t" ] && echo "DROP TABLE IF EXISTS \"$t\";"
    done
} >"$DROPS"
rm -f "$STAGING_SCHEMA" "$DROPS.views"
pnpm exec wrangler d1 execute tb-notearkiv-staging --remote --file "$DROPS" -y

echo "→ Importerer prod-kopien i staging (skjema, så data) ..."
pnpm exec wrangler d1 execute tb-notearkiv-staging --remote --file "$SCHEMA" -y
pnpm exec wrangler d1 execute tb-notearkiv-staging --remote --file "$DATA" -y

# Grenen kan ligge foran prod på migrasjoner; ta igjen det som mangler.
echo "→ Anvender eventuelle nyere migrasjoner fra denne grenen ..."
pnpm exec wrangler d1 migrations apply tb-notearkiv-staging --env staging --remote

echo "✓ Staging har nå en fersk prod-kopi."
