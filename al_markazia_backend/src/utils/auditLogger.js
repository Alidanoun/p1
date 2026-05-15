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
    // 1. Detect changed fields
      const changedFields = this.getChangedFields(previousData, newData);

      // 2. Prepare stringified data
      const prevDataStr = previousData ? JSON.stringify(previousData) : null;
      const newDataStr = newData ? JSON.stringify(newData) : null;
      const changedFieldsStr = JSON.stringify(changedFields);

      // 3. 🔐 Implement Hash Chaining (Blockchain-lite)
      // Fetch the last entry's hash to chain this one to it.
      const lastEntry = await tx.orderAuditLog.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
        select: { integrityHash: true }
      });
      const previousHash = lastEntry?.integrityHash || 'GENESIS';

      // 4. Create Integrity Hash (SHA256) - including previousHash for chaining
      const hashInput = `${orderId}-${prevDataStr}-${newDataStr}-${previousHash}`;
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // 5. Insert Audit Log
      // [COMPLIANCE-FIX] We NO LONGER swallow errors. 
      // Audit must be part of the atomic transaction. If audit fails, transaction MUST roll back.
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
          integrityHash: hash,
          previousHash: previousHash
        }
      });
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
