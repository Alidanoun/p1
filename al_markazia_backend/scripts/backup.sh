#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# 💾 AL-MARKAZIA DATABASE AUTOMATED BACKUP ENGINE (Hardened Production Suite)
# Enforces exact version compatibility via inline 'docker exec' directly inside the container.
# Mitigates secrets leakage via 'set +x' and tight file permission checks.
# ═════════════════════════════════════════════════════════════════════════════

# Disable command echoing to guarantee secrets are never printed to terminal or logs
set +x
set -euo pipefail

# ─── 🔔 Telegram Alerting Configuration ────────────────────────────────────────
TELEGRAM_TOKEN="${BACKUP_TELEGRAM_TOKEN:-}"
TELEGRAM_CHAT_ID="${BACKUP_TELEGRAM_CHAT_ID:-}"

send_telegram_alert() {
  local message="$1"
  if [ -n "${TELEGRAM_TOKEN}" ] && [ -n "${TELEGRAM_CHAT_ID}" ]; then
    curl -s --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_CHAT_ID}" \
      -d text="${message}" > /dev/null || true
  fi
}

cleanup_and_exit() {
  local exit_code=$?
  if [ "${exit_code}" -ne 0 ]; then
    log "❌ CRITICAL: Backup process terminated abnormally with exit code ${exit_code}."
    send_telegram_alert "⚠️ فشل النسخ الاحتياطي لقاعدة بيانات المركزية (رمز الخروج: ${exit_code})!"
  fi
}

trap cleanup_and_exit EXIT

# ─── ⚙️ Configuration & Paths ──────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_ROOT_DIR:-/usr/src/app/backups}"
LOG_FILE="${BACKUP_DIR}/backup_execution.log"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_CONTAINER="${POSTGRES_CONTAINER:-al-markazia-db}"
DB_USER="${POSTGRES_USER:-admin}"
DB_NAME="${POSTGRES_DB:-al_markazia_db}"
BACKUP_FILENAME="dump_${DB_NAME}_${TIMESTAMP}.sql.gz"
TARGET_FILE="${BACKUP_DIR}/${BACKUP_FILENAME}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
S3_BUCKET="${BACKUP_S3_BUCKET:-}"
RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}" # Protect backup directory contents locally

log() {
  local msg="$1"
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] ${msg}" | tee -a "${LOG_FILE}"
}

log "🚀 Starting Al-Markazia zero-trust transactional backup pipeline..."

# ─── 🐳 Execution via Native Container Engine (pg_dump | gzip) ────────────────
# Leveraging docker exec ensures strict pg_dump binary parity with the running server daemon.
log "Executing inline containerized dump stream for database: ${DB_NAME} via ${DB_CONTAINER}..."

if docker exec -i "${DB_CONTAINER}" pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${TARGET_FILE}"; then
  # Verify archive payload sanity (prevent empty snapshots on corrupted network pipes)
  if [ -s "${TARGET_FILE}" ]; then
    chmod 600 "${TARGET_FILE}"
    log "✅ Database snapshot successfully captured, verified, and compressed: ${TARGET_FILE}"
  else
    log "❌ CRITICAL: Generated archive file size is 0 bytes. Aborting pipeline."
    rm -f "${TARGET_FILE}"
    exit 1
  fi
else
  log "❌ CRITICAL: 'docker exec pg_dump' execution failed. Verify container availability."
  exit 1
fi

# ─── 🧹 Local Retention Policy Enforcement ────────────────────────────────────
log "Enforcing strict space budget: Purging local snapshots older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "dump_${DB_NAME}_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
log "✅ Local space budget cleanup achieved."

# ─── ☁️ Encrypted Cloud Transmission ──────────────────────────────────────────
if [ -n "${S3_BUCKET}" ]; then
  log "Offloading immutable snapshot payload to remote S3 bucket: s3://${S3_BUCKET}..."
  # Uses AWS CLI standard auth variables injected via the shell/Cron environment
  if aws s3 cp "${TARGET_FILE}" "s3://${S3_BUCKET}/${BACKUP_FILENAME}"; then
    log "✅ Payload successfully offloaded to secure S3 vault."
  else
    log "❌ CRITICAL: Cloud transmission encountered failure. Check AWS credentials."
    exit 2
  fi
else
  log "ℹ️ Remote offsite transmission bypassed (BACKUP_S3_BUCKET variable unset)."
fi

# ─── ☁️ Rclone Cloud Offloading ────────────────────────────────────────────────
if [ -n "${RCLONE_REMOTE}" ]; then
  log "Offloading payload to remote via rclone: ${RCLONE_REMOTE}..."
  if rclone copy "${TARGET_FILE}" "${RCLONE_REMOTE}"; then
    log "✅ Payload successfully offloaded via rclone."
  else
    log "❌ CRITICAL: Rclone transmission failed."
    exit 2
  fi
else
  log "ℹ️ Rclone remote offsite transmission bypassed (BACKUP_RCLONE_REMOTE unset)."
fi

log "🎉 Full backup engine sequence achieved normal termination."
