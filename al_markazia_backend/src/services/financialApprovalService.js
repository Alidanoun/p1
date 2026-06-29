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
   * 📋 List Pending Approvals (Isolated)
   */
  async getPendingApprovals(user, requestedBranchId = null) {
    if (!user) throw new Error('UNAUTHORIZED');
    
    const role = user.role?.toLowerCase();
    const isGlobalAdmin = role === 'admin';
    
    // 🛡️ [PHASE 4] Forced Isolation: Managers cannot see outside their branch
    const branchId = isGlobalAdmin ? requestedBranchId : user.branchId;
    
    const where = { status: 'PENDING' };
    if (branchId) where.branchId = branchId;
    
    // 🛡️ Defense-in-depth: If not admin and no branch, return empty (Fail-Safe)
    if (!isGlobalAdmin && !branchId) {
      logger.security('ISOLATION_FAILURE: Manager has no branchId', { userId: user.id });
      return [];
    }

    const approvals = await prisma.financialApproval.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    return approvals;
  }

  /**
   * ✅ Approve Operation
   */
  async approve(approvalId, adminUser, reason = '', version = null) {
    return await prisma.$transaction(async (tx) => {
      // 🛡️ [SEC-FIX] Pessimistic Lock: Prevent concurrent approval processing
      const approvals = await tx.$queryRaw`SELECT * FROM "FinancialApproval" WHERE id = ${approvalId} FOR UPDATE`;
      const approval = approvals[0];

      if (!approval || approval.status !== 'PENDING') {
        throw new Error('APPROVAL_NOT_PENDING_OR_NOT_FOUND');
      }
      
      // 🛡️ [P10] Optimistic Locking for Financials
      if (version !== null && approval.version !== parseInt(version)) {
        throw new Error('CONCURRENCY_CONFLICT: This approval request has been modified or processed.');
      }

      // 🛡️ [SEC-FIX] Four-Eyes Principle Enforcement
      // Fetch approver's internal ID (req.user.id is UUID)
      const approver = await tx.user.findUnique({
        where: { uuid: adminUser.id },
        select: { id: true, branchId: true }
      });

      if (!approver) {
        throw new Error('APPROVER_IDENTITY_NOT_FOUND');
      }

      if (approval.requestedBy === approver.id) {
        logger.security('SELF_APPROVAL_ATTEMPT_BLOCKED', {
          approvalId,
          userId: approver.id,
          operation: approval.operationType
        });
        throw new Error('SELF_APPROVAL_FORBIDDEN: You cannot approve your own request');
      }

      // Update Approval Record
      await tx.financialApproval.update({
        where: { id: approvalId },
        data: {
          status: 'APPROVED',
          approvedBy: approver.id,
          rejectionReason: reason,
          version: { increment: 1 },
          eventSequence: { increment: 1 }
        }
      });

      // 🏢 [LOGGING] Capture Branch Context for Audit
      let branchId = approver.branchId;
      if (approval.operationType === 'CANCELLATION' || approval.operationType === 'PRICE_OVERRIDE') {
        const order = await tx.order.findUnique({
          where: { id: parseInt(approval.entityId) },
          select: { branchId: true }
        });
        if (order) branchId = order.branchId;
      }

      // 🔄 Update the Source Event (e.g., OrderModificationEvent)
      if (approval.operationType === 'PRICE_OVERRIDE') {
        await tx.orderModificationEvent.update({
          where: { id: approval.entityId },
          data: { status: 'APPROVED' }
        });
      }

      // 🛑 Handle Cancellation Approval
      if (approval.operationType === 'CANCELLATION') {
        const orderService = require('./orderService');
        await orderService.handleCancellationRequest(
          parseInt(approval.entityId),
          adminUser,
          'approve',
          '',
          tx,
          approval.id
        );
      }

      // 💎 [AUDIT] Log for Financial Integrity Widget
      logFinancialEvent('APPROVAL_GRANTED', {
        requesterId: approval.requestedBy,
        approverId: approver.id,
        operationType: approval.operationType,
        entityId: approval.entityId,
        branchId: branchId,
        timestamp: new Date().toISOString()
      });

      logger.info('💎 FINANCIAL_APPROVAL_GRANTED', {
        approvalId,
        adminId: approver.id,
        operation: approval.operationType,
        branchId
      });

      return { success: true, approvalId };
    }, { timeout: 15000 });
  }

  /**
   * ❌ Reject Operation
   */
  async reject(approvalId, adminUser, reason, version = null) {
    if (!reason) throw new Error('REJECTION_REASON_REQUIRED');

    await prisma.$transaction(async (tx) => {
      // 🛡️ [SEC-FIX] Pessimistic Lock: Prevent concurrent rejection/approval
      const approvals = await tx.$queryRaw`SELECT * FROM "FinancialApproval" WHERE id = ${approvalId} FOR UPDATE`;
      const approval = approvals[0];

      if (!approval || approval.status !== 'PENDING') {
        throw new Error('APPROVAL_NOT_PENDING');
      }

      // 🛡️ [P10] Optimistic Locking for Financials
      if (version !== null && approval.version !== parseInt(version)) {
        throw new Error('CONCURRENCY_CONFLICT: This approval request has been modified or processed.');
      }

      // 🛡️ [FIX] Fetch approver's internal integer ID to avoid UUID string type error
      const approver = await tx.user.findUnique({
        where: { uuid: adminUser.id },
        select: { id: true }
      });

      if (!approver) {
        throw new Error('APPROVER_IDENTITY_NOT_FOUND');
      }

      await tx.financialApproval.update({
        where: { id: approvalId },
        data: {
          status: 'REJECTED',
          approvedBy: approver.id,
          rejectionReason: reason,
          version: { increment: 1 },
          eventSequence: { increment: 1 }
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
    }, { timeout: 15000 });

    return { success: true };
  }

  /**
   * 📊 Get Approval Stats for Widget
   */
  async getApprovalStats(branchId = null) {
    const whereClause = { status: 'PENDING' };
    if (branchId) {
      whereClause.branchId = branchId;
    }
    const pending = await prisma.financialApproval.count({ where: whereClause });
    const highRisk = await prisma.financialApproval.count({
       where: { 
         status: 'PENDING',
         riskLevel: 'HIGH',
         ...(branchId ? { branchId } : {})
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
