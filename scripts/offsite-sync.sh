#!/usr/bin/env bash
#
# offsite-sync.sh — speiler R2 (notefiler + SQL-backups) til en uavhengig,
# off-site lokasjon med rclone.
#
# D1 har 30 dagers innebygd point-in-time recovery, og cron-en skriver ukentlige
# SQL-dumper til R2. Men alt ligger fortsatt hos Cloudflare. En off-site kopi
# beskytter mot konto-/region-tap, feilkonfigurasjon og menneskelige feil.
#
# ── Engangsoppsett ────────────────────────────────────────────────────────────
#   1. Installer rclone:   brew install rclone   (eller https://rclone.org/install/)
#
#   2. Lag en R2 S3 API-token i Cloudflare-dashbordet
#      (R2 → Manage R2 API Tokens → Create), med minst lesetilgang til
#      bøtta tb-notearkiv-files. Noter Access Key ID + Secret + Account ID.
#
#   3. Konfigurer rclone-remote "r2" (S3-kompatibel):
#        rclone config create r2 s3 \
#          provider Cloudflare \
#          access_key_id     <R2_ACCESS_KEY_ID> \
#          secret_access_key <R2_SECRET_ACCESS_KEY> \
#          endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
#          acl private
#
#   4. Velg ETT off-site mål:
#      a) Backblaze B2 (gratis inntil 10 GB):
#           rclone config create offsite b2 account <B2_KEY_ID> key <B2_APP_KEY>
#         og kjør med:  OFFSITE="offsite:<b2-bucket>" scripts/offsite-sync.sh
#      b) Lokal disk / NAS:
#           OFFSITE="/Volumes/Backup/tb-notearkiv" scripts/offsite-sync.sh
#
# Kjør manuelt, eller planlegg det (cron/launchd/GitHub Actions) — se README.
set -euo pipefail

# R2-kilden (S3-remote:bøtte). Kan overstyres med miljøvariabel.
R2_REMOTE="${R2_REMOTE:-r2:tb-notearkiv-files}"
# Off-site mål — B2-remote (f.eks. "offsite:min-bucket") eller lokal sti.
OFFSITE="${OFFSITE:-offsite:tb-notearkiv-offsite}"

command -v rclone >/dev/null 2>&1 || {
  echo "❌ rclone mangler — se engangsoppsettet øverst i dette scriptet." >&2
  exit 1
}

echo "→ Off-site-synk: $R2_REMOTE → $OFFSITE"

# 1) SQL-backups: additiv kopi (sletter ALDRI på mål). R2 roterer til 8 uker,
#    men off-site beholder vi alle dumpene — de er små og er livsforsikringen.
echo "  • backups/  (copy — beholder alle dumper off-site)"
rclone copy "$R2_REMOTE/backups" "$OFFSITE/backups" \
  --transfers 8 --checksum --stats-one-line

# 2) Notefiler (PDF-er m.m.): speiling. `sync` gjør målet identisk med kilden,
#    inkludert sletting av filer som er fjernet i R2.
echo "  • notefiler (sync — speiler nåværende R2-innhold, unntatt backups/)"
rclone sync "$R2_REMOTE" "$OFFSITE/files" \
  --exclude "backups/**" \
  --transfers 8 --checksum --stats-one-line

echo "✅ Off-site-kopi fullført $(date '+%Y-%m-%d %H:%M:%S')"
