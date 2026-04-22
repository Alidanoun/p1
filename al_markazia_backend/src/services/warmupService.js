const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const memoryCache = require('../lib/memoryCache');
const logger = require('../utils/logger');

/**
 * ⚡ Predictive Warmup Service
 * Preloads critical data into Redis and Memory Cache to prevent cold-start spikes.
 */
class WarmupService {
  async run() {
    logger.info('[Warmup] 🚀 Initializing Predictive Cache Warmup...');
    
    try {
      await Promise.all([
        this.warmupSettings(),
        this.warmupTopMenu(),
        this.warmupActiveZones()
      ]);
      
      logger.info('[Warmup] ✅ System primed and ready for peak load.');
    } catch (err) {
      logger.error('[Warmup] ❌ Warmup sequence failed stalled', { error: err.message });
    }
  }

  async warmupSettings() {
    const settings = await prisma.systemSettings.findFirst();
    if (settings) {
      await redis.set('system:settings', JSON.stringify(settings), 'EX', 3600);
      memoryCache.set('system:settings', settings, 600);
      logger.debug('[Warmup] Settings primed.');
    }
  }

  async warmupTopMenu() {
    // Preload top 20% of menu items (simulated as active/featured items)
    const topItems = await prisma.item.findMany({
      where: { isAvailable: true },
      take: 50,
      include: { optionGroups: { include: { options: true } } }
    });

    for (const item of topItems) {
      const key = `item:detail:${item.id}`;
      await redis.set(key, JSON.stringify(item), 'EX', 1800);
      memoryCache.set(key, item, 300);
    }
    logger.debug(`[Warmup] ${topItems.length} menu items primed.`);
  }

  async warmupActiveZones() {
    const zones = await prisma.deliveryZone.findMany({ where: { isActive: true } });
    await redis.set('delivery:zones:active', JSON.stringify(zones), 'EX', 3600);
    memoryCache.set('delivery:zones:active', zones, 600);
    logger.debug(`[Warmup] ${zones.length} delivery zones primed.`);
  }
}

module.exports = new WarmupService();
