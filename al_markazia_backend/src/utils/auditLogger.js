const crypto = require('crypto');

/**
 * Enhanced Audit Logger for Orders
 * Implements Full Snapshot, Changed Fields detection, and Integrity Hashing.
 */
class AuditLogger {
  
  /**
   * Logs a change to an order within a Prisma transaction
   * @param {object} tx - Prisma Transaction object
   * @param {object} params - Log parameters
   */
  static async logOrderChange(tx, {
    orderId,
    eventType,
    eventAction,
    changedBy,
    changedByRole,
    previousData = null,
    newData = null,
    rejectionReason = null
  }) {
    try {
      // 1. Detect changed fields
      const changedFields = this.getChangedFields(previousData, newData);

      // 2. Prepare stringified data
      const prevDataStr = previousData ? JSON.stringify(previousData) : null;
      const newDataStr = newData ? JSON.stringify(newData) : null;
      const changedFieldsStr = JSON.stringify(changedFields);

      // 3. Create Integrity Hash (SHA256)
      const hashInput = `${orderId}-${prevDataStr}-${newDataStr}-${Date.now()}`;
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // 4. Insert Audit Log
      await tx.orderAuditLog.create({
        data: {
          orderId,
          eventType,
          eventAction,
          changedBy: String(changedBy),
          changedByRole,
          previousData: prevDataStr,
          newData: newDataStr,
          changedFields: changedFieldsStr,
          rejectionReason,
          integrityHash: hash
        }
      });
    } catch (error) {
      // We don't want to break the main transaction if logging fails, 
      // but we should log it to the console/logger
      console.error('Audit Logging Failed:', error.message);
    }
  }

  /**
   * Compares two objects and returns array of changed keys
   */
  static getChangedFields(prev, next) {
    if (!prev) return ['CREATED'];
    if (!next) return ['DELETED'];

    const changes = [];
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

    for (const key of allKeys) {
      // Skip some technical fields from diff
      if (['updatedAt', 'version'].includes(key)) continue;

      if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
        changes.push(key);
      }
    }
    return changes;
  }
}

module.exports = AuditLogger;
