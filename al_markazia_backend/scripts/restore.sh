#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# ♻️ AL-MARKAZIA DATABASE DISASTER RECOVERY & RESTORE SUITE
# Restores specific point-in-time snapshot files natively via 'docker exec'.
# Seamlessly pulls remote archives from AWS S3 if specified.
# ═════════════════════════════════════════════════════════════════════════════

set +x
set -euo pipefail

BACKUP_DIR="${BACKUP_ROOT_DIR:-/usr/src/app/backups}"
DB_CONTAINER="${POSTGRES_CONTAINER:-al-markazia-db}"
DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-al_markazia_db}"

echo "═════════════════════════════════════════════════════════════════════════════"
echo "🚨 AL-MARKAZIA DISASTER RECOVERY PIPELINE"
echo "═════════════════════════════════════════════════════════════════════════════"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <local_filename_or_s3_path>"
  echo "Examples:"
  echo "  $0 dump_al_markazia_db_20260513_020000.sql.gz"
  echo "  $0 s3://al-markazia-db-backups/dump_al_markazia_db_20260513_020000.sql.gz"
  exit 1
fi

INPUT_SOURCE="$1"
LOCAL_ARCHIVE="${BACKUP_DIR}/target_restore.sql.gz"

mkdir -p "${BACKUP_DIR}"

# ─── 📥 Source Resolution (S3 vs Local Archive) ───────────────────────────────
if [[ "${INPUT_SOURCE}" == s3://* ]]; then
  echo "[📥 Fetching] Pulling secure remote payload from S3 vault: ${INPUT_SOURCE}..."
  aws s3 cp "${INPUT_SOURCE}" "${LOCAL_ARCHIVE}"
else
  if [ -f "${INPUT_SOURCE}" ]; then
    cp "${INPUT_SOURCE}" "${LOCAL_ARCHIVE}"
  elif [ -f "${BACKUP_DIR}/${INPUT_SOURCE}" ]; then
    cp "${BACKUP_DIR}/${INPUT_SOURCE}" "${LOCAL_ARCHIVE}"
  else
    echo "❌ CRITICAL: Snapshot input path not found locally: ${INPUT_SOURCE}"
    exit 1
  fi
fi

if [ ! -s "${LOCAL_ARCHIVE}" ]; then
  echo "❌ CRITICAL: Target archive payload is empty or invalid. Aborting."
  exit 1
fi

echo "[⚠️ WARNING] This sequence drops all physical schema state inside database: ${DB_NAME}!"
read -p "Type 'RESTORE' to authorize execution: " CONFIRMATION
if [ "${CONFIRMATION}" != "RESTORE" ]; then
  echo "❌ Operation cancelled by administrator."
  rm -f "${LOCAL_ARCHIVE}"
  exit 0
fi

# ─── 🧹 Topology Reset & Decompression Pipeline ───────────────────────────────
echo "[🧹 Resetting] Dropping current database schema topology to prevent object conflicts..."
docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "[♻️ Restoring] Streaming decompressed archive natively into container instance..."
gunzip -c "${LOCAL_ARCHIVE}" | docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}"

# Cleanup transient extraction targets
rm -f "${LOCAL_ARCHIVE}"

echo "🎉 Point-in-time recovery achieved perfectly. Verify telemetry metrics."
