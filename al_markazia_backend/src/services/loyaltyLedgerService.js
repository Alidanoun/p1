const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { toNumber } = require('../utils/number');

/**
 * 📊 Loyalty Ledger Service (Atomic Write Engine)
 * This is the ONLY system of truth for point mutations.
 * Implements strict append-only ledger logic with row-level locking.
 */
class LoyaltyLedgerService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * ➕ Credit Points (Atomic)
   */
  async credit(customerId, points, category, referenceId, description, idempotencyKey, metadata = {}, tx = null) {
    if (points <= 0) throw new Error('INVALID_POINTS_AMOUNT');
    return await this._mutate(customerId, points, 'CREDIT', category, referenceId, description, idempotencyKey, metadata, tx);
  }

  /**
   * ➖ Debit Points (Atomic)
   */
  async debit(customerId, points, category, referenceId, description, idempotencyKey, metadata = {}, tx = null) {
    if (points <= 0) throw new Error('INVALID_POINTS_AMOUNT');
    return await this._mutate(customerId, -points, 'DEBIT', category, referenceId, description, idempotencyKey, metadata, tx);
  }

  /**
   * 🛡️ Private Mutation Engine
   * Handles row locking, idempotency, ledger recording, and projection sync.
   */
  async _mutate(customerId, pointsAmount, type, category, referenceId, description, idempotencyKey, metadata = {}, externalTx = null) {
    // We wrap in transaction ONLY if not already in one
    if (!externalTx) {
      return await this.prisma.$transaction(async (tx) => {
        return await this._mutateInternal(customerId, pointsAmount, type, category, referenceId, description, idempotencyKey, metadata, tx);
      }, { timeout: 15000 });
    }

    return await this._mutateInternal(customerId, pointsAmount, type, category, referenceId, description, idempotencyKey, metadata, externalTx);
  }

  /**
   * 🔒 Internal Mutation logic (must be wrapped in a transaction by the caller)
   */
  async _mutateInternal(customerId, pointsAmount, type, category, referenceId, description, idempotencyKey, metadata, tx) {
    // 1. 🛡️ Idempotency Check (Primary Defense)
    const existing = await tx.loyaltyLedger.findUnique({
      where: { idempotencyKey }
    });
    if (existing) {
      logger.warn(`[LoyaltyLedger] Duplicate mutation blocked for key: ${idempotencyKey}`);
      return existing;
    }

    // 2. 🔐 Row-Level Lock (Pessimistic Concurrency)
    const [customer] = await tx.$queryRaw`SELECT id, points FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

    const balanceBefore = customer.points || 0;
    const mutation = Math.abs(pointsAmount);
    
    // Safety Check for Debits
    if (type === 'DEBIT' && balanceBefore < mutation) {
      throw new Error('INSUFFICIENT_POINTS');
    }

    const balanceAfter = type === 'CREDIT' ? balanceBefore + mutation : balanceBefore - mutation;

    // 3. 📝 Record in Ledger (Source of Truth)
    const ledgerEntry = await tx.loyaltyLedger.create({
      data: {
        customerId,
        type,
        category,
        points: mutation,
        balanceBefore,
        balanceAfter,
        idempotencyKey,
        referenceId: String(referenceId),
        description,
        metadata
      }
    });

    logger.info(`[LoyaltyLedger] Mutation successful: ${type} ${mutation} points for customer ${customerId}.`);

    return ledgerEntry;
  }

  /**
   * 🔄 Update Projection (Cache)
   * Updates the Customer record with the balance from a specific ledger entry.
   */
  async syncProjection(customerId, balance) {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { points: balance }
    });
    logger.debug(`[LoyaltyLedger] Projection synced for customer ${customerId}: ${balance}`);
  }

  /**
   * 🔄 Reconcile Projection (Repair Cache)
   * Recalculates balance from the ledger sum and updates the Customer record.
   */
  async reconcileProjection(customerId) {
    return await this.prisma.$transaction(async (tx) => {
      const [customer] = await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

      // 🧮 Aggregate all ledger entries
      const aggregations = await tx.loyaltyLedger.groupBy({
        by: ['type'],
        where: { customerId },
        _sum: { points: true }
      });

      let credits = 0;
      let debits = 0;

      aggregations.forEach(group => {
        if (group.type === 'CREDIT') credits = group._sum.points || 0;
        if (group.type === 'DEBIT') debits = group._sum.points || 0;
      });

      const authoritativeBalance = credits - debits;

      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { points: authoritativeBalance }
      });

      logger.warn(`[LoyaltyLedger] Reconciled projection for customer ${customerId}. Authoritative balance: ${authoritativeBalance}`);
      return updated;
    });
  }

  /**
   * 🔄 Reconcile All Customers
   */
  async reconcileAll() {
    const customers = await this.prisma.customer.findMany({ select: { id: true } });
    logger.warn(`[LoyaltyLedger] Starting global reconciliation for ${customers.length} customers...`);
    
    let repaired = 0;
    for (const customer of customers) {
      try {
        await this.reconcileProjection(customer.id);
        repaired++;
      } catch (err) {
        logger.error(`[LoyaltyLedger] Failed to reconcile customer ${customer.id}`, { error: err.message });
      }
    }
    
    logger.warn(`[LoyaltyLedger] Global reconciliation complete. Repaired ${repaired} customers.`);
    return { total: customers.length, repaired };
  }
}

module.exports = { LoyaltyLedgerService };
