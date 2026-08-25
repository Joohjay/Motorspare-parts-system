#!/usr/bin/env bash
# JM SPAREPARTS — Database backup script
# Usage: ./scripts/backup.sh
#
# Creates a compressed PostgreSQL backup with timestamp.
# Requires pg_dump (PostgreSQL client tools).
#
# Environment variables (override defaults):
#   DB_HOST     (default: localhost)
#   DB_PORT     (default: 5432)
#   DB_NAME     (default: makire_motorparts)
#   DB_USER     (default: makire)
#   BACKUP_DIR  (default: ./backups)

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-makire_motorparts}"
DB_USER="${DB_USER:-makire}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "Backing up $DB_NAME to $BACKUP_FILE ..."

pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -Fc \
  -f "$BACKUP_FILE"

echo "Backup complete: $BACKUP_FILE"
echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Cleanup backups older than 30 days
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +30 -delete 2>/dev/null || true
echo "Old backups (>30 days) cleaned up."
