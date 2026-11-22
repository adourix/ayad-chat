#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/duet-$STAMP.tar.gz"
echo "Stopping Duet briefly for a consistent SQLite backup..."
docker compose stop app
trap 'docker compose start app >/dev/null 2>&1 || true' EXIT
tar -czf "$OUT" data
docker compose start app
trap - EXIT
echo "Backup created: $OUT"
