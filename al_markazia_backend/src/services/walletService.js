const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const eventBus = require('../events/eventBus');
const { toNumber } = require('../utils/number');

/**
 * 💳 Wallet & Ledger Service (Refined)
 * Handles all wallet transactions and maintains the IMMUTABLE Financial Ledger.
 */
class WalletService {

  /**
   * ➕ Credit Wallet (with Idempotency Protection)
   */
  /**
   * ➕ Credit Wallet (with Idempotency Protection)
   */
  async credit(customerId, amount, category, referenceId, description, idempotencyKey = null, tx = null, approvalId = null) {
    if (toNumber(amount) <= 0) throw new Error('INVALID_AMOUNT');

    const client = tx || prisma;
    
    // If no external transaction, we wrap it in its own
    if (!tx) {
      return await prisma.$transaction(async (innerTx) => {
        return await this._creditInternal(customerId, amount, category, referenceId, description, idempotencyKey, innerTx, approvalId);
      });
    }

    return await this._creditInternal(customerId, amount, category, referenceId, description, idempotencyKey, tx, approvalId);
  }

  /**
   * 🛡️ Financial Double-Safety: Prevention Layer
   * Verifies ledger sum vs cached balance BEFORE any new write.
   */
  async _verifyIntegrity(customerId, tx) {
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { walletBalance: true } });
    if (!customer) return; // New customer or deleted

    const aggregates = await tx.financialLedger.groupBy({
      by: ['type'],
      where: { customerId },
      _sum: { amount: true }
    });

    let calculatedBalance = 0;
    for (const group of aggregates) {
      if (group.type === 'CREDIT') calculatedBalance += toNumber(group._sum.amount);
      if (group.type === 'DEBIT') calculatedBalance -= toNumber(group._sum.amount);
    }

    const drift = Math.abs(calculatedBalance - toNumber(customer.walletBalance));
    if (drift > 0.01) {
      const controlPlane = require('./systemControlPlane');
      await controlPlane.raiseAlert('FINANCIAL_INTEGRITY_VIOLATION', { 
        customerId, 
        calculated: calculatedBalance, 
        cached: customer.walletBalance,
        drift 
      });
      throw new Error('FINANCIAL_INTEGRITY_VIOLATION: System locked until reconciliation.');
    }
  }

  async _creditInternal(customerId, amount, category, referenceId, description, idempotencyKey, tx, approvalId = null) {
    // 🛡️ [PREVENTION-FIX] Pre-flight Integrity Audit
    await this._verifyIntegrity(customerId, tx);

    // 1. 🛡️ Idempotency Check
    if (idempotencyKey) {
      const existing = await tx.financialLedger.findFirst({
        where: { metadata: { path: ['idempotencyKey'], equals: idempotencyKey } }
      });
      if (existing) {
        logger.warn(`[Wallet] Duplicate transaction detected for key: ${idempotencyKey}`);
        return existing;
      }
    }

    // 2. Fetch Latest Balance
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    const balanceBefore = toNumber(customer.walletBalance);
    const balanceAfter = balanceBefore + toNumber(amount);

    // 3. Create Ledger Entry
    const ledgerEntry = await tx.financialLedger.create({
      data: {
        customerId,
        type: 'CREDIT',
        category,
        amount: toNumber(amount),
        balanceBefore,
        balanceAfter,
        method: 'WALLET',
        referenceId: String(referenceId),
        description,
        metadata: idempotencyKey ? { idempotencyKey } : {}
      }
    });

    // 🛡️ [LINK-FIX] Link Approval if provided
    if (approvalId) {
      await tx.financialApproval.update({
        where: { id: approvalId },
        data: { ledgerEntryId: ledgerEntry.id }
      });
    }

    // 4. Update Cached Balance
    await tx.customer.update({
      where: { id: customerId },
      data: { walletBalance: balanceAfter }
    });

    const resultData = { ledgerEntry, customerId, amount, balanceAfter };

    // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
    const outboxService = require('./outboxService');
    await outboxService.enqueue('wallet.credited', resultData, tx);

    // 📊 [METRICS-FIX] Track financial volume
    const metricsService = require('./metricsService');
    await metricsService.trackFinancial('credit', amount);
    await metricsService.increment('wallet:credit_count');

    return resultData;
  }

  /**
   * ➖ Debit Wallet
   */
  async debit(customerId, amount, category, referenceId, description, idempotencyKey = null, tx = null, approvalId = null) {
    if (toNumber(amount) <= 0) throw new Error('INVALID_AMOUNT');

    const client = tx || prisma;

    if (!tx) {
      return await prisma.$transaction(async (innerTx) => {
        return await this._debitInternal(customerId, amount, category, referenceId, description, idempotencyKey, innerTx, approvalId);
      });
    }

    return await this._debitInternal(customerId, amount, category, referenceId, description, idempotencyKey, tx, approvalId);
  }

  async _debitInternal(customerId, amount, category, referenceId, description, idempotencyKey, tx, approvalId = null) {
    // 🛡️ [PREVENTION-FIX] Pre-flight Integrity Audit
    await this._verifyIntegrity(customerId, tx);

    // 1. 🛡️ Idempotency Check
    if (idempotencyKey) {
      const existing = await tx.financialLedger.findFirst({
        where: { metadata: { path: ['idempotencyKey'], equals: idempotencyKey } }
      });
      if (existing) return existing;
    }

    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    const balanceBefore = toNumber(customer.walletBalance);
    if (balanceBefore < amount) throw new Error('INSUFFICIENT_WALLET_BALANCE');

    const balanceAfter = balanceBefore - toNumber(amount);

    // 2. Create Ledger Entry
    const ledgerEntry = await tx.financialLedger.create({
      data: {
        customerId,
        type: 'DEBIT',
        category,
        amount: toNumber(amount),
        balanceBefore,
        balanceAfter,
        method: 'WALLET',
        referenceId: String(referenceId),
        description,
        metadata: idempotencyKey ? { idempotencyKey } : {}
      }
    });

    // 🛡️ [LINK-FIX] Link Approval if provided
    if (approvalId) {
      await tx.financialApproval.update({
        where: { id: approvalId },
        data: { ledgerEntryId: ledgerEntry.id }
      });
    }

    // 3. Update Cached Balance
    await tx.customer.update({
      where: { id: customerId },
      data: { walletBalance: balanceAfter }
    });

    const resultData = { ledgerEntry, customerId, amount, balanceAfter };

    // 📮 [RESILIENCE-FIX] Transactional Outbox Enqueue
    const outboxService = require('./outboxService');
    await outboxService.enqueue('wallet.debited', resultData, tx);

    // 📊 [METRICS-FIX] Track financial volume
    const metricsService = require('./metricsService');
    await metricsService.trackFinancial('debit', amount);
    await metricsService.increment('wallet:debit_count');

    return resultData;
  }

  /**
   * 🔄 Reconcile Balance from Ledger
   * (Used if cache goes out of sync)
   */
  async reconcileBalance(customerId) {
    return await prisma.$transaction(async (tx) => {
      // 1. Get transaction sums grouped by type
      const aggregates = await tx.financialLedger.groupBy({
        by: ['type'],
        where: { customerId },
        _sum: { amount: true }
      });

      let calculatedBalance = 0;
      for (const group of aggregates) {
        if (group.type === 'CREDIT') {
          calculatedBalance += toNumber(group._sum.amount || 0);
        } else if (group.type === 'DEBIT') {
          calculatedBalance -= toNumber(group._sum.amount || 0);
        }
      }

      // 2. Update the customer's walletBalance with the reconciled value
      const updatedCustomer = await tx.customer.update({
        where: { id: customerId },
        data: { walletBalance: Math.max(0, calculatedBalance) }
      });

      logger.info(`[Wallet] Reconciled balance for customer ${customerId}: ${updatedCustomer.walletBalance}`);
      return updatedCustomer.walletBalance;
    });
  }
}

module.exports = new WalletService();
