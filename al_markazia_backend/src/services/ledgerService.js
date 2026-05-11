/**
 * 📊 Independent Immutable Ledger Service
 * Phase 5: Financial Truth Separation
 * 
 * Purpose: Ensures that every financial movement is recorded in an immutable, 
 * append-only ledger that is independent of the Order or Customer state.
 */
class LedgerService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * 📒 Record a Transaction
   * @param {Object} tx - Prisma Transaction Client (Required)
   * @param {Object} data - Entry Data
   */
  async record(tx, data) {
    if (!tx) throw new Error('LEDGER_REQUIRES_TRANSACTION');

    const { 
      customerId, orderId, branchId, type, category, 
      amount, method, referenceId, description, metadata = {} 
    } = data;

    // 🔗 [PHASE 5] Authoritative Branch Resolution
    const contextBranchId = require('../utils/context').getBranchId();
    const finalBranchId = branchId || contextBranchId;

    if (!finalBranchId) {
      throw new Error('LEDGER_ERROR: Branch ID is required for financial records.');
    }

    // 🔒 [PHASE 5] Immutability & Traceability
    const { getCorrelationId } = require('../utils/context');
    const enrichedMetadata = {
      ...metadata,
      correlationId: getCorrelationId(),
      sequenceNumber: data.sequenceNumber, // 🧷 [CAUSAL-ANCHOR] Link money to aggregate timeline
      recordedAt: new Date().toISOString(),
      systemVersion: '2.0'
    };

    // 1. Calculate Balances (Append-Only Logic)
    // We don't rely on the cached balance in the record call; 
    // we fetch the latest one within the same transaction to ensure consistency.
    let balanceBefore = 0;
    if (customerId) {
       const customer = await tx.customer.findUnique({ 
         where: { id: customerId }, 
         select: { walletBalance: true } 
       });
       balanceBefore = customer ? Number(customer.walletBalance) : 0;
    }

    const numericAmount = Number(amount);
    const balanceAfter = type === 'CREDIT' ? balanceBefore + numericAmount : balanceBefore - numericAmount;

    // 2. Create the Immutable Record
    const entry = await tx.financialLedger.create({
      data: {
        customerId,
        orderId,
        branchId: finalBranchId,
        type, // CREDIT | DEBIT
        category,
        amount: numericAmount,
        balanceBefore,
        balanceAfter,
        method,
        referenceId: String(referenceId || ''),
        description,
        metadata: enrichedMetadata
      }
    });

    this.logger.financial(`Recorded ${type} of ${amount} for Branch ${finalBranchId}`, { 
      entryId: entry.id, 
      category 
    });

    return entry;
  }

  /**
   * 🔄 Reversal (Correction) Pattern
   * Instead of updating a record, we create a new reversal entry.
   */
  async reverse(tx, originalEntryId, reason, actor) {
    const original = await tx.financialLedger.findUnique({ where: { id: originalEntryId } });
    if (!original) throw new Error('ORIGINAL_ENTRY_NOT_FOUND');

    const reversalType = original.type === 'CREDIT' ? 'DEBIT' : 'CREDIT';
    
    return await this.record(tx, {
      customerId: original.customerId,
      orderId: original.orderId,
      branchId: original.branchId,
      type: reversalType,
      category: 'REVERSAL',
      amount: original.amount,
      method: original.method,
      referenceId: original.referenceId,
      description: `REVERSAL of #${original.id}: ${reason} (by ${actor?.name || 'System'})`,
      metadata: { originalEntryId: original.id, reason }
    });
  }

  /**
   * 🧮 Authoritative Balance Derivation
   * Derives the balance by summing all CREDIT and DEBIT entries in the ledger.
   * This is the "Ground Truth".
   */
  async calculateBalanceFromLedger(customerId, tx = null) {
    const db = tx || this.prisma;
    const aggregates = await db.financialLedger.groupBy({
      by: ['type'],
      where: { customerId },
      _sum: { amount: true }
    });

    let balance = 0;
    for (const group of aggregates) {
      const sum = Number(group._sum.amount || 0);
      if (group.type === 'CREDIT') balance += sum;
      else if (group.type === 'DEBIT') balance -= sum;
    }
    return balance;
  }

  /**
   * 🔧 Reconcile Cache (Repair Drift)
   * Updates the cached walletBalance to match the ledger truth.
   */
  async reconcileCache(customerId, tx = null) {
    const db = tx || this.prisma;
    const authoritativeBalance = await this.calculateBalanceFromLedger(customerId, db);

    return await db.customer.update({
      where: { id: customerId },
      data: { walletBalance: authoritativeBalance }
    });
  }
}

module.exports = LedgerService;
