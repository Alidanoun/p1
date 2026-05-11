const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const eventBus = require('../events/eventBus');
const { toNumber } = require('../utils/number');

/**
 * 💳 Wallet & Ledger Service (Refined)
 * Handles all wallet transactions and maintains the IMMUTABLE Financial Ledger.
 */
class WalletService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

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
    if (!customer) return; 

    // 🔗 [PHASE 5] DERIVE TRUTH FROM LEDGER
    const authoritativeBalance = await this.container.ledgerService.calculateBalanceFromLedger(customerId, tx);

    const drift = Math.abs(authoritativeBalance - toNumber(customer.walletBalance));
    if (drift > 0.01) {
      const controlPlane = require('./systemControlPlane');
      await controlPlane.raiseAlert('FINANCIAL_INTEGRITY_VIOLATION', { 
        customerId, 
        authoritative: authoritativeBalance, 
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

    // 2. Fetch Latest Balance with Pessimistic Locking
    const [customer] = await tx.$queryRaw`SELECT * FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    const balanceBefore = toNumber(customer.walletBalance);
    const balanceAfter = balanceBefore + toNumber(amount);

    // 3. [PHASE 5] Create Immutable Ledger Entry via LedgerService
    const ledgerEntry = await this.container.ledgerService.record(tx, {
      customerId,
      type: 'CREDIT',
      category,
      amount: toNumber(amount),
      method: 'WALLET',
      referenceId: String(referenceId),
      description,
      metadata: idempotencyKey ? { idempotencyKey } : {}
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

    const [customer] = await tx.$queryRaw`SELECT * FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    const balanceBefore = toNumber(customer.walletBalance);
    if (balanceBefore < amount) throw new Error('INSUFFICIENT_WALLET_BALANCE');

    const balanceAfter = balanceBefore - toNumber(amount);

    // 2. [PHASE 5] Create Immutable Ledger Entry via LedgerService
    const ledgerEntry = await this.container.ledgerService.record(tx, {
      customerId,
      type: 'DEBIT',
      category,
      amount: toNumber(amount),
      method: 'WALLET',
      referenceId: String(referenceId),
      description,
      metadata: idempotencyKey ? { idempotencyKey } : {}
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
    return await this.prisma.$transaction(async (tx) => {
      const updated = await this.container.ledgerService.reconcileCache(customerId, tx);
      this.logger.info(`[Wallet] Reconciled balance for customer ${customerId}: ${updated.walletBalance}`);
      return updated.walletBalance;
    });
  }
}

module.exports = { WalletService };
