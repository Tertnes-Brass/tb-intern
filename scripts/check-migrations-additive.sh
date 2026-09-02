#!/usr/bin/env bash
# Vokter for automatisk deploy: ventende migrasjoner skal være ADDITIVE
# (ingen DROP/DELETE/TRUNCATE — den stående deploy-avtalen). Feiler hvis en
# fil ser destruktiv ut, med mindre den er eksplisitt godkjent med en linje
#   -- godkjent-destruktiv: <hvorfor dette er trygt>
# et sted i filen. Grep-en er bevisst streng og kan slå ut på kommentarer —
# den feiler da til trygg side, og markøren over slipper filen gjennom.
#
# Bruk: scripts/check-migrations-additive.sh <fil.sql> [flere ...]
set -euo pipefail
STATUS=0
for f in "$@"; do
  if grep -qiE '(^|[^a-z_])(drop[[:space:]]+(table|column|index|view|trigger)|delete[[:space:]]+from|truncate)([[:space:]]|$)' "$f"; then
    if grep -qi -- '-- *godkjent-destruktiv' "$f"; then
      echo "ADVARSEL: $f inneholder destruktive setninger, men er eksplisitt godkjent." >&2
    else
      echo "STOPP: $f inneholder destruktive setninger (DROP/DELETE/TRUNCATE)." >&2
      echo "Automatisk deploy krever additive migrasjoner. Er endringen bevisst og" >&2
      echo "avklart, legg til linjen «-- godkjent-destruktiv: <hvorfor>» i filen." >&2
      STATUS=1
    fi
  fi
done
exit $STATUS
