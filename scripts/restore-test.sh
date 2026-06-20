#!/usr/bin/env bash
#
# restore-test.sh — gjenoppretter en D1-SQL-dump til en fersk SQLite-database og
# verifiserer at den faktisk lar seg gjenopprette.
#
# «En backup man ikke har testet er et håp, ikke en backup.» Dette scriptet
# laster dumpen inn i en helt tom database, kjører integritetssjekker og skriver
# ut tabeller + radtall, slik at vi vet at dumpen er komplett og konsistent.
#
# Bruk:
#   scripts/restore-test.sh sti/til/dump.sql        # test en lokal dumpfil
#   scripts/restore-test.sh --r2-key backups/tb-notearkiv-2026-06-21T0400Z.sql
#   scripts/restore-test.sh --r2-key <key> --remote # hent fra prod-R2 i stedet for lokal
#   scripts/restore-test.sh --keep dump.sql         # behold den gjenopprettede databasen
#
# Krever: sqlite3 (følger med macOS/Linux). For --r2-key kreves wrangler.
set -euo pipefail

BUCKET="tb-notearkiv-files"
KEEP=0
REMOTE_FLAG="--local"
R2_KEY=""
DUMP=""

die() { echo "❌ $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --remote) REMOTE_FLAG="--remote"; shift ;;
    --r2-key) R2_KEY="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) die "Ukjent flagg: $1" ;;
    *) DUMP="$1"; shift ;;
  esac
done

command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 mangler — installer det først (brew install sqlite / apt install sqlite3)."

WORKDIR="$(mktemp -d)"
cleanup() { [[ "$KEEP" -eq 1 ]] || rm -rf "$WORKDIR"; }
trap cleanup EXIT

# Hent dumpen fra R2 hvis en nøkkel er oppgitt.
if [[ -n "$R2_KEY" ]]; then
  command -v wrangler >/dev/null 2>&1 || command -v pnpm >/dev/null 2>&1 \
    || die "wrangler/pnpm mangler — kan ikke hente fra R2."
  DUMP="$WORKDIR/$(basename "$R2_KEY")"
  echo "→ Henter $R2_KEY fra R2 ($REMOTE_FLAG) …"
  if command -v wrangler >/dev/null 2>&1; then
    wrangler r2 object get "$BUCKET/$R2_KEY" --file "$DUMP" "$REMOTE_FLAG"
  else
    pnpm exec wrangler r2 object get "$BUCKET/$R2_KEY" --file "$DUMP" "$REMOTE_FLAG"
  fi
fi

[[ -n "$DUMP" ]] || die "Oppgi en dumpfil eller --r2-key. Se --help."
[[ -f "$DUMP" ]] || die "Finner ikke dumpfilen: $DUMP"

DB="$WORKDIR/restore-test.sqlite"
echo "→ Gjenoppretter $(basename "$DUMP") ($(wc -c <"$DUMP" | tr -d ' ') bytes) til en fersk database …"

# 1) Last dumpen. Feil her (syntaks, brutt setning) gir exit != 0 og stopper testen.
if ! sqlite3 "$DB" <"$DUMP" 2>"$WORKDIR/load.err"; then
  echo "--- sqlite3-feil ---" >&2; cat "$WORKDIR/load.err" >&2
  die "Dumpen kunne ikke lastes — backupen er IKKE gjenopprettbar."
fi

# 2) Integritetssjekk.
INTEGRITY="$(sqlite3 "$DB" 'PRAGMA integrity_check;')"
[[ "$INTEGRITY" == "ok" ]] || die "integrity_check feilet: $INTEGRITY"

# 3) Fremmednøkkel-konsistens (skal være tom).
FK_VIOLATIONS="$(sqlite3 "$DB" 'PRAGMA foreign_key_check;' || true)"
if [[ -n "$FK_VIOLATIONS" ]]; then
  echo "⚠️  Fremmednøkkelbrudd funnet:" >&2; echo "$FK_VIOLATIONS" >&2
  die "foreign_key_check fant brudd."
fi

# 4) Tabeller + radtall.
echo
echo "Tabell                         Rader"
echo "------------------------------ --------"
TABLE_COUNT=0
TOTAL_ROWS=0
while IFS= read -r t; do
  [[ -z "$t" ]] && continue
  n="$(sqlite3 "$DB" "SELECT count(*) FROM \"$t\";")"
  printf '%-30s %8s\n' "$t" "$n"
  TABLE_COUNT=$((TABLE_COUNT + 1))
  TOTAL_ROWS=$((TOTAL_ROWS + n))
done < <(sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")

# 5) Sjekk at kjernetabellene faktisk finnes i den gjenopprettede databasen.
MISSING=""
for core in works work_files parts user roles member_profiles projects; do
  exists="$(sqlite3 "$DB" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='$core' LIMIT 1;")"
  [[ "$exists" == "1" ]] || MISSING="$MISSING $core"
done
[[ -z "$MISSING" ]] || die "Mangler kjernetabeller:$MISSING"

echo "------------------------------ --------"
printf '%-30s %8s\n' "SUM ($TABLE_COUNT tabeller)" "$TOTAL_ROWS"
echo
echo "✅ Restore-test OK — dumpen er gjenopprettbar (integrity_check=ok, ingen FK-brudd, kjernetabeller til stede)."
[[ "$KEEP" -eq 1 ]] && echo "   Database beholdt: $DB"
exit 0
