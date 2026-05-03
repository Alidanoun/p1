const prisma = require('../lib/prisma');
const accountingService = require('./accountingService');
const financialGuard = require('../utils/financialGuard');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/number');
const { logFinancialEvent } = require('../utils/financialLogger');

/**
 * 🛰️ Financial Approval Service (Control Tower)
 */
class FinancialApprovalService {

  /**
   * 🔍 Calculate Risk Level based on amount and type
   */
  calculateRisk(amount, type) {
    const val = toNumber(amount);
    if (type === 'REFUND' || val > 100) return 'HIGH';
    if (val > 20) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * 📋 List Pending Approvals
   */
  async getPendingApprovals(branchId = null) {
    const where = { status: 'PENDING' };
    if (branchId) where.branchId = branchId;

    const approvals = await prisma.financialApproval.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return approvals.map(app => ({
      ...app,
      riskLevel: this.calculateRisk(app.payload?.delta?.absoluteDifference || 0, app.operationType)
    }));
  }

  /**
   * ✅ Approve Operation
   */
  async approve(approvalId, adminUser, reason = '') {
    return await prisma.$transaction(async (tx) => {
      const approval = await tx.financialApproval.findUnique({
        where: { id: approvalId }
      });

      if (!approval || approval.status !== 'PENDING') {
        throw new Error('APPROVAL_NOT_PENDING_OR_NOT_FOUND');
      }

      // Update Approval Record
      await tx.financialApproval.update({
        where: { id: approvalId },
        data: {
          status: 'APPROVED',
          approvedBy: adminUser.id,
          rejectionReason: reason // Used for comments even in approval
        }
      });

      // 🔄 Update the Source Event (e.g., OrderModificationEvent)
      if (approval.operationType === 'PRICE_OVERRIDE') {
        await tx.orderModificationEvent.update({
          where: { id: approval.entityId },
          data: { status: 'APPROVED' } // Changed from READY_TO_APPLY for clarity
        });
      }

      logger.info('💎 FINANCIAL_APPROVAL_GRANTED', {
        approvalId,
        adminId: adminUser.id,
        operation: approval.operationType
      });

      return { success: true, approvalId };
    });
  }

  /**
   * ❌ Reject Operation
   */
  async reject(approvalId, adminUser, reason) {
    if (!reason) throw new Error('REJECTION_REASON_REQUIRED');

    await prisma.$transaction(async (tx) => {
      const approval = await tx.financialApproval.findUnique({
        where: { id: approvalId }
      });

      if (!approval || approval.status !== 'PENDING') {
        throw new Error('APPROVAL_NOT_PENDING');
      }

      await tx.financialApproval.update({
        where: { id: approvalId },
        data: {
          status: 'REJECTED',
          approvedBy: adminUser.id,
          rejectionReason: reason
        }
      });

      // Update source event to REJECTED
      if (approval.operationType === 'PRICE_OVERRIDE') {
        await tx.orderModificationEvent.update({
          where: { id: approval.entityId },
          data: { status: 'REJECTED' }
        });
        
        // Return order status to normal if it was PENDING_CUSTOMER
        const event = await tx.orderModificationEvent.findUnique({ where: { id: approval.entityId } });
        await tx.order.update({
          where: { id: event.orderId },
          data: { modificationStatus: 'NONE' }
        });
      }
    });

    return { success: true };
  }

  /**
   * 📊 Get Approval Stats for Widget
   */
  async getApprovalStats() {
    const pending = await prisma.financialApproval.count({ where: { status: 'PENDING' } });
    const highRisk = await prisma.financialApproval.count({
       where: { 
         status: 'PENDING',
         operationType: 'REFUND' // Simplification for high risk count
       } 
    });

    return {
      pendingCount: pending,
      highRiskCount: highRisk,
      attentionRequired: pending > 3 || highRisk > 0
    };
  }
}

module.exports = new FinancialApprovalService();
