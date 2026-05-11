const container = require('../lib/container');
const logger = container.logger;
const prisma = require('../lib/prisma');

/**
 * 🛰️ Sync Controller (Strategic Consistency Protocol)
 * Handles state reconciliation and delta fetching.
 */
class SyncController {
  /**
   * 🔍 Reconcile: Compare client state vector with server state.
   * Input: { stateVector: { aggregateId: version, ... }, aggregateType: 'Order' }
   */
  async reconcile(req, res) {
    try {
      const { stateVector, aggregateType = 'Order' } = req.body;
      const userId = req.user.id;

      if (!stateVector || typeof stateVector !== 'object') {
        return res.status(400).json({ error: 'INVALID_STATE_VECTOR' });
      }

      const ids = Object.keys(stateVector);
      if (ids.length === 0) return res.json({ success: true, dirty: [] });

      // Fetch latest versions for these IDs
      // Note: We respect Branch Isolation via a helper or query filter
      const SecurityPolicyService = require('../services/securityPolicyService');
      const securityPolicy = new SecurityPolicyService();
      const branchFilter = await securityPolicy.getHardenedFilter(req.user, aggregateType);

      const latestStates = await prisma[aggregateType.toLowerCase()].findMany({
        where: {
          id: { in: ids.map(id => isNaN(id) ? id : parseInt(id)) },
          isDeleted: false,
          ...branchFilter
        },
        select: { id: true, version: true, eventSequence: true }
      });

      const dirty = [];
      const latestMap = new Map(latestStates.map(s => [String(s.id), s]));

      for (const [id, clientVersion] of Object.entries(stateVector)) {
        const serverState = latestMap.get(id);
        if (!serverState || serverState.version > parseInt(clientVersion)) {
          dirty.push({ id, reason: !serverState ? 'NOT_FOUND' : 'STALE', serverVersion: serverState?.version });
        }
      }

      res.json({
        success: true,
        dirty,
        epoch: 1 // TODO: Move to global system config
      });
    } catch (error) {
      logger.error('[SyncController] Reconciliation failed', { error: error.message });
      res.status(500).json({ error: 'RECONCILIATION_FAILED' });
    }
  }

  /**
   * 🚀 Get Delta: Fetch only modified entities since a certain version/sequence.
   */
  async getDelta(req, res) {
    try {
      const { sinceSequence = 0, aggregateType = 'Order', limit = 50 } = req.query;
      
      const SecurityPolicyService = require('../services/securityPolicyService');
      const securityPolicy = new SecurityPolicyService();
      const branchFilter = await securityPolicy.getHardenedFilter(req.user, aggregateType);

      const items = await prisma[aggregateType.toLowerCase()].findMany({
        where: {
          eventSequence: { gt: parseInt(sinceSequence) },
          isDeleted: false,
          ...branchFilter
        },
        orderBy: { eventSequence: 'asc' },
        take: parseInt(limit)
      });

      // Map response to exclude sensitive fields if needed
      // For now, return items (they are already mapped in the service layer usually)
      res.json({
        success: true,
        items,
        count: items.length,
        latestSequence: items.length > 0 ? items[items.length - 1].eventSequence : sinceSequence
      });
    } catch (error) {
      logger.error('[SyncController] Delta fetch failed', { error: error.message });
      res.status(500).json({ error: 'DELTA_FETCH_FAILED' });
    }
  }
}

module.exports = new SyncController();
