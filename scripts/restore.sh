#!/usr/bin/env bash
# JM SPAREPARTS — Database restore script
# Usage: ./scripts/restore.sh <backup_file.dump>
#
# Restores a PostgreSQL backup to a RECOVERY database (NOT production).
# Always restores to a separate database first for verification.
#
# Environment variables (override defaults):
#   DB_HOST      (default: localhost)
#   DB_PORT      (default: 5432)
#   DB_USER      (default: makire)
#   RECOVERY_DB  (default: makire_motorparts_recovery)

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup_file.dump>"
  echo ""
  echo "Example: $0 ./backups/makire_motorparts_20260825_120000.dump"
  exit 1
fi

BACKUP_FILE="$1"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-makire}"
RECOVERY_DB="${RECOVERY_DB:-makire_motorparts_recovery}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "============================================="
echo "JM SPAREPARTS — Database Restore (Recovery)"
echo "============================================="
echo ""
echo "Backup file: $BACKUP_FILE"
echo "Recovery database: $RECOVERY_DB"
echo ""

# Step 1: Create recovery database (drop if exists)
echo "[1/3] Creating recovery database..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
  "DROP DATABASE IF EXISTS $RECOVERY_DB;" 2>/dev/null || true
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
  "CREATE DATABASE $RECOVERY_DB;"

# Step 2: Restore backup
echo "[2/3] Restoring backup..."
pg_restore \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$RECOVERY_DB" \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE"

# Step 3: Verify
echo "[3/3] Verifying restore..."
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$RECOVERY_DB" -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "  Tables found: $TABLE_COUNT"

USER_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$RECOVERY_DB" -t -c \
  "SELECT count(*) FROM users;")
echo "  Users found: $USER_COUNT"

echo ""
echo "============================================="
echo "Restore complete!"
echo "============================================="
echo ""
echo "Recovery database: $RECOVERY_DB"
echo ""
echo "To verify with the application:"
echo "  1. Update server/.env DATABASE_URL to point to $RECOVERY_DB"
echo "  2. Start the server: npm start"
echo "  3. Test login and data integrity"
echo "  4. Restore DATABASE_URL to production"
echo ""
echo "To clean up recovery database:"
echo "  psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c 'DROP DATABASE $RECOVERY_DB;'"
