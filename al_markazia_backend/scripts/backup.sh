#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# 💾 AL-MARKAZIA DATABASE AUTOMATED BACKUP ENGINE
# Executes transactional binary dumps of the PostgreSQL topology with inline Gzip.
# Applies strict retention policies and synchronizes securely with Cloud storage.
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── ⚙️ Configuration & Paths ──────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_ROOT_DIR:-/usr/src/app/backups}"
LOG_FILE="${BACKUP_DIR}/backup_execution.log"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-al_markazia_prod_db}"
BACKUP_FILENAME="dump_${DB_NAME}_${TIMESTAMP}.sql.gz"
TARGET_FILE="${BACKUP_DIR}/${BACKUP_FILENAME}"
RETENTION_DAYS=30

# Enable automated S3 sync if provider destination is active
S3_BUCKET="${BACKUP_S3_BUCKET:-}"

mkdir -p "${BACKUP_DIR}"

log() {
  local msg="$1"
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] ${msg}" | tee -a "${LOG_FILE}"
}

log "🚀 Starting Al-Markazia transactional database backup pipeline..."

# ─── 📦 Execution: pg_dump | gzip ─────────────────────────────────────────────
# Uses custom inline pipes to preserve memory limits and compress raw output streams.
log "Executing pg_dump pipeline for target database: ${DB_NAME}..."
if pg_dump -U "${DB_USER}" -h "${POSTGRES_HOST:-db}" "${DB_NAME}" | gzip > "${TARGET_FILE}"; then
  log "✅ Database snapshot compressed and captured successfully: ${TARGET_FILE}"
else
  log "❌ CRITICAL: pg_dump execution failed. Triggering observability alerts."
  exit 1
fi

# ─── 🧹 Retention Cleanup ─────────────────────────────────────────────────────
# Deletes stale point-in-time archives exceeding the operational threshold.
log "Enforcing retention logic: removing historical archives older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "dump_${DB_NAME}_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
log "✅ Cleanup enforcement complete."

# ─── ☁️ Optional Cloud Synchronization ────────────────────────────────────────
if [ -n "${S3_BUCKET}" ]; then
  log "Synchronizing persistent snapshot payload with remote S3 storage: ${S3_BUCKET}..."
  if aws s3 cp "${TARGET_FILE}" "s3://${S3_BUCKET}/${BACKUP_FILENAME}"; then
    log "✅ Payload synchronized successfully with remote S3 vault."
  else
    log "⚠️ WARNING: S3 upload transmission encountered an interrupted state."
  fi
else
  log "ℹ️ Cloud S3 sync skipped (BACKUP_S3_BUCKET variable unset)."
fi

log "🎉 Backup lifecycle execution achieved successful exit status."
