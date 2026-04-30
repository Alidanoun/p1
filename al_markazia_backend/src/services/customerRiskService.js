
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const TokenService = require('./tokenService');

/**
 * Enterprise Customer Risk Intelligence System (Refined)
 * Focused on Compliance, Single Source of Truth, and Forensics.
 */
class CustomerRiskService {
  
  /**
   * Guard Layer: RBAC Severity Matrix
   */
  canPerformAction(role, severity) {
    const matrix = {
      'admin': ['LOW'],
      'super_admin': ['LOW', 'MEDIUM', 'HIGH']
    };
    return (matrix[role] || []).includes(severity);
  }

  /**
   * Single Source of Truth for Blacklist Expiry
   */
  getEffectiveExpiry(customer) {
    if (!customer) return null;
    return customer.blacklistExpiresAt || customer.blacklistUntil;
  }

  async evaluateCustomerStatus(customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        _count: {
          select: { orders: { where: { status: 'cancelled' } } }
        }
      }
    });

    if (!customer) return null;

    const { score, breakdown } = this.calculateRiskScore(customer);
    const now = new Date();
    const effectiveExpiry = this.getEffectiveExpiry(customer);
    const isCurrentlyBlacklisted = customer.isBlacklisted && 
      (!effectiveExpiry || effectiveExpiry > now);

    // Persist Cache/Snapshot
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        riskScore: score,
        riskScoreUpdatedAt: new Date()
      }
    });

    return {
      ...customer,
      riskScore: score,
      riskScoreBreakdown: JSON.stringify(breakdown), // Structured for UI analytics
      isCurrentlyBlacklisted,
      effectiveExpiry,
      status: isCurrentlyBlacklisted ? (effectiveExpiry ? 'TEMPORARY' : 'ACTIVE') : 'CLEAR'
    };
  }

  calculateRiskScore(customer) {
    let score = 0;
    const breakdown = {
      cancellations: 0,
      severity: 0,
      frequency: 0
    };
    
    // 1. Cancellations (Max 50)
    const cancelCount = customer.cancellationCount || 0;
    breakdown.cancellations = Math.min(cancelCount * 10, 50);
    score += breakdown.cancellations;

    // 2. Severity History (Max 30)
    if (customer.isBlacklisted) {
      const severityMap = { 'LOW': 10, 'MEDIUM': 20, 'HIGH': 30 };
      breakdown.severity = severityMap[customer.blacklistSeverity] || 10;
      score += breakdown.severity;
    }

    // 3. Frequency / Recency placeholder (Max 20)
    // could be based on order rate etc.
    breakdown.frequency = 0; 
    score += breakdown.frequency;

    return { score: Math.min(score, 100), breakdown };
  }

  async blockCustomer(customerId, adminData, blockDetails) {
    const { email: adminEmail, role: adminRole, requestId, ip, userAgent, requestSource } = adminData;
    const { reason, reasonCode, severity, durationDays, source = 'MANUAL' } = blockDetails;

    // 1. Guard Layer Check
    if (!this.canPerformAction(adminRole, severity)) {
      throw new Error(`غير مصرح لك بفرض حظر بمستوى ${severity} لهذه الرتبة`);
    }

    const expiresAt = durationDays ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000) : null;

    return await prisma.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({ where: { id: customerId } });
      if (!current) throw new Error('العميل غير موجود');

      // Update Customer (Dual-field legacy sync)
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: {
          isBlacklisted: true,
          blacklistedAt: new Date(),
          blacklistExpiresAt: expiresAt,
          blacklistUntil: expiresAt, // Compatibility layer
          blacklistReason: reason,
          blacklistReasonCode: reasonCode,
          blacklistSeverity: severity,
          blacklistSource: source,
          blacklistedBy: adminEmail,
          riskScoreUpdatedAt: new Date()
        }
      });
      // Forensic Audit Log
      await tx.customerAuditLog.create({
        data: {
          customerId,
          eventType: source === 'AUTO' ? 'BLACKLIST_AUTO' : 'BLACKLIST_MANUAL',
          eventAction: 'BLOCKED',
          changedBy: adminEmail,
          changedByRole: adminRole,
          reason: reason,
          previousData: JSON.stringify({ isBlacklisted: current.isBlacklisted, severity: current.blacklistSeverity }),
          newData: JSON.stringify({ isBlacklisted: true, severity, expiresAt }),
          diff: `Severity -> ${severity}, Source -> ${source}`,
          severitySnapshot: severity,
          requestId,
          actionCategory: 'RISK_MANAGEMENT',
          ip,
          userAgent,
          requestSource
        }
      });

      // 🛡️ [CRITICAL] Immediate Session Invalidation
      await TokenService.revokeAllSessions(current.uuid);

      return updated;
    });
  }

  async unblockCustomer(customerId, adminData, reason) {
    const { email: adminEmail, role: adminRole, requestId, ip, userAgent, requestSource } = adminData;

    return await prisma.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({ where: { id: customerId } });
      if (!current) throw new Error('العميل غير موجود');

      const updated = await tx.customer.update({
        where: { id: customerId },
        data: {
          isBlacklisted: false,
          blacklistExpiresAt: null,
          blacklistUntil: null, // Compatibility layer
          blacklistReason: null,
          blacklistReasonCode: null,
          blacklistSource: null,
          blacklistedBy: null,
          blacklistSeverity: 'LOW',
          riskScoreUpdatedAt: new Date()
        }
      });

      await tx.customerAuditLog.create({
        data: {
          customerId,
          eventType: 'UNBLOCK_MANUAL',
          eventAction: 'UNBLOCKED',
          changedBy: adminEmail,
          changedByRole: adminRole,
          reason: reason,
          previousData: JSON.stringify({ isBlacklisted: current.isBlacklisted }),
          newData: JSON.stringify({ isBlacklisted: false }),
          severitySnapshot: current.blacklistSeverity,
          requestId,
          actionCategory: 'RISK_MANAGEMENT',
          ip,
          userAgent,
          requestSource
        }
      });

      return updated;
    });
  }
}

module.exports = new CustomerRiskService();
