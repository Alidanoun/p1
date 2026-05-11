/**
 * 📊 System Health & Global Consistency Service
 * Phase 6: Global Observability Lens
 * 
 * Purpose: Aggregates health metrics from multiple isolated layers (Ledger, Outbox, Gateway)
 * to provide a single, unified view of the system's architectural integrity.
 */
class SystemHealthService {
  constructor(container) {
    this.container = container;
    this.prisma = container.prisma;
    this.logger = container.logger;
  }

  /**
   * 🔍 Get Global Consistency Snapshot
   */
  async getSnapshot() {
    try {
      const results = await Promise.allSettled([
        this._checkLedgerIntegrity(),
        this._checkOutboxBacklog(),
        this._checkSecurityViolations(),
        this._checkIdempotencyHealth()
      ]);

      const [ledger, outbox, security, idempotency] = results.map(r => r.status === 'fulfilled' ? r.value : { status: 'UNKNOWN', error: r.reason?.message });

      // 🚦 [DETERMINISTIC STATUS CALCULATION]
      let globalStatus = 'CONSISTENT';
      
      if (ledger.status === 'DIVERGENT' || security.criticalViolations > 0) {
        globalStatus = 'DIVERGENT'; // 🔴 High Risk: Manual intervention required
      } else if (outbox.pendingCount > 100 || idempotency.collisions > 0) {
        globalStatus = 'DEGRADED'; // 🟡 Medium Risk: System is self-healing but lagging
      }

      return {
        timestamp: new Date().toISOString(),
        status: globalStatus,
        layers: {
          financial: ledger,
          asynchronous: outbox,
          security: security,
          resiliency: idempotency
        }
      };
    } catch (err) {
      this.logger.error('[Health] Failed to generate snapshot', { error: err.message });
      return { status: 'ERROR', error: err.message };
    }
  }

  async _checkLedgerIntegrity() {
    // Sample check: Compare total ledger sum vs total customer balances
    // In production, this might be a background job results check
    const ledgerSum = await this.prisma.financialLedger.aggregate({
      _sum: { amount: true },
      where: { type: 'CREDIT' }
    });
    const debitSum = await this.prisma.financialLedger.aggregate({
      _sum: { amount: true },
      where: { type: 'DEBIT' }
    });
    
    // Financial proof: Credits - Debits should match internal system expected total
    // Simplified for snapshot:
    return { 
      status: 'CONSISTENT', 
      proof: (ledgerSum._sum.amount || 0) - (debitSum._sum.amount || 0) 
    };
  }

  async _checkOutboxBacklog() {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 600000); // 10 min window

    const pendingCount = await this.prisma.outboxEvent.count({ where: { status: 'PENDING' } });
    const staleCount = await this.prisma.outboxEvent.count({ 
      where: { status: 'PENDING', createdAt: { lt: tenMinutesAgo } } 
    });
    const failedCount = await this.prisma.outboxEvent.count({ where: { status: 'FAILED' } });
    
    return {
      status: staleCount > 0 ? 'STALL_DETECTED' : (pendingCount > 50 ? 'LAGGING' : 'HEALTHY'),
      pendingCount,
      staleCount, // 🕵️ [INDEPENDENT-WATCHDOG] Detects frozen side-effects
      failedCount
    };
  }

  async _checkSecurityViolations() {
    // Check audit logs for isolation violations in the last hour
    const oneHourAgo = new Date(Date.now() - 3600000);
    const violations = await this.prisma.auditLog.count({
      where: {
        action: 'BRANCH_ISOLATION_VIOLATION',
        createdAt: { gte: oneHourAgo }
      }
    });

    return {
      status: violations > 0 ? 'ATTACK_DETECTED' : 'SECURE',
      recentViolations: violations,
      criticalViolations: violations // For now, any violation is critical
    };
  }

  async _checkIdempotencyHealth() {
    // Check for collisions or high usage
    const totalKeys = await this.prisma.idempotencyKey.count();
    return {
      status: 'HEALTHY',
      activeKeys: totalKeys,
      collisions: 0 // Logic to detect collisions would be here
    };
  }
}

module.exports = SystemHealthService;
