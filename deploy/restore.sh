#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/duet-backup.tar.gz" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ARCHIVE="$(realpath "$1")"
if [[ ! -f "$ARCHIVE" ]]; then
  echo "Backup file not found: $ARCHIVE" >&2
  exit 1
fi
echo "This will replace the current Duet data directory."
read -r -p "Continue? Type RESTORE to confirm: " CONFIRM
if [[ "$CONFIRM" != "RESTORE" ]]; then
  echo "Restore cancelled."
  exit 0
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose stop app
if [[ -d data ]]; then mv data "data.before-restore-$STAMP"; fi
mkdir -p data
tar -xzf "$ARCHIVE" -C "$ROOT"
sudo chown -R 10001:10001 data
docker compose start app
echo "Restore completed. Previous data saved in data.before-restore-$STAMP (if it existed)."
