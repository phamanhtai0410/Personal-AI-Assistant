#!/usr/bin/env bash
# Daily backup of vault + sqlite. Intended for cron or systemd timer.
set -euo pipefail

PAI_DATA="${PAI_DATA:-/var/lib/pai}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/pai}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT}/${STAMP}"

mkdir -p "$DEST"
cp -a "${PAI_DATA}/vault" "$DEST/vault"
if [[ -f "${PAI_DATA}/data/pai.db" ]]; then
  sqlite3 "${PAI_DATA}/data/pai.db" ".backup '${DEST}/pai.db'"
fi

# Keep last 14 backups
ls -1dt "${BACKUP_ROOT}"/* 2>/dev/null | tail -n +15 | xargs -r rm -rf

echo "Backup written to ${DEST}"
